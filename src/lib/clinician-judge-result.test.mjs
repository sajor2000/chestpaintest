import { describe, expect, it } from "vitest";

import {
  classifyBrowserStatus,
  summarizeClinicianJudgeOutcomes,
} from "../../scripts/clinician-judge-result.mjs";

describe("clinician judge result interpreter", () => {
  it("fails the run when any deterministic case fails", () => {
    const summary = summarizeClinicianJudgeOutcomes(
      [{ deterministicStatus: "FAIL", judgeVerdict: "PASS", browserStatus: "PASS" }],
      "report"
    );

    expect(summary.shouldFail).toBe(true);
    expect(summary.deterministicFailures).toBe(1);
  });

  it("keeps report-mode judge failures non-blocking", () => {
    const summary = summarizeClinicianJudgeOutcomes(
      [{ deterministicStatus: "PASS", judgeVerdict: "FAIL", browserStatus: "PASS" }],
      "report"
    );

    expect(summary.shouldFail).toBe(false);
    expect(summary.judgeFailures).toBe(1);
  });

  it("fails strict mode when the judge fails a case", () => {
    const summary = summarizeClinicianJudgeOutcomes(
      [{ deterministicStatus: "PASS", judgeVerdict: "FAIL", browserStatus: "PASS" }],
      "strict"
    );

    expect(summary.shouldFail).toBe(true);
    expect(summary.judgeFailures).toBe(1);
  });

  it("reports browser blocked separately from clinical failure", () => {
    const summary = summarizeClinicianJudgeOutcomes(
      [
        {
          deterministicStatus: "PASS",
          judgeVerdict: "PASS",
          browserStatus: "BROWSER_BLOCKED",
        },
      ],
      "strict"
    );

    expect(summary.shouldFail).toBe(false);
    expect(summary.browserBlocked).toBe(1);
    expect(classifyBrowserStatus("BROWSER_BLOCKED").clinicalFailure).toBe(false);
  });
});
