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

  it("picks the latest match when text mentions STEMI then asks about sex", () => {
    expect(
      normalizeQuickReplyOptions(
        "No STEMI identified. What is the patient's sex?",
        ["Male", "Female"]
      )
    ).toEqual(["Male", "Female"]);
  });

  it("picks the latest match when text mentions ischemic then asks about ESRD", () => {
    expect(
      normalizeQuickReplyOptions(
        "No ischemic changes noted. Does the patient have ESRD?",
        ["Yes", "No"]
      )
    ).toEqual(["Yes - ESRD", "No ESRD"]);
  });

  it("uses pathway-specific choices for common yes/no questions", () => {
    expect(
      normalizeQuickReplyOptions("Any ischemic ST or T-wave changes?", [
        "Yes",
        "No",
      ])
    ).toEqual(["Yes - ischemic changes", "No ischemic changes"]);
  });

  it("STEMI + ischemic summary then sex question → Male/Female", () => {
    expect(
      normalizeQuickReplyOptions(
        "No STEMI or ischemic ST changes on the EKG. What is the patient's sex?",
        ["Male", "Female"]
      )
    ).toEqual(["Male", "Female"]);
  });

  it("STEMI + sex summary then ESRD question → ESRD buttons", () => {
    expect(
      normalizeQuickReplyOptions(
        "No STEMI. Patient is male. Does the patient have ESRD?",
        ["Yes", "No"]
      )
    ).toEqual(["Yes - ESRD", "No ESRD"]);
  });

  it("troponin summary then clinical suspicion question → Low/Moderate/High", () => {
    expect(
      normalizeQuickReplyOptions(
        "HST is 3 ng/L, below the male 99% URL. What is your clinical suspicion for ACS?",
        ["Low", "Moderate", "High"]
      )
    ).toEqual(["Low", "Moderate", "High"]);
  });

  it("multiple prior mentions then ongoing chest pain question → pain buttons", () => {
    expect(
      normalizeQuickReplyOptions(
        "ESRD confirmed. HST above URL. Is the patient having ongoing chest pain?",
        ["Yes", "No"]
      )
    ).toEqual(["Yes - ongoing pain", "No ongoing pain"]);
  });

  it("falls through to tool options when no rule matches", () => {
    expect(
      normalizeQuickReplyOptions(
        "What was the troponin value?",
        ["Enter value"]
      )
    ).toEqual(["Enter value"]);
  });

  it("STEMI alone still gets STEMI buttons", () => {
    expect(
      normalizeQuickReplyOptions(
        "Does the EKG show STEMI or STEMI equivalent?",
        ["Yes", "No"]
      )
    ).toEqual(["Yes - STEMI", "No STEMI"]);
  });

  it("ischemic alone still gets ischemic buttons", () => {
    expect(
      normalizeQuickReplyOptions(
        "Are there any ischemic ST or T-wave changes?",
        ["Yes", "No"]
      )
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

  it("does not false-match 'heart' in clinical text", () => {
    expect(getPathwayStep("The patient has a heart rate of 88 bpm.")).toBe(
      "ekg"
    );
  });

  it("identifies disposition only from specific terms", () => {
    expect(getPathwayStep("Calling determine_disposition for final risk.")).toBe(
      "disposition"
    );
  });

  it("does not jump to disposition on 'discharge' in summary", () => {
    expect(
      getPathwayStep("No STEMI. The patient is male, no ESRD. Now let's get the initial troponin.")
    ).toBe("troponin0");
  });
});
