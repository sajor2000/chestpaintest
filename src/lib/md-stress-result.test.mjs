import { describe, expect, it } from "vitest";

import {
  buildApiCaseFailureSummary,
  buildApiCasePassSummary,
  summarizeApiCaseOutcomes,
  summarizeMdStressState,
} from "../../scripts/md-stress-result.mjs";

describe("MD stress result helpers", () => {
  it("summarizes terminal disposition risk from pathway state", () => {
    const summary = summarizeMdStressState({
      requiredField: null,
      terminal: true,
      acceptedFields: ["hst0", "hst2"],
      values: { hst0: 100, hst2: 119 },
      results: [
        { kind: "assess_ekg", data: { action: "CONTINUE" } },
        { kind: "determine_disposition", data: { risk: "CHRONIC_INJURY" } },
      ],
    });

    expect(summary).toMatchObject({
      requiredField: null,
      terminal: true,
      risk: "CHRONIC_INJURY",
      action: "CONTINUE",
      values: { hst0: 100, hst2: 119 },
    });
  });

  it("aggregates multiple API failures instead of stopping at the first one", () => {
    const outcomes = [
      {
        status: "fail",
        summary: buildApiCaseFailureSummary(
          "first failing case",
          new Error("expected hst4, got null")
        ),
      },
      {
        status: "pass",
        summary: buildApiCasePassSummary("passing case", {
          requiredField: "hst4",
          terminal: false,
          results: [],
        }),
      },
      {
        status: "fail",
        summary: buildApiCaseFailureSummary(
          "second failing case",
          "expected HIGH, got LOW"
        ),
      },
    ];

    const aggregate = summarizeApiCaseOutcomes(outcomes);

    expect(aggregate.shouldFail).toBe(true);
    expect(aggregate.apiSummaries).toHaveLength(3);
    expect(aggregate.failures.map((failure) => failure.name)).toEqual([
      "first failing case",
      "second failing case",
    ]);
  });
});
