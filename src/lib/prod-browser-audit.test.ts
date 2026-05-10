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
});
