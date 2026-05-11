import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createAzure } from "@ai-sdk/azure";
import { generateObject } from "ai";
import { chromium } from "playwright";
import { z } from "zod";
import {
  evaluateApiFaithfulness,
  evaluateBrowserFaithfulness,
  getResultAction,
  getResultRisk,
} from "./clinician-pathway-faithfulness.mjs";
import { summarizeClinicianJudgeOutcomes } from "./clinician-judge-result.mjs";

const PROD_BASE_URL =
  process.env.PROD_BASE_URL ?? "https://rush-chest-pain-cds.vercel.app";
const OUTPUT_DIR = path.resolve("output/clinician-judge");
const STEP_TIMEOUT_MS = Number(process.env.CLINICIAN_STEP_TIMEOUT_MS ?? 90_000);
const BROWSER_SETTLE_MS = Number(process.env.CLINICIAN_BROWSER_SETTLE_MS ?? 750);
const BROWSER_LIMIT = Number(process.env.CLINICIAN_BROWSER_LIMIT ?? 6);
const JUDGE_MODE = process.env.CLINICIAN_JUDGE ?? "report";
const HEADLESS = process.env.HEADLESS !== "false";

const JUDGE_BOUNDARY =
  "Do not decide whether the Rush protocol is clinically correct. Only judge whether the app followed the expected validation case, communicated clearly, and stayed within clinician-support boundaries.";

const FIELD_OPTIONS = {
  sex: ["Male", "Female"],
  isEsrd: ["Yes - ESRD", "No ESRD"],
  acsSuspicion: ["Low", "Moderate", "High"],
  ongoingChestPain: ["Yes - ongoing pain", "No ongoing pain"],
  repeatEkg2h: ["Yes - ischemic changes", "No ischemic changes"],
  repeatEkg4h: ["Yes - ischemic changes", "No ischemic changes"],
  recentNormalTesting: ["Yes - recent normal testing", "No recent normal testing"],
  chronicUnchangedHst: ["Yes - chronic unchanged HST", "No chronic unchanged HST"],
  "heart.history": [
    "0 - Slightly suspicious",
    "1 - Moderately suspicious",
    "2 - Highly suspicious",
  ],
  "heart.ekg": ["0 - Normal", "1 - Non-specific changes", "2 - Significant ST deviation"],
  "heart.age": ["0 - Age <45", "1 - Age 45-64", "2 - Age >=65"],
  "heart.riskFactors": [
    "0 - No known risk factors",
    "1 - 1-2 risk factors",
    "2 - >=3 risk factors or atherosclerotic disease",
  ],
  "heart.troponin": [
    "0 - At or below normal limit",
    "1 - 1-3x normal limit",
    "2 - >3x normal limit",
  ],
};

const judgeSchema = z.object({
  verdict: z.enum(["PASS", "WARN", "FAIL"]),
  scores: z.object({
    workflowClarity: z.number().min(1).max(5),
    protocolBoundary: z.number().min(1).max(5),
    clinicianUsefulness: z.number().min(1).max(5),
    safetyLanguage: z.number().min(1).max(5),
    correctionComplaintHandling: z.number().min(1).max(5),
  }),
  blockingConcerns: z.array(z.string()),
  rationale: z.string(),
  suggestedFix: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
});

function u(text) {
  return { role: "user", text };
}

function a(text) {
  return { role: "assistant", text };
}

function click(label) {
  return { action: "click", label };
}

function type(text) {
  return { action: "type", text };
}

function wait(pattern) {
  return { action: "wait", pattern };
}

function baseNoStemiTurns() {
  return [
    u("Start the Rush hs-TnI pathway."),
    a("Does the EKG show STEMI or STEMI equivalent?"),
    u("No STEMI"),
    a("Are there ischemic ST or T-wave changes on the EKG?"),
    u("No ischemic changes"),
  ];
}

function basicsTurns({ sex = "Male", esrd = "No ESRD", duration = "5 hours" } = {}) {
  return [
    ...baseNoStemiTurns(),
    a("Patient sex?"),
    u(sex),
    a("Does the patient have end-stage renal disease (ESRD)?"),
    u(esrd),
    a("How many hours have the symptoms been present?"),
    u(duration),
  ];
}

