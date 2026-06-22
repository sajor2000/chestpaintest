import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

  it("exposes a repeatable HST prototype regression production replay command", () => {
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
    expect(script).toContain("high-value 20 percent delta routes high");
    expect(script).toContain("compound duration advances to 0h HST");
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
