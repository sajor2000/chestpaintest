import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const PROD_BASE_URL =
  process.env.PROD_BASE_URL ?? "https://rush-chest-pain-cds.vercel.app";
const OUTPUT_DIR = path.resolve("output/playwright");
const STEP_TIMEOUT_MS = Number(process.env.PROD_AUDIT_STEP_TIMEOUT_MS ?? 90_000);
const HEADLESS = process.env.HEADLESS !== "false";

const DUPLICATE_PROMPT_PATTERNS = [
  /I will provide (?:buttons|options)/i,
  /I'?ll provide (?:buttons|options)/i,
  /quick replies/i,
  /Options:/i,
  /Please select/i,
];

const CANONICAL_DECISION_TREE_CASES = [
  "01 STEMI/EQV routes immediately to STEMI pathway",
  "02 no STEMI with ischemic ST/T changes flags cardiology consult and high-risk disposition",
  "03 no STEMI and no ischemic ST/T changes continues to troponin workup",
  "04 male HST at 35 ng/L is at or above the male 99% URL",
  "05 female HST at 14 ng/L is at or above the female 99% URL",
  "06 early rule-out criteria route to low risk with NPV footnote",
  "07 HST equal to 5 ng/L does not meet the less-than-5 early rule-out gate",
  "08 symptom duration equal to 3 hours does not meet the greater-than-3-hour gate",
  "09 moderate suspicion blocks early rule-out despite HST less than 5 and symptoms over 3 hours",
  "10 missing explicit low-suspicion answer keeps early rule-out pending for clinician answer",
  "11 ESRD blocks early rule-out and emits the ESRD footnote",
  "12 HST greater than 200 ng/L emits the PPV footnote",
  "13 delta less than 4 routes to minimal delta",
  "14 delta 4 to 14 routes to intermediate delta",
  "15 absolute delta 15 or more routes to significant delta",
  "16 HST 100 or more uses 20 percent significant delta rule",
  "17 intermediate delta without 4-hour result stays pending",
  "18 intermediate delta with 4-hour result can proceed to disposition",
  "19 symptoms less than 4 hours require repeat HST",
  "20 above URL with minimal delta routes chronic injury when unchanged",
  "21 above URL with significant delta routes high risk",
  "22 ongoing chest pain routes high risk",
  "23 HEART less than 4 supports low risk",
  "24 HEART 4 or more blocks low-risk HEART criterion",
  "25 recent normal testing supports low risk",
  "26 chronic unchanged HST supports low risk",
  "27 low risk requires no high-risk EKG or pain flags",
  "28 ischemic EKG remains high risk despite low HEART score",
  "29 ESRD and early rule-out attempt remains intermediate or pending",
  "30 final dispositions stop additional pathway questioning",
];

const results = [];