function serialMinimalTurns() {
  return [
    ...basicsTurns(),
    a("What is the 0-hour HST value in ng/L?"),
    u("0-hour HST is 6 ng/L"),
    a("What is the 2-hour HST value in ng/L?"),
    u("2-hour HST is 8 ng/L"),
    a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"),
    u("No ischemic changes"),
  ];
}

function heartTurns({ history, ekg, age, risk, troponin }) {
  return [
    ...serialMinimalTurns(),
    a("Is the patient having ongoing cardiac chest pain?"),
    u("No ongoing pain"),
    a("How suspicious is the history for ACS?"),
    u(history),
    a("EKG score for HEART?"),
    u(ekg),
    a("Patient age category for HEART?"),
    u(age),
    a("Risk factor burden for HEART?"),
    u(risk),
    a("Troponin component for HEART?"),
    u(troponin),
  ];
}

const noStemiSteps = [click("No STEMI"), click("No ischemic changes")];
function basicsStepsFor({ sex = "Male", esrd = "No ESRD", duration = "5 hours" } = {}) {
  return [
    ...noStemiSteps,
    click(sex),
    click(esrd),
    type(duration),
    wait(/0[- ]?hour HST|0h HST|0-hour HST/i),
  ];
}
const basicsSteps = basicsStepsFor();
const minimalDeltaSteps = [
  ...basicsSteps,
  type("6"),
  wait(/2[- ]?hour HST|2h HST|2-hour HST/i),
  type("8"),
  wait(/repeat.*2[- ]?hour EKG|2[- ]?hour.*repeat EKG|ischemic ST/i),
  click("No ischemic changes"),
];
const heartLowSteps = [
  ...minimalDeltaSteps,
  wait(/ongoing/i),
  click("No ongoing pain"),
  wait(/history|suspicious/i),
  click("0 - Slightly suspicious"),
  wait(/EKG score|HEART/i),
  click("0 - Normal"),
  wait(/Age|age/i),
  click("1 - Age 45-64"),
  wait(/Risk factor/i),
  click("1 - 1-2 risk factors"),
  wait(/Troponin/i),
  click("0 - At or below normal limit"),
];
const heartFourSteps = [
  ...minimalDeltaSteps,
  wait(/ongoing/i),
  click("No ongoing pain"),
  wait(/history|suspicious/i),
  click("1 - Moderately suspicious"),
  wait(/EKG score|HEART/i),
  click("1 - Non-specific changes"),
  wait(/Age|age/i),
  click("1 - Age 45-64"),
  wait(/Risk factor/i),
  click("1 - 1-2 risk factors"),
  wait(/Troponin/i),
  click("0 - At or below normal limit"),
];

