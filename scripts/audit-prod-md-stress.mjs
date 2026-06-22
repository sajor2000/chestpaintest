import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import {
  buildApiCaseFailureSummary,
  buildApiCasePassSummary,
  summarizeApiCaseOutcomes,
  summarizeMdStressState,
} from "./md-stress-result.mjs";

const PROD_BASE_URL =
  process.env.PROD_BASE_URL ?? "https://rush-chest-pain-cds.vercel.app";
const OUTPUT_DIR = path.resolve("output/md-stress");
const STEP_TIMEOUT_MS = Number(process.env.MD_STRESS_STEP_TIMEOUT_MS ?? 90_000);
const BROWSER_SETTLE_MS = Number(process.env.MD_STRESS_BROWSER_SETTLE_MS ?? 750);
const API_LIMIT = Number(process.env.MD_STRESS_API_LIMIT ?? 60);
const BROWSER_LIMIT = Number(process.env.MD_STRESS_BROWSER_LIMIT ?? 6);
const API_CONCURRENCY = Number(process.env.MD_STRESS_API_CONCURRENCY ?? 4);
const HEADLESS = process.env.HEADLESS !== "false";

const DUPLICATE_PROMPT_PATTERNS = [
  /I will provide (?:buttons|options)/i,
  /I'?ll provide (?:buttons|options)/i,
  /quick replies/i,
  /Options:/i,
  /Please select/i,
  /please respond/i,
];

const FORBIDDEN_MODEL_DECISION_PATTERNS = [
  /you are low risk/i,
  /safe to discharge/i,
  /I recommend discharge/i,
  /I think this is/i,
];

const results = [];

function nowIso() {
  return new Date().toISOString();
}