function nowIso() {
  return new Date().toISOString();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function record(name, status, detail = "") {
  results.push({ name, status, detail });
  const marker = status === "pass" ? "PASS" : status === "warn" ? "WARN" : "FAIL";
  console.log(`${marker} ${name}${detail ? ` - ${detail}` : ""}`);
}

async function runStep(name, fn) {
  try {
    const detail = await fn();
    record(name, "pass", detail);
  } catch (error) {
    record(name, "fail", error instanceof Error ? error.message : String(error));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function firstUsable(locators, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    for (const locator of locators) {
      try {
        const count = await locator.count();
        for (let index = 0; index < count; index += 1) {
          const candidate = locator.nth(index);
          if (await candidate.isVisible().catch(() => false)) return candidate;
        }
      } catch (error) {
        lastError = error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error("No usable locator found");
}

async function messageList(page) {
  return firstUsable([
    page.getByTestId("message-list"),
    page.locator("body"),
  ]);
}

async function chatInput(page) {
  return firstUsable([
    page.getByTestId("chat-input"),
    page.getByLabel("Chat input"),
    page.getByPlaceholder(/Describe findings or answer the question/i),
  ]);
}

async function waitForAppReady(page) {
  await firstUsable([
    page.getByTestId("pathway-rail"),
    page.getByRole("navigation", { name: /hs-TnI pathway progress/i }),
  ], 15_000);
  await firstUsable([
    page.getByTestId("guided-cds-panel"),
    page.getByRole("region", { name: /Current CDS guidance/i }),
  ], 15_000);
  await firstUsable([
    page.getByTestId("message-list"),
    page.getByText(/Ready to guide you through/i),
    page.locator("body"),
  ], 15_000);
}

async function waitForLoadingSettled(page) {
  const loading = page.getByTestId("loading-indicator");
  await loading.waitFor({ state: "attached", timeout: 1_000 }).catch(() => {});
  await loading.waitFor({ state: "detached", timeout: STEP_TIMEOUT_MS }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const input = document.querySelector(
          '[data-testid="chat-input"], input[placeholder*="Describe findings"], input[aria-label="Chat input"]'
        );
        return input instanceof HTMLInputElement && !input.disabled;
      },
      undefined,
      { timeout: STEP_TIMEOUT_MS }
    )
    .catch(() => {});
  await page.waitForTimeout(250);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

async function waitForMessageText(page, pattern, timeout = STEP_TIMEOUT_MS) {
  const list = await messageList(page);
  await list.getByText(pattern).last().waitFor({ state: "visible", timeout });
}

async function bodyText(page) {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
}

async function assertNoDuplicatePromptFiller(page) {
  const text = await bodyText(page);
  const found = DUPLICATE_PROMPT_PATTERNS.find((pattern) => pattern.test(text));
  assert(!found, `duplicate prompt filler matched ${found}`);
}

async function clickButton(page, label) {
  const exact = new RegExp(`^${escapeRegExp(label)}$`);
  const button = await firstUsable([
    page.getByLabel(`Quick reply: ${label}`),
    page.getByTestId("quick-reply-button").filter({ hasText: exact }),
    page.getByRole("button", { name: exact }),
  ], STEP_TIMEOUT_MS);
  await button.click();
  await waitForLoadingSettled(page);
}

async function startPathway(page) {
  const button = await firstUsable([
    page.getByTestId("start-pathway-button"),
    page.getByRole("button", { name: /^Start pathway$/i }),
  ], STEP_TIMEOUT_MS);
  await button.click();
  await waitForLoadingSettled(page);
  await waitForMessageText(page, /Does the EKG show STEMI or STEMI equivalent/i);
}

async function sendText(page, text) {
  const input = await chatInput(page);
  await input.fill(text);
  assert((await input.inputValue()) === text, `chat input did not accept "${text}"`);
  await input.press("Enter");
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

async function assertNoEnabledButtons(page, labels) {
  const enabled = await enabledButtonTexts(page);
  const stale = labels.filter((label) => enabled.includes(label));
  assert(stale.length === 0, `stale enabled buttons remain: ${stale.join(", ")}`);
}

async function screenshot(page, name) {
  const file = path.join(OUTPUT_DIR, `prod-audit-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function openFresh(page, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.goto(PROD_BASE_URL, { waitUntil: "networkidle", timeout: 45_000 });
  await waitForAppReady(page);
}

async function runBrowserAudit(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleIssues = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });

  await runStep("load production app", async () => {
    await openFresh(page);
    const title = await page.title();
    assert(title.includes("Chest Pain CDS"), `unexpected page title: ${title}`);
    const text = await bodyText(page);
    assert(
      /Current protocol step|Why this node matters|Guardrail/i.test(text),
      "guided CDS panel did not render"
    );
    await assertNoDuplicatePromptFiller(page);
    const file = await screenshot(page, "desktop-initial");
    return `title="${title}", screenshot=${file}`;
  });

  await runStep("STEMI button flow reaches terminal state without stale buttons", async () => {
    await openFresh(page);
    await startPathway(page);
    await clickButton(page, "Yes - STEMI");
    await waitForMessageText(page, /STEMI PATHWAY|Activate.*STEMI pathway/i);
    await assertNoEnabledButtons(page, ["Yes - STEMI", "No STEMI"]);
    await assertNoDuplicatePromptFiller(page);
    const file = await screenshot(page, "stemi-terminal");
    return `screenshot=${file}`;
  });

  await runStep("ESRD regression flow advances to symptom duration without stale buttons", async () => {
    await openFresh(page);
    await startPathway(page);
    await clickButton(page, "No STEMI");
    await clickButton(page, "Yes - ischemic changes");
    await clickButton(page, "Male");
    await clickButton(page, "No ESRD");
    await waitForMessageText(page, /symptom duration|duration of symptoms/i);
    await assertNoEnabledButtons(page, ["Yes - ESRD", "No ESRD"]);
    await assertNoDuplicatePromptFiller(page);
    const file = await screenshot(page, "esrd-advanced");
    return `screenshot=${file}`;
  });

  await runStep("typed low-risk UI flow reaches final disposition", async () => {
    await openFresh(page);
    await startPathway(page);
    await clickButton(page, "No STEMI");
    await clickButton(page, "No ischemic changes");
    await clickButton(page, "Male");
    await clickButton(page, "No ESRD");
    await sendText(page, "4 hours");
    await waitForMessageText(page, /0[- ]?hour|HST|hs-TnI|troponin/i);
    await sendText(page, "3");
    await waitForMessageText(
      page,
      /clinical suspicion|LOW|Low-risk discharge|discharge/i,
      STEP_TIMEOUT_MS
    );

    const textAfterHst = await bodyText(page);
    if (/clinical suspicion/i.test(textAfterHst)) {
      const hasLowButton = await page.getByRole("button", { name: /^Low$/ }).count();
      if (hasLowButton > 0) {
        await clickButton(page, "Low");
      } else {
        await sendText(page, "Low");
      }
    }

    await waitForMessageText(page, /LOW|Low-risk discharge|discharge/i, STEP_TIMEOUT_MS);
    await assertNoDuplicatePromptFiller(page);
    const file = await screenshot(page, "typed-low-risk");
    return `screenshot=${file}`;
  });

  await runStep("mobile production smoke renders without console errors", async () => {
    await openFresh(page, { width: 390, height: 844 });
    await firstUsable([
      page.getByTestId("chat-input"),
      page.getByPlaceholder(/Describe findings or answer the question/i),
    ], 10_000);
    const file = await screenshot(page, "mobile-initial");
    return `screenshot=${file}`;
  });

  await page.close();

  await runStep("console health", async () => {
    assert(consoleIssues.length === 0, consoleIssues.join("\n"));
    return "no production console warnings or errors captured";
  });
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
      assert(
        response.ok,
        `POST /api/chat returned ${response.status}: ${text.slice(0, 300)}`
      );
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

function uiMessage(id, role, text) {
  return { id, role, parts: [{ type: "text", text }] };
}

async function runApiAudit() {
  await runStep("production API start prompt has no duplicate quick-reply filler", async () => {
    const stream = await postChat([
      uiMessage("u1", "user", "Start the Rush hs-TnI pathway."),
    ]);
    assert(/STEMI|EKG|ECG|pathway/i.test(stream), "start response did not look like pathway guidance");
    const found = DUPLICATE_PROMPT_PATTERNS.find((pattern) => pattern.test(stream));
    assert(!found, `stream contained duplicate prompt filler: ${found}`);
    return "POST /api/chat start prompt passed";
  });

  await runStep("production API STEMI path returns terminal STEMI language", async () => {
    const stream = await postChat([
      uiMessage("u1", "user", "Start the Rush hs-TnI pathway."),
      uiMessage("a1", "assistant", "Does the EKG show STEMI or STEMI equivalent?"),
      uiMessage("u2", "user", "Yes - STEMI"),
    ]);
    assert(/STEMI/i.test(stream), "STEMI response did not mention STEMI");
    assert(/pathway|activate|protocol stops/i.test(stream), "STEMI response did not look terminal");
    return "POST /api/chat STEMI terminal smoke passed";
  });

  record(
    "30 canonical decision-tree cases production API representation",
    "warn",
    `${CANONICAL_DECISION_TREE_CASES.length} canonical cases remain verified by src/__tests__/pathway-decision-tree-30.test.ts; the live chat API has no deterministic tool-call injection seam, so the harness reports this instead of treating nondeterministic LLM replay as proof.`
  );
}

async function main() {
  const startedAt = nowIso();
  await mkdir(OUTPUT_DIR, { recursive: true });
  console.log(`Production browser audit started at ${startedAt}`);
  console.log(`Target: ${PROD_BASE_URL}`);
  console.log(`Artifacts: ${OUTPUT_DIR}`);

  const browser = await chromium.launch({ headless: HEADLESS });
  try {
    await runBrowserAudit(browser);
  } finally {
    await browser.close();
  }

  await runApiAudit();

  const failed = results.filter((result) => result.status === "fail");
  const summary = {
    target: PROD_BASE_URL,
    startedAt,
    finishedAt: nowIso(),
    results,
    canonicalDecisionTreeCases: CANONICAL_DECISION_TREE_CASES,
  };
  const summaryFile = path.join(OUTPUT_DIR, "prod-browser-audit-summary.json");
  await writeFile(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Summary: ${summaryFile}`);

  if (failed.length > 0) {
    console.error(`${failed.length} production audit check(s) failed.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
