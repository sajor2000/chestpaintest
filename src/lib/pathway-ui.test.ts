import { describe, expect, it } from "vitest";
import { getPathwayStep, normalizeQuickReplyOptions } from "./pathway-ui";

describe("normalizeQuickReplyOptions", () => {
  it("replaces stale sex buttons when the visible question asks about ESRD", () => {
    expect(
      normalizeQuickReplyOptions("Is patient ESRD? Yes or No?", [
        "Male",
        "Female",
      ])
    ).toEqual(["Yes - ESRD", "No ESRD"]);
  });

  it("keeps sex buttons when the visible question asks for sex", () => {
    expect(
      normalizeQuickReplyOptions("What is the patient's sex?", [
        "Male",
        "Female",
      ])
    ).toEqual(["Male", "Female"]);
  });

  it("uses pathway-specific choices for common yes/no questions", () => {
    expect(
      normalizeQuickReplyOptions("Any ischemic ST or T-wave changes?", [
        "Yes",
        "No",
      ])
    ).toEqual(["Yes - ischemic changes", "No ischemic changes"]);
  });
});

describe("getPathwayStep", () => {
  it("identifies patient basics from an ESRD question", () => {
    expect(getPathwayStep("Is patient ESRD? Yes or No?")).toBe("basics");
  });

  it("identifies HEART scoring from HEART questions", () => {
    expect(getPathwayStep("Now calculate HEART score components.")).toBe(
      "heart"
    );
  });
});