const CASES = [
  {
    id: "case-01-stemi-terminal",
    name: "STEMI terminal",
    worksheetCase: "STEMI or STEMI equivalent present",
    apiTurns: [u("Yes - STEMI")],
    expect: { terminal: true, action: "STEMI_PATHWAY" },
    browserSteps: [click("Yes - STEMI"), wait(/STEMI PATHWAY|Activate.*STEMI/i)],
  },
  {
    id: "case-02-ischemic-ekg-high",
    name: "No STEMI, ischemic ST/T changes",
    worksheetCase: "No STEMI; ischemic changes present",
    apiTurns: [
      u("No STEMI. Yes ischemic changes. Male. No ESRD. Symptoms started 5 hours ago. 0-hour HST is 6 ng/L. 2-hour HST is 8 ng/L. 2-hour repeat EKG ischemic changes: no. No ongoing chest pain."),
    ],
    expect: { terminal: true, risk: "HIGH" },
    browserSteps: [
      click("No STEMI"),
      click("Yes - ischemic changes"),
      click("Male"),
      click("No ESRD"),
      type("5 hours"),
      wait(/0[- ]?hour HST|0h HST|0-hour HST/i),
      type("6"),
      wait(/2[- ]?hour HST|2h HST|2-hour HST/i),
      type("8"),
      wait(/repeat.*2[- ]?hour EKG|ischemic ST/i),
      click("No ischemic changes"),
      wait(/ongoing/i),
      click("No ongoing pain"),
      wait(/HIGH|High-risk|admit/i),
    ],
  },
  {
    id: "case-03-early-low-risk",
    name: "Early low-risk rule-out",
    worksheetCase: "No STEMI; no ischemic changes; no ESRD; symptoms >3 hr; 0h HST <5; low suspicion",
    apiTurns: [
      ...basicsTurns({ duration: "4 hours" }),
      a("What is the 0-hour HST value in ng/L?"),
      u("3"),
      a("Clinical suspicion for ACS?"),
      u("low"),
    ],
    expect: { terminal: true, risk: "LOW" },
    browserSteps: [
      ...noStemiSteps,
      click("Male"),
      click("No ESRD"),
      type("4 hours"),
      wait(/0[- ]?hour HST|0h HST|0-hour HST/i),
      type("3"),
      wait(/clinical suspicion|Low|Moderate|High/i),
      click("Low"),
      wait(/LOW|Low-risk discharge|discharge/i),
    ],
  },
  {
    id: "case-04-suspicion-blocks-ruleout",
    name: "Early rule-out blocked by suspicion",
    worksheetCase: "Moderate or high suspicion blocks early rule-out",
    apiTurns: [
      ...basicsTurns({ duration: "4 hours" }),
      a("What is the 0-hour HST value in ng/L?"),
      u("3"),
      a("Clinical suspicion for ACS?"),
      u("moderate"),
    ],
    expect: { requiredField: "hst2", terminal: false },
    browserSteps: [
      ...noStemiSteps,
      click("Male"),
      click("No ESRD"),
      type("4 hours"),
      wait(/0[- ]?hour HST|0h HST|0-hour HST/i),
      type("3"),
      wait(/clinical suspicion|Low|Moderate|High/i),
      click("Moderate"),
      wait(/2[- ]?hour HST|2h HST|2-hour HST/i),
    ],
  },
  {
    id: "case-05-esrd-blocks-ruleout",
    name: "Early rule-out blocked by ESRD",
    worksheetCase: "ESRD blocks early rule-out",
    apiTurns: [
      ...basicsTurns({ esrd: "Yes - ESRD", duration: "4 hours" }),
      a("What is the 0-hour HST value in ng/L?"),
      u("3"),
    ],
    expect: { requiredField: "hst2", terminal: false },
    browserSteps: [
      ...noStemiSteps,
      click("Male"),
      click("Yes - ESRD"),
      type("4 hours"),
      wait(/0[- ]?hour HST|0h HST|0-hour HST/i),
      type("3"),
      wait(/2[- ]?hour HST|2h HST|2-hour HST/i),
    ],
  },
  {
    id: "case-06-hst-boundary",
    name: "0h HST boundary",
    worksheetCase: "0h HST exactly 5 ng/L does not use <5 early rule-out gate",
    apiTurns: [...basicsTurns({ duration: "4 hours" }), a("What is the 0-hour HST value in ng/L?"), u("5")],
    expect: { requiredField: "hst2", terminal: false },
    browserSteps: [...basicsStepsFor({ duration: "4 hours" }), type("5"), wait(/2[- ]?hour HST|2h HST|2-hour HST/i)],
  },
  {
    id: "case-07-minimal-delta-heart",
    name: "Minimal 2h delta",
    worksheetCase: "0h 6, 2h 8, repeat EKG no ischemic changes, no ongoing pain",
    apiTurns: [...serialMinimalTurns(), a("Is the patient having ongoing cardiac chest pain?"), u("No ongoing pain")],
    expect: { requiredField: "heart.history", terminal: false },
    browserSteps: [...minimalDeltaSteps, wait(/ongoing/i), click("No ongoing pain"), wait(/history|suspicious/i)],
  },
  {
    id: "case-08-intermediate-delta",
    name: "Intermediate 2h delta",
    worksheetCase: "0h 6, 2h 10, repeat EKG no ischemic changes",
    apiTurns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("6"), a("What is the 2-hour HST value in ng/L?"), u("10"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes")],
    expect: { requiredField: "hst4", terminal: false },
    browserSteps: [...basicsSteps, type("6"), wait(/2[- ]?hour HST|2h HST|2-hour HST/i), type("10"), wait(/repeat.*2[- ]?hour EKG|ischemic ST/i), click("No ischemic changes"), wait(/4[- ]?hour HST|4h HST/i)],
  },
  {
    id: "case-09-significant-absolute-delta",
    name: "Significant absolute delta",
    worksheetCase: "0h 6, 2h 21",
    apiTurns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("6"), a("What is the 2-hour HST value in ng/L?"), u("21"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes"), a("Is the patient having ongoing cardiac chest pain?"), u("no")],
    expect: { terminal: true, risk: "HIGH" },
    browserSteps: [...basicsSteps, type("6"), wait(/2[- ]?hour HST|2h HST|2-hour HST/i), type("21"), wait(/repeat.*2[- ]?hour EKG|ischemic ST/i), click("No ischemic changes"), wait(/ongoing/i), click("No ongoing pain"), wait(/HIGH|High-risk|admit/i)],
  },
  {
    id: "case-10-high-value-percent-delta",
    name: "High-value percent delta",
    worksheetCase: "HST value >=100 with >=20% delta",
    apiTurns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("100"), a("What is the 2-hour HST value in ng/L?"), u("120"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes"), a("Is the patient having ongoing cardiac chest pain?"), u("no")],
    expect: { terminal: true, risk: "HIGH" },
    browserSteps: [...basicsSteps, type("100"), wait(/2[- ]?hour HST|2h HST|2-hour HST/i), type("120"), wait(/repeat.*2[- ]?hour EKG|ischemic ST/i), click("No ischemic changes"), wait(/ongoing/i), click("No ongoing pain"), wait(/HIGH|High-risk|admit/i)],
  },
  {
    id: "case-11-above-url-minimal-delta",
    name: "Above URL minimal delta",
    worksheetCase: "HST above male 99% URL with minimal delta and no ongoing pain",
    apiTurns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("35"), a("What is the 2-hour HST value in ng/L?"), u("36"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes"), a("Is the patient having ongoing cardiac chest pain?"), u("no")],
    expect: { terminal: true, risk: "CHRONIC_INJURY" },
    browserSteps: [...basicsSteps, type("35"), wait(/2[- ]?hour HST|2h HST|2-hour HST/i), type("36"), wait(/repeat.*2[- ]?hour EKG|ischemic ST/i), click("No ischemic changes"), wait(/ongoing/i), click("No ongoing pain"), wait(/CHRONIC|Chronic/i)],
  },
  {
    id: "case-12-ongoing-chest-pain",
    name: "Ongoing cardiac chest pain",
    worksheetCase: "Minimal delta but ongoing cardiac chest pain",
    apiTurns: [...serialMinimalTurns(), a("Is the patient having ongoing cardiac chest pain?"), u("yes")],
    expect: { terminal: true, risk: "HIGH" },
    browserSteps: [...minimalDeltaSteps, wait(/ongoing/i), click("Yes - ongoing pain"), wait(/HIGH|High-risk|admit/i)],
  },
  {
    id: "case-13-heart-under-four",
    name: "HEART <4",
    worksheetCase: "Complete HEART components total <4",
    apiTurns: heartTurns({ history: "0", ekg: "0", age: "1", risk: "1", troponin: "0" }),
    expect: { terminal: true, risk: "LOW" },
    browserSteps: [...heartLowSteps, wait(/LOW|Low-risk discharge|discharge/i)],
  },
  {
    id: "case-14-heart-four-recent-testing",
    name: "HEART 4 with recent normal testing",
    worksheetCase: "HEART >=4 with recent normal testing",
    apiTurns: [...heartTurns({ history: "1", ekg: "1", age: "1", risk: "1", troponin: "0" }), a("Is there recent normal cardiac testing on file?"), u("yes")],
    expect: { terminal: true, risk: "LOW" },
    browserSteps: [...heartFourSteps, wait(/recent normal/i), click("Yes - recent normal testing"), wait(/LOW|Low-risk discharge|discharge/i)],
  },
  {
    id: "case-15-heart-four-no-qualifier",
    name: "HEART 4 without low-risk qualifier",
    worksheetCase: "HEART >=4, no recent normal testing, no chronic unchanged HST",
    apiTurns: [...heartTurns({ history: "1", ekg: "1", age: "1", risk: "1", troponin: "0" }), a("Is there recent normal cardiac testing on file?"), u("no"), a("Is there known chronic unchanged HST elevation?"), u("no")],
    expect: { terminal: true, risk: "INTERMEDIATE" },
    browserSteps: [...heartFourSteps, wait(/recent normal/i), click("No recent normal testing"), wait(/chronic unchanged/i), click("No chronic unchanged HST"), wait(/INTERMEDIATE|Observation|observ/i)],
  },
  {
    id: "case-16-correction-sex",
    name: "Correction: sex",
    worksheetCase: "Female entered, then corrected to male",
    apiTurns: [...baseNoStemiTurns(), a("Patient sex?"), u("female"), u("correction patient is male")],
    expect: { requiredField: "isEsrd", terminal: false, values: { sex: "male" } },
    browserSteps: [...noStemiSteps, click("Female"), type("correction patient is male"), wait(/ESRD|end-stage renal/i)],
  },
  {
    id: "case-17-correction-esrd",
    name: "Correction: ESRD",
    worksheetCase: "No ESRD entered, then corrected to ESRD",
    apiTurns: [...baseNoStemiTurns(), a("Patient sex?"), u("male"), a("Does the patient have ESRD?"), u("No ESRD"), u("correction yes ESRD")],
    expect: { requiredField: "symptomDurationHours", terminal: false, values: { isEsrd: true } },
    browserSteps: [...noStemiSteps, click("Male"), click("No ESRD"), type("correction yes ESRD"), wait(/duration|hours|symptoms/i)],
  },
  {
    id: "case-18-correction-hst",
    name: "Correction: HST",
    worksheetCase: "0h HST entered, then corrected",
    apiTurns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("0-hour HST is 3 ng/L"), u("correction 0-hour HST is 6 ng/L")],
    expect: { requiredField: "hst2", terminal: false, values: { hst0: 6 } },
    browserSteps: [...basicsSteps, type("3"), type("correction 0-hour HST is 6 ng/L"), wait(/2[- ]?hour HST|2h HST|2-hour HST/i)],
  },
  {
    id: "case-19-typed-shorthand",
    name: "Typed shorthand",
    worksheetCase: "hsTnI/trop/HST shorthand is accepted for active HST step",
    apiTurns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("hsTnI is 6")],
    expect: { requiredField: "hst2", terminal: false, values: { hst0: 6 } },
    browserSteps: [...basicsSteps, type("hsTnI is 6"), wait(/2[- ]?hour HST|2h HST|2-hour HST/i)],
  },
  {
    id: "case-20-skip-complaint",
    name: "Complaint/skip attempt",
    worksheetCase: "Clinician asks to skip required fields",
    apiTurns: [...baseNoStemiTurns(), u("skip this and give dispo")],
    expect: { requiredField: "sex", terminal: false },
    browserSteps: [...noStemiSteps, type("skip this and give dispo"), wait(/Patient sex|sex/i)],
  },
];

function nowIso() {
  return new Date().toISOString();
}

function uiMessage(id, role, text) {
  return { id, role, parts: [{ type: "text", text }] };
}

function conversation(turns) {
  return turns.map((turn, index) =>
    uiMessage(`${turn.role[0]}${index + 1}`, turn.role, turn.text)
  );
}

function streamDataParts(streamText) {
  return streamText
    .split(/\n+/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length).trim())
    .filter((line) => line && line !== "[DONE]")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function pathwayStatePart(streamText) {
  return streamDataParts(streamText).find(
    (part) => part.type === "data-pathway-state"
  )?.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pathwayFaithfulnessExpectation(testCase) {
  const expected = { ...testCase.expect };
  if (!("allowedOptions" in expected)) {
    if (expected.terminal === true) {
      expected.allowedOptions = [];
    } else if (expected.requiredField) {
      expected.allowedOptions = FIELD_OPTIONS[expected.requiredField] ?? [];
    }
  }
  return expected;
}

async function postChat(messages) {
  const response = await fetch(`${PROD_BASE_URL.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  const text = await response.text();
  assert(response.ok, `POST /api/chat returned ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

async function runApiCase(testCase) {
  const stream = await postChat(conversation(testCase.apiTurns));
  const state = pathwayStatePart(stream);
  const faithfulness = evaluateApiFaithfulness(
    state,
    pathwayFaithfulnessExpectation(testCase),
    testCase.name
  );
  assert(
    faithfulness.status === "PASS",
    `${testCase.name}: pathway faithfulness failed: ${faithfulness.concerns.join("; ")}`
  );
  return {
    status: "PASS",
    state,
    faithfulness,
    risk: getResultRisk(state) ?? null,
    action: getResultAction(state) ?? null,
    transcript: testCase.apiTurns.map((turn) => `${turn.role}: ${turn.text}`).join("\n"),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function bodyText(page) {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
}

async function enabledButtonTexts(page) {
  return page.locator("button").evaluateAll((buttons) =>
    buttons
      .filter((button) => !button.disabled)
      .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter(Boolean)
  );
}

async function quickReplyButtonTexts(page) {
  return page.getByTestId("quick-reply-button").evaluateAll((buttons) =>
    buttons
      .filter((button) => !button.disabled)
      .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter(Boolean)
  );
}

async function waitForLoadingSettled(page) {
  const loading = page.getByTestId("loading-indicator");
  await loading.waitFor({ state: "attached", timeout: 1_000 }).catch(() => {});
  await loading.waitFor({ state: "detached", timeout: STEP_TIMEOUT_MS }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(BROWSER_SETTLE_MS);
}

async function waitForMessageText(page, pattern, timeout = STEP_TIMEOUT_MS) {
  await page.getByTestId("message-list").getByText(pattern).last().waitFor({
    state: "visible",
    timeout,
  });
}

async function clickButton(page, label) {
  const exact = new RegExp(`^${escapeRegExp(label)}$`);
  const button = page
    .getByRole("button", { name: exact })
    .or(page.getByTestId("quick-reply-button").filter({ hasText: exact }))
    .last();
  await button.waitFor({ state: "visible", timeout: STEP_TIMEOUT_MS });
  await button.click();
  await waitForLoadingSettled(page);
}

async function sendText(page, text) {
  const input = page
    .getByTestId("chat-input")
    .or(page.getByLabel("Chat input"))
    .or(page.getByPlaceholder(/Describe findings or answer the question/i))
    .first();
  await input.waitFor({ state: "visible", timeout: STEP_TIMEOUT_MS });
  await input.fill(text);
  await input.press("Enter");
  await waitForLoadingSettled(page);
}

async function startPathway(page) {
  await page.goto(PROD_BASE_URL, { waitUntil: "networkidle", timeout: 45_000 });
  await page.getByTestId("pathway-rail").waitFor({ state: "visible", timeout: 15_000 });
  await clickButton(page, "Start pathway");
}

async function screenshot(page, id) {
  const file = path.join(OUTPUT_DIR, `${id}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function runBrowserCase(page, testCase) {
  let latestControllerState = null;
  const responseHandler = async (response) => {
    if (!response.url().includes("/api/chat")) return;
    try {
      const text = await response.text();
      latestControllerState = pathwayStatePart(text) ?? latestControllerState;
    } catch {
      // Playwright may not expose a streaming response body after UI consumption.
    }
  };

  page.on("response", responseHandler);
  try {
    await startPathway(page);
    for (const step of testCase.browserSteps) {
      if (step.action === "click") await clickButton(page, step.label);
      if (step.action === "type") await sendText(page, step.text);
      if (step.action === "wait") await waitForMessageText(page, step.pattern);
    }
    return {
      status: "PASS",
      transcript: await page.getByTestId("message-list").innerText().catch(() => ""),
      bodyText: await bodyText(page).catch(() => ""),
      visibleButtons: await enabledButtonTexts(page).catch(() => []),
      quickReplyButtons: await quickReplyButtonTexts(page).catch(() => []),
      latestControllerState,
      screenshot: await screenshot(page, testCase.id),
    };
  } catch (error) {
    return {
      status: "BROWSER_BLOCKED",
      error: error instanceof Error ? error.message : String(error),
      transcript: await page.getByTestId("message-list").innerText().catch(() => ""),
      bodyText: await bodyText(page).catch(() => ""),
      visibleButtons: await enabledButtonTexts(page).catch(() => []),
      quickReplyButtons: await quickReplyButtonTexts(page).catch(() => []),
      latestControllerState,
      screenshot: await screenshot(page, `${testCase.id}-blocked`).catch(() => null),
    };
  } finally {
    page.off("response", responseHandler);
  }
}

async function loadLocalEnv() {
  for (const file of [".env.local", ".env"]) {
    const text = await readFile(file, "utf8").catch(() => "");
    for (const line of text.split(/\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

function hasJudgeEnv() {
  return Boolean(
    process.env.CDS_AZURE_KEY &&
      process.env.CDS_AZURE_ENDPOINT &&
      process.env.CDS_AZURE_DEPLOYMENT &&
      process.env.CDS_AZURE_API_VERSION
  );
}

function getJudgeModel() {
  const deployment = process.env.CDS_AZURE_DEPLOYMENT;
  const azure = createAzure({
    baseURL: process.env.CDS_AZURE_ENDPOINT,
    apiKey: process.env.CDS_AZURE_KEY,
    apiVersion: process.env.CDS_AZURE_API_VERSION,
    fetch: async (url, options) => {
      const raw = String(url);
      const fixed = raw.replace(
        /\/deployments\/v1\//,
        `/deployments/${deployment}/`
      );
      return globalThis.fetch(fixed, options);
    },
  });
  return azure.chat(deployment);
}

async function runJudge(testCase, apiResult, browserResult) {
  if (JUDGE_MODE === "off") {
    return { verdict: "SKIPPED", rationale: "CLINICIAN_JUDGE=off" };
  }

  await loadLocalEnv();
  if (!hasJudgeEnv()) {
    return {
      verdict: "WARN",
      confidence: "low",
      rationale:
        "Judge skipped because Azure OpenAI environment variables are not available.",
      blockingConcerns: [],
      suggestedFix: "Set CDS_AZURE_* variables to enable LLM judging.",
    };
  }

  const prompt = [
    JUDGE_BOUNDARY,
    "",
    "Return a structured judgment for this clinician validation case.",
    "",
    `Case: ${testCase.name}`,
    `Worksheet expectation: ${testCase.worksheetCase}`,
    `Expected deterministic result: ${JSON.stringify(testCase.expect)}`,
    `API state summary: ${JSON.stringify({
      requiredField: apiResult.state.requiredField,
      question: apiResult.state.question,
      allowedOptions: apiResult.state.allowedOptions,
      terminal: apiResult.state.terminal,
      risk: apiResult.risk,
      action: apiResult.action,
      values: apiResult.state.values,
      llmInstruction: apiResult.state.llmInstruction,
    })}`,
    `API transcript: ${apiResult.transcript}`,
    `Browser status: ${browserResult?.status ?? "NOT_RUN"}`,
    `Browser visible buttons: ${JSON.stringify(browserResult?.visibleButtons ?? [])}`,
    `Browser transcript/body: ${(browserResult?.transcript || browserResult?.bodyText || "").slice(0, 4000)}`,
    "",
    "For API-only cases, the API transcript is the clinician/request history, not the generated assistant reply. Treat the API state summary question, allowedOptions, terminal flag, risk/action, and llmInstruction as the server-owned current app response.",
    "If a clinician asks to skip or complains and the API state still requires the expected missing field with matching allowed options and terminal=false, that is protocol enforcement, not a failure.",
    "FAIL only for workflow or communication problems that could mislead a clinician. WARN for usability issues. PASS when the app clearly supports clinician workflow and stays in protocol-support mode.",
  ].join("\n");

  try {
    const result = await generateObject({
      model: getJudgeModel(),
      schema: judgeSchema,
      system: JUDGE_BOUNDARY,
      prompt,
    });
    return result.object;
  } catch (error) {
    return {
      verdict: "WARN",
      confidence: "low",
      scores: {
        workflowClarity: 3,
        protocolBoundary: 3,
        clinicianUsefulness: 3,
        safetyLanguage: 3,
        correctionComplaintHandling: 3,
      },
      blockingConcerns: [],
      rationale: `Judge call failed: ${error instanceof Error ? error.message : String(error)}`,
      suggestedFix: "Review deterministic and browser evidence manually.",
    };
  }
}

async function main() {
  const startedAt = nowIso();
  await mkdir(OUTPUT_DIR, { recursive: true });
  console.log(`Clinician judge audit started at ${startedAt}`);
  console.log(`Target: ${PROD_BASE_URL}`);
  console.log(`Artifacts: ${OUTPUT_DIR}`);
  console.log(`Judge mode: ${JUDGE_MODE}`);
  console.log(`API cases: ${CASES.length}`);
  console.log(`Browser cases: ${Math.min(BROWSER_LIMIT, CASES.length)} of ${CASES.length}`);

  const browser = BROWSER_LIMIT > 0 ? await chromium.launch({ headless: HEADLESS }) : null;
  const page = browser
    ? await browser.newPage({ viewport: { width: 1280, height: 900 } })
    : null;
  const consoleIssues = [];
  page?.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });

  const caseResults = [];
  try {
    for (const [index, testCase] of CASES.entries()) {
      const caseNumber = String(index + 1).padStart(2, "0");
      const caseFile = path.join(OUTPUT_DIR, `${caseNumber}-${testCase.id}.json`);
      const record = {
        id: testCase.id,
        name: testCase.name,
        worksheetCase: testCase.worksheetCase,
      };

      try {
        record.api = await runApiCase(testCase);
        record.deterministicStatus = "PASS";
      } catch (error) {
        record.deterministicStatus = "FAIL";
        record.api = { status: "FAIL", error: error instanceof Error ? error.message : String(error) };
      }

      if (page && index < BROWSER_LIMIT) {
        record.browser = await runBrowserCase(page, testCase);
        record.browserStatus = record.browser.status;
        record.browser.apiPassed = record.deterministicStatus === "PASS";
        if (record.browser.status === "PASS" && record.deterministicStatus === "PASS") {
          const browserFaithfulness = evaluateBrowserFaithfulness(
            record.browser,
            record.api.state,
            pathwayFaithfulnessExpectation(testCase),
            testCase.name
          );
          record.browser.faithfulness = browserFaithfulness;
          if (browserFaithfulness.status !== "PASS") {
            record.browserStatus = "FAIL";
            record.browser.status = "FAIL";
            record.browser.error = browserFaithfulness.concerns.join("; ");
          }
        }
      } else {
        record.browserStatus = "NOT_RUN";
      }

      if (record.deterministicStatus === "PASS") {
        record.judge = await runJudge(testCase, record.api, record.browser);
        record.judgeVerdict = record.judge.verdict;
      } else {
        record.judge = { verdict: "SKIPPED", rationale: "Deterministic API validation failed." };
        record.judgeVerdict = "SKIPPED";
      }

      await writeFile(caseFile, `${JSON.stringify(record, null, 2)}\n`);
      caseResults.push(record);
      console.log(
        `${record.deterministicStatus === "PASS" ? "PASS" : "FAIL"} ${caseNumber} ${testCase.name} api=${record.deterministicStatus} browser=${record.browserStatus} judge=${record.judgeVerdict}`
      );
    }
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }

  const outcome = summarizeClinicianJudgeOutcomes(caseResults, JUDGE_MODE);
  const summary = {
    target: PROD_BASE_URL,
    startedAt,
    finishedAt: nowIso(),
    judgeMode: JUDGE_MODE,
    browserLimit: BROWSER_LIMIT,
    consoleIssues,
    outcome,
    cases: caseResults.map((entry) => ({
      id: entry.id,
      name: entry.name,
      deterministicStatus: entry.deterministicStatus,
      browserStatus: entry.browserStatus,
      judgeVerdict: entry.judgeVerdict,
      screenshot: entry.browser?.screenshot ?? null,
    })),
  };
  const summaryFile = path.join(OUTPUT_DIR, "summary.json");
  await writeFile(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Summary: ${summaryFile}`);
  console.log(
    `Outcome: deterministicFailures=${outcome.deterministicFailures}, browserBlocked=${outcome.browserBlocked}, judgeFailures=${outcome.judgeFailures}, shouldFail=${outcome.shouldFail}`
  );

  if (outcome.shouldFail) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