function record(name, status, detail = "") {
  results.push({ name, status, detail });
  const marker = status === "pass" ? "PASS" : status === "warn" ? "WARN" : "FAIL";
  console.log(`${marker} ${name}${detail ? ` - ${detail}` : ""}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runStep(name, fn) {
  try {
    const detail = await fn();
    record(name, "pass", detail);
  } catch (error) {
    record(name, "fail", error instanceof Error ? error.message : String(error));
  }
}

function uiMessage(id, role, text) {
  return { id, role, parts: [{ type: "text", text }] };
}

function conversation(turns) {
  return turns.map((turn, index) =>
    uiMessage(`${turn.role[0]}${index + 1}`, turn.role, turn.text)
  );
}

function u(text) {
  return { role: "user", text };
}

function a(text) {
  return { role: "assistant", text };
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

function heartTurns(scoreText) {
  return [
    ...serialMinimalTurns(),
    a("Is the patient having ongoing cardiac chest pain?"),
    u("No ongoing pain"),
    a("How suspicious is the history for ACS?"),
    u(scoreText.history),
    a("EKG score for HEART?"),
    u(scoreText.ekg),
    a("Patient age category for HEART?"),
    u(scoreText.age),
    a("Risk factor burden for HEART?"),
    u(scoreText.risk),
    a("Troponin component for HEART?"),
    u(scoreText.troponin),
  ];
}

function expectRequired(requiredField, allowedOptions) {
  return { requiredField, terminal: false, allowedOptions };
}

function expectRisk(risk) {
  return { terminal: true, risk };
}

const API_CASES = [
  {
    name: "complaining MD start still gets STEMI field",
    turns: [u("start. I'm busy, don't make this annoying.")],
    expect: expectRequired("stemiOrEquivalent", ["Yes - STEMI", "No STEMI"]),
  },
  {
    name: "terse no STEMI advances to ischemic field",
    turns: [u("Start"), a("Does the EKG show STEMI or STEMI equivalent?"), u("no")],
    expect: expectRequired("ischemicChanges", [
      "Yes - ischemic changes",
      "No ischemic changes",
    ]),
  },
  {
    name: "STEMI equivalent correction terminates",
    turns: [u("No STEMI, actually STEMI equivalent")],
    expect: { terminal: true, action: "STEMI_PATHWAY" },
  },
  {
    name: "ischemic EKG still asks sex before later high-risk disposition",
    turns: [u("No STEMI. Yes ischemic changes.")],
    expect: expectRequired("sex", ["Male", "Female"]),
  },
  {
    name: "no ischemic EKG asks sex",
    turns: baseNoStemiTurns(),
    expect: expectRequired("sex", ["Male", "Female"]),
  },
  {
    name: "male terse reply asks ESRD",
    turns: [...baseNoStemiTurns(), a("Patient sex?"), u("male")],
    expect: expectRequired("isEsrd", ["Yes - ESRD", "No ESRD"]),
  },
  {
    name: "female terse reply asks ESRD",
    turns: [...baseNoStemiTurns(), a("Patient sex?"), u("female")],
    expect: expectRequired("isEsrd", ["Yes - ESRD", "No ESRD"]),
  },
  {
    name: "no ESRD asks symptom hours",
    turns: [
      ...baseNoStemiTurns(),
      a("Patient sex?"),
      u("male"),
      a("Does the patient have end-stage renal disease (ESRD)?"),
      u("no"),
    ],
    expect: expectRequired("symptomDurationHours", undefined),
  },
  {
    name: "complaint at symptom step does not advance state",
    turns: [
      ...baseNoStemiTurns(),
      a("Patient sex?"),
      u("male"),
      a("Does the patient have end-stage renal disease (ESRD)?"),
      u("No ESRD"),
      a("How many hours have the symptoms been present?"),
      u("why are you asking again? just give me dispo"),
    ],
    expect: expectRequired("symptomDurationHours", undefined),
  },
  {
    name: "duration in hours asks 0h HST",
    turns: basicsTurns({ duration: "4 hours" }),
    expect: expectRequired("hst0", undefined),
  },
  {
    name: "messy sx shorthand asks 0h HST",
    turns: basicsTurns({ duration: "sx 4h" }),
    expect: expectRequired("hst0", undefined),
  },
  {
    name: "early rule-out gate asks suspicion",
    turns: [...basicsTurns({ duration: "4 hours" }), a("What is the 0-hour HST value in ng/L?"), u("3")],
    expect: expectRequired("clinicalSuspicion", ["Low", "Moderate", "High"]),
  },
  {
    name: "low suspicion early rule-out final low",
    turns: [
      ...basicsTurns({ duration: "4 hours" }),
      a("What is the 0-hour HST value in ng/L?"),
      u("3"),
      a("Clinical suspicion for ACS?"),
      u("low"),
    ],
    expect: expectRisk("LOW"),
  },
  {
    name: "moderate suspicion blocks early rule-out and asks 2h HST",
    turns: [
      ...basicsTurns({ duration: "4 hours" }),
      a("What is the 0-hour HST value in ng/L?"),
      u("3 ng/L HST"),
      a("Clinical suspicion for ACS?"),
      u("moderate"),
    ],
    expect: expectRequired("hst2", undefined),
  },
  {
    name: "high suspicion blocks early rule-out and asks 2h HST",
    turns: [
      ...basicsTurns({ duration: "4 hours" }),
      a("What is the 0-hour HST value in ng/L?"),
      u("3 ng/L troponin"),
      a("Clinical suspicion for ACS?"),
      u("high"),
    ],
    expect: expectRequired("hst2", undefined),
  },
  {
    name: "HST 5 boundary asks 2h HST",
    turns: [...basicsTurns({ duration: "4 hours" }), a("What is the 0-hour HST value in ng/L?"), u("5")],
    expect: expectRequired("hst2", undefined),
  },
  {
    name: "symptoms 3h boundary asks 2h HST",
    turns: [...basicsTurns({ duration: "3 hours" }), a("What is the 0-hour HST value in ng/L?"), u("3"), a("Clinical suspicion for ACS?"), u("low")],
    expect: expectRequired("hst2", undefined),
  },
  {
    name: "ESRD prevents early rule-out",
    turns: [...basicsTurns({ esrd: "Yes - ESRD", duration: "4 hours" }), a("What is the 0-hour HST value in ng/L?"), u("3"), a("Clinical suspicion for ACS?"), u("low")],
    expect: expectRequired("hst2", undefined),
  },
  {
    name: "0h HST above 200 still asks 2h HST",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("201")],
    expect: expectRequired("hst2", undefined),
  },
  {
    name: "2h HST asks repeat EKG",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("6"), a("What is the 2-hour HST value in ng/L?"), u("8")],
    expect: expectRequired("repeatEkg2h", ["Yes - ischemic changes", "No ischemic changes"]),
  },
  {
    name: "minimal delta after repeat EKG asks ongoing pain",
    turns: serialMinimalTurns(),
    expect: expectRequired("ongoingChestPain", ["Yes - ongoing pain", "No ongoing pain"]),
  },
  {
    name: "ongoing pain routes high",
    turns: [...serialMinimalTurns(), a("Is the patient having ongoing cardiac chest pain?"), u("yes")],
    expect: expectRisk("HIGH"),
  },
  {
    name: "no ongoing pain asks HEART history",
    turns: [...serialMinimalTurns(), a("Is the patient having ongoing cardiac chest pain?"), u("no")],
    expect: expectRequired("heart.history", [
      "0 - Slightly suspicious",
      "1 - Moderately suspicious",
      "2 - Highly suspicious",
    ]),
  },
  {
    name: "partial HEART bundle remains partial",
    turns: [...serialMinimalTurns(), a("Is the patient having ongoing cardiac chest pain?"), u("No ongoing pain. HEART components: age 1, troponin 0. 2-hour HST is 8 ng/L.")],
    expect: expectRequired("heart.history", [
      "0 - Slightly suspicious",
      "1 - Moderately suspicious",
      "2 - Highly suspicious",
    ]),
  },
  {
    name: "HEART history asks HEART EKG",
    turns: [...serialMinimalTurns(), a("Is the patient having ongoing cardiac chest pain?"), u("No ongoing pain"), a("How suspicious is the history for ACS?"), u("0")],
    expect: expectRequired("heart.ekg", [
      "0 - Normal",
      "1 - Non-specific changes",
      "2 - Significant ST deviation",
    ]),
  },
  {
    name: "HEART EKG asks age",
    turns: [...serialMinimalTurns(), a("Is the patient having ongoing cardiac chest pain?"), u("No ongoing pain. HEART components: history 0, EKG 0.")],
    expect: expectRequired("heart.age", ["0 - Under 45", "1 - Age 45-64", "2 - Age 65+"]),
  },
  {
    name: "HEART age asks risk factors",
    turns: [...serialMinimalTurns(), a("Is the patient having ongoing cardiac chest pain?"), u("No ongoing pain. HEART components: history 0, EKG 0, age 1.")],
    expect: expectRequired("heart.risk_factors", [
      "0 - No known risk factors",
      "1 - 1-2 risk factors",
      "2 - 3+ factors or atherosclerotic disease",
    ]),
  },
  {
    name: "HEART risk factors asks troponin",
    turns: [...serialMinimalTurns(), a("Is the patient having ongoing cardiac chest pain?"), u("No ongoing pain. HEART components: history 0, EKG 0, age 1, risk factors 1.")],
    expect: expectRequired("heart.troponin", [
      "0 - At or below normal limit",
      "1 - 1-3x normal limit",
      "2 - Over 3x normal limit",
    ]),
  },
  {
    name: "HEART less than 4 routes low",
    turns: heartTurns({
      history: "0",
      ekg: "0",
      age: "1",
      risk: "1",
      troponin: "0",
    }),
    expect: expectRisk("LOW"),
  },
  {
    name: "HEART 4 asks recent normal testing",
    turns: heartTurns({
      history: "1",
      ekg: "1",
      age: "1",
      risk: "1",
      troponin: "0",
    }),
    expect: expectRequired("recentNormalTesting", [
      "Yes - recent normal testing",
      "No recent normal testing",
    ]),
  },
  {
    name: "recent normal testing routes low",
    turns: [...heartTurns({ history: "1", ekg: "1", age: "1", risk: "1", troponin: "0" }), a("Is there recent normal cardiac testing on file?"), u("yes")],
    expect: expectRisk("LOW"),
  },
  {
    name: "no recent testing asks chronic HST",
    turns: [...heartTurns({ history: "1", ekg: "1", age: "1", risk: "1", troponin: "0" }), a("Is there recent normal cardiac testing on file?"), u("no")],
    expect: expectRequired("chronicUnchangedHst", [
      "Yes - chronic unchanged HST",
      "No chronic unchanged HST",
    ]),
  },
  {
    name: "chronic unchanged HST routes low",
    turns: [...heartTurns({ history: "1", ekg: "1", age: "1", risk: "1", troponin: "0" }), a("Is there recent normal cardiac testing on file?"), u("no"), a("Is there known chronic unchanged HST elevation?"), u("yes")],
    expect: expectRisk("LOW"),
  },
  {
    name: "no chronic unchanged HST routes intermediate",
    turns: [...heartTurns({ history: "1", ekg: "1", age: "1", risk: "1", troponin: "0" }), a("Is there recent normal cardiac testing on file?"), u("no"), a("Is there known chronic unchanged HST elevation?"), u("no")],
    expect: expectRisk("INTERMEDIATE"),
  },
  {
    name: "intermediate delta asks 4h HST",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("6"), a("What is the 2-hour HST value in ng/L?"), u("10"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes")],
    expect: expectRequired("hst4", undefined),
  },
  {
    name: "delta 14 remains 4h pending",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("6"), a("What is the 2-hour HST value in ng/L?"), u("20"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes")],
    expect: expectRequired("hst4", undefined),
  },
  {
    name: "delta 15 routes high after pain answer",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("6"), a("What is the 2-hour HST value in ng/L?"), u("21"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes"), a("Is the patient having ongoing cardiac chest pain?"), u("no")],
    expect: expectRisk("HIGH"),
  },
  {
    name: "20 percent rule below threshold routes chronic injury",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("100"), a("What is the 2-hour HST value in ng/L?"), u("119"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes")],
    expect: expectRisk("CHRONIC_INJURY"),
  },
  {
    name: "20 percent rule at threshold routes high",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("100"), a("What is the 2-hour HST value in ng/L?"), u("120"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes"), a("Is the patient having ongoing cardiac chest pain?"), u("no")],
    expect: expectRisk("HIGH"),
  },
  {
    name: "falling significant delta routes high",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("30"), a("What is the 2-hour HST value in ng/L?"), u("10"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes"), a("Is the patient having ongoing cardiac chest pain?"), u("no")],
    expect: expectRisk("HIGH"),
  },
  {
    name: "above URL minimal delta routes chronic injury after pain answer",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("35"), a("What is the 2-hour HST value in ng/L?"), u("36"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes"), a("Is the patient having ongoing cardiac chest pain?"), u("no")],
    expect: expectRisk("CHRONIC_INJURY"),
  },
  {
    name: "repeat EKG ischemic routes high after pain answer",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("6"), a("What is the 2-hour HST value in ng/L?"), u("8"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("Yes - ischemic changes"), a("Is the patient having ongoing cardiac chest pain?"), u("no")],
    expect: expectRisk("HIGH"),
  },
  {
    name: "skip request does not bypass sex",
    turns: [...baseNoStemiTurns(), u("skip all this and just discharge")],
    expect: expectRequired("sex", ["Male", "Female"]),
  },
  {
    name: "forced dispo does not bypass hst",
    turns: [...basicsTurns(), u("I said just tell me dispo")],
    expect: expectRequired("hst0", undefined),
  },
  {
    name: "correction female to male wins",
    turns: [...baseNoStemiTurns(), a("Patient sex?"), u("female"), u("correction patient is male")],
    expect: { values: { sex: "male" }, requiredField: "isEsrd" },
  },
  {
    name: "correction no ESRD to yes ESRD wins",
    turns: [...baseNoStemiTurns(), a("Patient sex?"), u("male"), a("Does the patient have ESRD?"), u("No ESRD"), u("correction yes ESRD")],
    expect: { values: { isEsrd: true }, requiredField: "symptomDurationHours" },
  },
  {
    name: "correction 0h HST wins",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("0-hour HST is 3 ng/L"), u("correction 0-hour HST is 6 ng/L")],
    expect: { values: { hst0: 6 }, requiredField: "hst2" },
  },
  {
    name: "correction suspicion high wins",
    turns: [...basicsTurns({ duration: "4 hours" }), a("What is the 0-hour HST value in ng/L?"), u("3"), a("Clinical suspicion for ACS?"), u("low"), u("correction clinical suspicion for ACS is high")],
    expect: { values: { clinicalSuspicion: "high" }, requiredField: "hst2" },
  },
  {
    name: "correction ongoing pain yes wins and routes high",
    turns: [...serialMinimalTurns(), a("Is the patient having ongoing cardiac chest pain?"), u("No ongoing pain"), u("correction chest pain is ongoing")],
    expect: expectRisk("HIGH"),
  },
  {
    name: "trop synonym accepted",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("trop 6 ng/L")],
    expect: expectRequired("hst2", undefined),
  },
  {
    name: "hsTnI synonym accepted",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("hsTnI is 6")],
    expect: expectRequired("hst2", undefined),
  },
  {
    name: "HST timepoint does not fill HEART risk factor",
    turns: [...serialMinimalTurns(), a("Is the patient having ongoing cardiac chest pain?"), u("No ongoing pain. HEART components: age 1, troponin 0. 2-hour HST is 8 ng/L.")],
    expect: { requiredField: "heart.history", absentAcceptedField: "heart.risk_factors" },
  },
  {
    name: "MD says are you stupid at ESRD step and state holds",
    turns: [...baseNoStemiTurns(), a("Patient sex?"), u("male"), a("Does the patient have ESRD?"), u("are you stupid? I already said no stemi")],
    expect: expectRequired("isEsrd", ["Yes - ESRD", "No ESRD"]),
  },
  {
    name: "MD says stop asking after HST and state holds at suspicion",
    turns: [...basicsTurns({ duration: "4 hours" }), a("What is the 0-hour HST value in ng/L?"), u("3"), a("Clinical suspicion for ACS?"), u("stop asking dumb questions")],
    expect: expectRequired("clinicalSuspicion", ["Low", "Moderate", "High"]),
  },
  {
    name: "all-in-one low risk reaches low",
    turns: [u("No STEMI. No ischemic changes. Male. No ESRD. Symptoms started 4 hours ago. 0-hour HST is 3 ng/L. Clinical suspicion for ACS: low.")],
    expect: expectRisk("LOW"),
  },
  {
    name: "all-in-one intermediate reaches intermediate",
    turns: [u("No STEMI. No ischemic changes. Male. No ESRD. Symptoms started 5 hours ago. 0-hour HST is 6 ng/L. 2-hour HST is 8 ng/L. 2-hour repeat EKG ischemic changes: no. No ongoing chest pain. HEART components: history 1, EKG 1, age 1, risk factors 1, troponin 0. No recent normal cardiac testing and no known chronic unchanged HST.")],
    expect: expectRisk("INTERMEDIATE"),
  },
  {
    name: "all-in-one chronic injury reaches chronic injury",
    turns: [u("No STEMI. No ischemic changes. Male. No ESRD. Symptoms started 5 hours ago. 0-hour HST is 35 ng/L. 2-hour HST is 36 ng/L. 2-hour repeat EKG ischemic changes: no. No ongoing chest pain.")],
    expect: expectRisk("CHRONIC_INJURY"),
  },
  {
    name: "all-in-one high ischemic reaches high",
    turns: [u("No STEMI. Yes ischemic changes. Male. No ESRD. Symptoms started 5 hours ago. 0-hour HST is 6 ng/L. 2-hour HST is 8 ng/L. 2-hour repeat EKG ischemic changes: no. No ongoing chest pain.")],
    expect: expectRisk("HIGH"),
  },
  {
    name: "4h follow-up after intermediate asks repeat 4h EKG",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("6"), a("What is the 2-hour HST value in ng/L?"), u("10"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes"), a("What is the 4-hour HST value in ng/L?"), u("5")],
    expect: expectRequired("repeatEkg4h", ["Yes - ischemic changes", "No ischemic changes"]),
  },
  {
    name: "4h follow-up can continue to HEART",
    turns: [...basicsTurns(), a("What is the 0-hour HST value in ng/L?"), u("6"), a("What is the 2-hour HST value in ng/L?"), u("10"), a("Does the repeat 2-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes"), a("What is the 4-hour HST value in ng/L?"), u("5"), a("Does the repeat 4-hour EKG show ischemic ST or T-wave changes?"), u("No ischemic changes"), a("Is the patient having ongoing cardiac chest pain?"), u("No ongoing pain")],
    expect: expectRequired("heart.history", [
      "0 - Slightly suspicious",
      "1 - Moderately suspicious",
      "2 - Highly suspicious",
    ]),
  },
];

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

async function postChat(messages) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${PROD_BASE_URL.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const text = await response.text();
      assert(response.ok, `POST /api/chat returned ${response.status}: ${text.slice(0, 300)}`);
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
      }
    }
  }
  throw lastError;
}

function getResultRisk(state) {
  return state.results?.findLast?.((result) => result.kind === "determine_disposition")?.data?.risk;
}

function getResultAction(state) {
  return state.results?.findLast?.((result) => result.kind === "assess_ekg")?.data?.action;
}

function assertNoUnsafeModelText(stream, caseName) {
  const duplicate = DUPLICATE_PROMPT_PATTERNS.find((pattern) => pattern.test(stream));
  assert(!duplicate, `${caseName}: duplicate/filler prompt matched ${duplicate}`);

  const forbidden = FORBIDDEN_MODEL_DECISION_PATTERNS.find((pattern) => pattern.test(stream));
  assert(!forbidden, `${caseName}: unsafe model decision text matched ${forbidden}`);
}

function assertExpectedState(state, expected, caseName) {
  const stateSummary = () =>
    JSON.stringify(summarizeMdStressState(state));

  if ("requiredField" in expected) {
    assert(
      state.requiredField === expected.requiredField,
      `${caseName}: expected requiredField ${expected.requiredField}, got ${state.requiredField}; state=${stateSummary()}`
    );
  }
  if ("terminal" in expected) {
    assert(
      state.terminal === expected.terminal,
      `${caseName}: expected terminal ${expected.terminal}, got ${state.terminal}; state=${stateSummary()}`
    );
  }
  if (expected.allowedOptions) {
    assert(
      Array.isArray(state.allowedOptions) &&
        state.allowedOptions.join("|") === expected.allowedOptions.join("|"),
      `${caseName}: expected buttons ${expected.allowedOptions.join(", ")}, got ${JSON.stringify(state.allowedOptions)}; state=${stateSummary()}`
    );
  }
  if ("risk" in expected) {
    assert(
      getResultRisk(state) === expected.risk,
      `${caseName}: expected risk ${expected.risk}, got ${getResultRisk(state)}; state=${stateSummary()}`
    );
  }
  if ("action" in expected) {
    assert(
      getResultAction(state) === expected.action,
      `${caseName}: expected action ${expected.action}, got ${getResultAction(state)}; state=${stateSummary()}`
    );
  }
  if (expected.values) {
    for (const [key, value] of Object.entries(expected.values)) {
      assert(
        state.values?.[key] === value,
        `${caseName}: expected values.${key}=${value}, got ${state.values?.[key]}; state=${stateSummary()}`
      );
    }
  }
  if (expected.absentAcceptedField) {
    assert(
      !state.acceptedFields?.includes(expected.absentAcceptedField),
      `${caseName}: did not expect accepted field ${expected.absentAcceptedField}; state=${stateSummary()}`
    );
  }
}

async function runApiCase(testCase) {
  const stream = await postChat(conversation(testCase.turns));
  assertNoUnsafeModelText(stream, testCase.name);
  const state = pathwayStatePart(stream);
  assert(state, `${testCase.name}: stream did not include data-pathway-state`);
  assertExpectedState(state, testCase.expect, testCase.name);
  return buildApiCasePassSummary(testCase.name, state);
}

async function runApiStress() {
  const selected = API_CASES.slice(0, API_LIMIT);
  const outcomes = [];
  let cursor = 0;

  async function worker() {
    while (cursor < selected.length) {
      const index = cursor;
      const testCase = selected[cursor];
      cursor += 1;
      try {
        outcomes[index] = {
          status: "pass",
          summary: await runApiCase(testCase),
        };
      } catch (error) {
        outcomes[index] = {
          status: "fail",
          summary: buildApiCaseFailureSummary(testCase.name, error),
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(API_CONCURRENCY, selected.length) }, () => worker())
  );

  const aggregate = summarizeApiCaseOutcomes(outcomes);
  if (aggregate.failures.length === 0) {
    record(
      `API adversarial controller cases (${selected.length})`,
      "pass",
      `${selected.length} complaining MD API cases passed`
    );
  } else {
    for (const failure of aggregate.failures) {
      record(`API adversarial controller case: ${failure.name}`, "fail", failure.error);
    }
    record(
      `API adversarial controller cases (${selected.length})`,
      "fail",
      `${aggregate.failures.length} of ${selected.length} API case(s) failed`
    );
  }
  return aggregate.apiSummaries;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function candidate(name, locator) {
  return { name, locator };
}

async function visibleEnabledCount(locator) {
  const count = await locator.count();
  let visible = 0;
  let enabled = 0;
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) visible += 1;
    if (await item.isEnabled().catch(() => false)) enabled += 1;
  }
  return { count, visible, enabled };
}

async function browserDiagnostics(page, candidates) {
  const candidateSummary = [];
  for (const entry of candidates) {
    try {
      const counts = await visibleEnabledCount(entry.locator);
      candidateSummary.push(`${entry.name}=${JSON.stringify(counts)}`);
    } catch (error) {
      candidateSummary.push(
        `${entry.name}=error:${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const buttons = await enabledButtonTexts(page).catch(() => []);
  const body = await bodyText(page).catch(() => "");
  return [
    `candidates: ${candidateSummary.join("; ")}`,
    `enabled buttons: ${JSON.stringify(buttons.slice(0, 20))}`,
    `body: ${JSON.stringify(body.slice(-600))}`,
  ].join(" | ");
}

async function firstUsable(
  page,
  label,
  candidates,
  { timeout = 5_000, requireEnabled = true } = {}
) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    for (const entry of candidates) {
      try {
        const count = await entry.locator.count();
        for (let index = 0; index < count; index += 1) {
          const item = entry.locator.nth(index);
          const visible = await item.isVisible().catch(() => false);
          const enabled = requireEnabled
            ? await item.isEnabled().catch(() => false)
            : true;
          if (visible && enabled) return item;
        }
      } catch (error) {
        lastError = error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const details = await browserDiagnostics(page, candidates);
  const suffix = lastError
    ? `; last locator error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    : "";
  throw new Error(`${label}: no usable locator after ${timeout}ms; ${details}${suffix}`);
}

async function chatInput(page) {
  return firstUsable(
    page,
    "chat input",
    [
      candidate("data-testid=chat-input", page.getByTestId("chat-input")),
      candidate("aria-label=Chat input", page.getByLabel("Chat input")),
      candidate(
        "placeholder=Describe findings",
        page.getByPlaceholder(/Describe findings or answer the question/i)
      ),
    ],
    { timeout: STEP_TIMEOUT_MS }
  );
}

async function bodyText(page) {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
}

async function waitForLoadingSettled(page) {
  const loading = page.getByTestId("loading-indicator");
  await loading.waitFor({ state: "attached", timeout: 1_000 }).catch(() => {});
  await loading.waitFor({ state: "detached", timeout: STEP_TIMEOUT_MS }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(BROWSER_SETTLE_MS);
}

async function waitForMessageText(page, pattern, timeout = STEP_TIMEOUT_MS) {
  try {
    await page.getByTestId("message-list").getByText(pattern).last().waitFor({
      state: "visible",
      timeout,
    });
  } catch (error) {
    const text = await bodyText(page).catch(() => "");
    throw new Error(
      `message ${pattern} not visible after ${timeout}ms; body=${JSON.stringify(
        text.slice(-800)
      )}; ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function clickButton(page, label) {
  const exact = new RegExp(`^${escapeRegExp(label)}$`);
  const button = await firstUsable(
    page,
    `button "${label}"`,
    [
      candidate(
        `aria-label=Quick reply: ${label}`,
        page.getByLabel(`Quick reply: ${label}`)
      ),
      candidate(
        `data-testid=quick-reply-button text=${label}`,
        page.getByTestId("quick-reply-button").filter({ hasText: exact })
      ),
      candidate(`role=button name=${label}`, page.getByRole("button", { name: exact })),
    ],
    { timeout: STEP_TIMEOUT_MS }
  );
  await button.click();
  await waitForLoadingSettled(page);
}

async function sendText(page, text) {
  const input = await chatInput(page);
  await input.fill(text);
  assert((await input.inputValue()) === text, `chat input did not accept "${text}"`);
  await input.press("Enter");
  await waitForLoadingSettled(page);
}

async function startPathway(page) {
  await page.goto(PROD_BASE_URL, { waitUntil: "networkidle", timeout: 45_000 });
  await firstUsable(
    page,
    "pathway rail",
    [
      candidate("data-testid=pathway-rail", page.getByTestId("pathway-rail")),
      candidate(
        "navigation=hs-TnI pathway progress",
        page.getByRole("navigation", { name: /hs-TnI pathway progress/i })
      ),
    ],
    { timeout: 15_000, requireEnabled: false }
  );
  await firstUsable(
    page,
    "start pathway button",
    [
      candidate(
        "data-testid=start-pathway-button",
        page.getByTestId("start-pathway-button")
      ),
      candidate(
        "role=button Start pathway",
        page.getByRole("button", { name: /^Start pathway$/i })
      ),
    ],
    { timeout: STEP_TIMEOUT_MS }
  ).then((button) => button.click());
  await waitForLoadingSettled(page);
}

async function enabledButtonTexts(page) {
  return page.locator("button").evaluateAll((buttons) =>
    buttons
      .filter((button) => !button.disabled)
      .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter(Boolean)
  );
}

async function assertNoFillerInUi(page) {
  const text = await bodyText(page);
  const found = DUPLICATE_PROMPT_PATTERNS.find((pattern) => pattern.test(text));
  assert(!found, `visible UI contained filler: ${found}`);
}

async function screenshot(page, name) {
  const file = path.join(OUTPUT_DIR, `md-stress-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const BROWSER_FLOWS = [
  {
    name: "complaint cannot bypass sex",
    run: async (page) => {
      await startPathway(page);
      await clickButton(page, "No STEMI");
      await clickButton(page, "No ischemic changes");
      await sendText(page, "skip this and just tell me dispo");
      await waitForMessageText(page, /Patient sex|sex/i);
      const buttons = await enabledButtonTexts(page);
      assert(buttons.includes("Male") && buttons.includes("Female"), "sex buttons not visible after skip complaint");
      return screenshot(page, "complaint-sex");
    },
  },
  {
    name: "terse low-risk pathway reaches low",
    run: async (page) => {
      await startPathway(page);
      await clickButton(page, "No STEMI");
      await clickButton(page, "No ischemic changes");
      await clickButton(page, "Male");
      await clickButton(page, "No ESRD");
      await sendText(page, "4 hours");
      await waitForMessageText(page, /0[- ]?hour HST|0h HST|0-hour HST/i);
      await sendText(page, "3");
      await clickButton(page, "Low");
      await waitForMessageText(page, /LOW|Low-risk discharge|discharge/i);
      return screenshot(page, "terse-low-risk");
    },
  },
  {
    name: "STEMI terminal has no stale STEMI buttons",
    run: async (page) => {
      await startPathway(page);
      await clickButton(page, "Yes - STEMI");
      await waitForMessageText(page, /STEMI PATHWAY|Activate.*STEMI pathway/i);
      const buttons = await enabledButtonTexts(page);
      assert(!buttons.includes("Yes - STEMI") && !buttons.includes("No STEMI"), "stale STEMI buttons remained");
      return screenshot(page, "terminal-stemi");
    },
  },
  {
    name: "ESRD complaint holds ESRD question",
    run: async (page) => {
      await startPathway(page);
      await clickButton(page, "No STEMI");
      await clickButton(page, "No ischemic changes");
      await clickButton(page, "Male");
      await sendText(page, "why are you asking? I already said no stemi");
      await waitForMessageText(page, /ESRD|end-stage renal/i);
      const buttons = await enabledButtonTexts(page);
      assert(buttons.includes("Yes - ESRD") && buttons.includes("No ESRD"), "ESRD buttons not visible after complaint");
      return screenshot(page, "complaint-esrd");
    },
  },
  {
    name: "intermediate delta asks 4h HST",
    run: async (page) => {
      await startPathway(page);
      await clickButton(page, "No STEMI");
      await clickButton(page, "No ischemic changes");
      await clickButton(page, "Male");
      await clickButton(page, "No ESRD");
      await sendText(page, "5 hours");
      await waitForMessageText(page, /0[- ]?hour HST|0h HST|0-hour HST/i);
      await sendText(page, "6");
      await waitForMessageText(page, /2[- ]?hour HST|2h HST|2-hour HST/i);
      await sendText(page, "10");
      await waitForMessageText(page, /repeat.*2[- ]?hour EKG|2[- ]?hour.*repeat EKG|ischemic ST/i);
      await clickButton(page, "No ischemic changes");
      await waitForMessageText(page, /4[- ]?hour HST|4h HST/i);
      return screenshot(page, "intermediate-4h");
    },
  },
  {
    name: "correction does not leave stale sex buttons",
    run: async (page) => {
      await startPathway(page);
      await clickButton(page, "No STEMI");
      await clickButton(page, "No ischemic changes");
      await clickButton(page, "Female");
      await sendText(page, "correction patient is male");
      await waitForMessageText(page, /ESRD|end-stage renal/i);
      const buttons = await enabledButtonTexts(page);
      assert(!buttons.includes("Male") && !buttons.includes("Female"), "stale sex buttons remained after correction");
      assert(buttons.includes("Yes - ESRD") && buttons.includes("No ESRD"), "ESRD buttons not visible after correction");
      return screenshot(page, "correction-sex");
    },
  },
];

async function runBrowserStress() {
  const selected = BROWSER_FLOWS.slice(0, BROWSER_LIMIT);
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleIssues = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });

  try {
    for (const flow of selected) {
      await runStep(`browser MD stress: ${flow.name}`, async () => {
        const file = await flow.run(page);
        await assertNoFillerInUi(page);
        return `screenshot=${file}`;
      });
    }
    await runStep("browser console health", async () => {
      assert(consoleIssues.length === 0, consoleIssues.join("\n"));
      return "no production console warnings or errors captured";
    });
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  const startedAt = nowIso();
  await mkdir(OUTPUT_DIR, { recursive: true });
  console.log(`MD adversarial production stress started at ${startedAt}`);
  console.log(`Target: ${PROD_BASE_URL}`);
  console.log(`Artifacts: ${OUTPUT_DIR}`);
  console.log(`API cases: ${Math.min(API_LIMIT, API_CASES.length)} of ${API_CASES.length}`);
  console.log(`Browser flows: ${Math.min(BROWSER_LIMIT, BROWSER_FLOWS.length)} of ${BROWSER_FLOWS.length}`);

  const apiSummaries = await runApiStress();
  await runBrowserStress();

  const failed = results.filter((result) => result.status === "fail");
  const summary = {
    target: PROD_BASE_URL,
    startedAt,
    finishedAt: nowIso(),
    apiCasesRun: apiSummaries.length,
    browserFlowsRun: Math.min(BROWSER_LIMIT, BROWSER_FLOWS.length),
    results,
    apiSummaries,
  };
  const summaryFile = path.join(OUTPUT_DIR, "md-stress-summary.json");
  await writeFile(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Summary: ${summaryFile}`);

  if (failed.length > 0) {
    console.error(`${failed.length} MD stress check(s) failed.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
