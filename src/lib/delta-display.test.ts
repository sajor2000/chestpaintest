import { describe, expect, it } from "vitest";

import { getDeltaEquation } from "./delta-display";

describe("getDeltaEquation", () => {
  it("formats a rising delta directly from deterministic tool fields", () => {
    expect(
      getDeltaEquation({
        hst_0hr: 2,
        hst_current: 6,
        signed_delta: 4,
        absolute_delta: 4,
      })
    ).toEqual({
      current: "6",
      baseline: "2",
      change: "+4",
      expression: "6 - 2 = +4 ng/L",
      absolute: "4",
    });
  });

  it("formats a falling delta without losing the sign", () => {
    expect(
      getDeltaEquation({
        hst_0hr: 30,
        hst_current: 10,
        signed_delta: -20,
        absolute_delta: 20,
      })
    ).toMatchObject({
      current: "10",
      baseline: "30",
      change: "-20",
      expression: "10 - 30 = -20 ng/L",
      absolute: "20",
    });
  });

  it("falls back to computed delta if signed_delta is absent", () => {
    expect(
      getDeltaEquation({
        hst_0hr: 5,
        hst_current: 5,
        absolute_delta: 0,
      })
    ).toMatchObject({
      change: "0",
      expression: "5 - 5 = 0 ng/L",
      absolute: "0",
    });
  });

  it("returns null when the tool payload has no numeric HST pair", () => {
    expect(getDeltaEquation({ math_summary: "6 - 2 = +4 ng/L" })).toBeNull();
  });
});
