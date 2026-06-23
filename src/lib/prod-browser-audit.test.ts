import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  HST_WORD_DOCUMENT_CASE_COUNT,
  HST_WORD_DOCUMENT_CASES,
} from "../../scripts/hst-word-document-cases.mjs";

describe("production browser audit harness", () => {
  it("exposes a repeatable production audit command with safe artifact defaults", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const script = readFileSync("scripts/audit-prod-browser.mjs", "utf8");

    expect(packageJson.scripts?.["audit:prod:browser"]).toBe(
      "node scripts/audit-prod-browser.mjs"
    );
    expect(script).toContain("https://rush-chest-pain-cds.vercel.app");
    expect(script).toContain("output/playwright");
    expect(script).toContain("PROD_BASE_URL");
    expect(script).toContain("30 canonical decision-tree cases");
  });

  it("exposes a repeatable MD adversarial production stress command", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const script = readFileSync("scripts/audit-prod-md-stress.mjs", "utf8");

    expect(packageJson.scripts?.["audit:prod:md-stress"]).toBe(
      "node scripts/audit-prod-md-stress.mjs"
    );
    expect(script).toContain("MD_STRESS_API_LIMIT");
    expect(script).toContain("MD_STRESS_BROWSER_LIMIT");
    expect(script).toContain("MD_STRESS_BROWSER_SETTLE_MS");
    expect(script).toContain("data-pathway-state");
    expect(script).toContain("output/md-stress");
    expect(script).toContain("complaining MD");
    expect(script).toContain("enabled buttons");
    expect(script).toContain("no usable locator after");
    expect(script).toContain(
      "20 percent rule below threshold routes chronic injury"
    );
    expect(script).toContain('expectRisk("CHRONIC_INJURY")');
    expect(script).toContain("summarizeApiCaseOutcomes");
  });

  it("exposes a repeatable HST Word-document production replay command", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const script = readFileSync("scripts/audit-prod-hst-regressions.mjs", "utf8");

    expect(packageJson.scripts?.["audit:prod:hst-regressions"]).toBe(
      "node scripts/audit-prod-hst-regressions.mjs"
    );
    expect(script).toContain("output/hst-regressions");
    expect(script).toContain("PROD_BASE_URL");
    expect(script).toContain("data-pathway-state");
    expect(script).toContain("HST production Word-document replay");
    expect(script).toContain("HST_REPLAY_TIMEOUT_MS");
    expect(script).toContain("AbortController");
    expect(script).toContain("HST_WORD_DOCUMENT_CASES");
    expect(HST_WORD_DOCUMENT_CASE_COUNT).toBe(13);
    expect(HST_WORD_DOCUMENT_CASES.map((testCase) => testCase.name)).toEqual([
      "Case 1: classic STEMI routes STEMI pathway",
      "Case 1b: de Winter STEMI equivalent routes STEMI pathway",
      "Case 2: low-risk early rule-out routes low",
      "Case 3: significant 2hr absolute delta below URL routes high",
      "Case 4: falling significant delta routes high without ongoing-pain prompt",
      "Case 5: high-value 20 percent delta routes high",
      "Case 6: intermediate 4hr branch stays intermediate, not chronic injury",
      "Case 7: significant 4hr delta routes high",
      "Case 8: stable chronic troponin elevation routes chronic injury",
      "Case 9: ESRD requires mandatory 2hr draw",
      "Case 10: symptoms under 4hr require repeat HST",
      "Case 11: female above-URL minimal delta routes chronic injury",
      "General bug: compound duration advances to 0h HST",
    ]);
    expect(
      HST_WORD_DOCUMENT_CASES.find((testCase) => testCase.name.startsWith("Case 1b"))
        ?.messages
    ).toEqual(["de Winter pattern."]);
  });

  it("exposes a report-first clinician LLM judge harness", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const script = readFileSync("scripts/audit-clinician-judge.mjs", "utf8");

    expect(packageJson.scripts?.["audit:clinician-judge"]).toBe(
      "node scripts/audit-clinician-judge.mjs"
    );
    expect(script).toContain("output/clinician-judge");
    expect(script).toContain("CLINICIAN_JUDGE");
    expect(script).toContain("CLINICIAN_BROWSER_LIMIT");
    expect(script).toContain("PROD_BASE_URL");
    expect(script).toContain("evaluateApiFaithfulness");
    expect(script).toContain("evaluateBrowserFaithfulness");
    expect(script).toContain("pathway faithfulness");
    expect(script).toContain(
      "Do not decide whether the Rush protocol is clinically correct"
    );
  });
});
