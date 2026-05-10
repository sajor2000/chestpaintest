import { describe, expect, it } from "vitest";
import {
  cleanQuickReplyPromptText,
  cleanRepeatedQuestionText,
  getStepGuidance,
  getPathwayStep,
  isDuplicateQuickReplyPromptText,
  normalizeQuickReplyOptions,
} from "./pathway-ui";

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

  it("does not replace HEART troponin score buttons when text mentions female URL", () => {
    const options = ["0 - Normal", "1 - 1–3× URL", "2 - >3× URL"];

    expect(
      normalizeQuickReplyOptions(
        "The 0hr HST was 12 ng/L (female 99% URL = 14), which is at or below normal. I'd suggest scoring this 0 — do you agree?",
        options
      )
    ).toEqual(options);
  });

  it("does not replace HEART troponin score buttons when text mentions male URL", () => {
    const options = ["0 - Normal", "1 - 1–3× URL", "2 - >3× URL"];

    expect(
      normalizeQuickReplyOptions(
        "The 0hr HST was 40 ng/L (male 99% URL = 35), which is above normal. Troponin score for HEART?",
        options
      )
    ).toEqual(options);
  });

  it("still recognizes a direct male or female sex question", () => {
    expect(
      normalizeQuickReplyOptions("Male or female?", ["Male", "Female"])
    ).toEqual(["Male", "Female"]);
  });

  it("does not replace HEART EKG score buttons when summary mentions STEMI or ischemic changes", () => {
    const options = [
      "0 - Normal",
      "1 - Non-specific changes",
      "2 - Significant ST deviation",
    ];

    expect(
      normalizeQuickReplyOptions(
        "No STEMI or ischemic ST changes on the EKG. EKG score for HEART?",
        options
      )
    ).toEqual(options);
  });

  it("does not replace free-text HST entry when summary mentions ESRD", () => {
    expect(
      normalizeQuickReplyOptions(
        "Patient is female with no ESRD. What was the initial HST value?",
        ["Enter HST value"]
      )
    ).toEqual([]);
  });

  it("suppresses stale sex buttons on a free-text hs-TnI value prompt", () => {
    expect(
      normalizeQuickReplyOptions(
        "Please provide the 0-hour hs-TnI (high-sensitivity troponin I) value in ng/L.",
        ["Male", "Female"]
      )
    ).toEqual([]);
  });

  it("suppresses stale ESRD buttons on a free-text symptom duration prompt", () => {
    expect(
      normalizeQuickReplyOptions("What is the duration of symptoms in hours?", [
        "Yes - ESRD",
        "No ESRD",
      ])
    ).toEqual([]);

    expect(
      normalizeQuickReplyOptions(
        "When did the chest pain start? Please provide hours since onset.",
        ["Yes - ESRD", "No ESRD"]
      )
    ).toEqual([]);
  });

  it("keeps ongoing chest pain buttons because that symptom question is binary", () => {
    expect(
      normalizeQuickReplyOptions("Is the patient having ongoing chest pain?", [
        "Yes",
        "No",
      ])
    ).toEqual(["Yes - ongoing pain", "No ongoing pain"]);
  });

  it("suppresses follow-up buttons after a final low-risk disposition card", () => {
    expect(
      normalizeQuickReplyOptions(
        "LOW-RISK DISCHARGE PATHWAY CONFIRMED\nDischarge with follow-up.\nIs the chest pain still ongoing?",
        ["Yes - ongoing pain", "No ongoing pain"]
      )
    ).toEqual([]);
  });

  it("suppresses fallback buttons after a terminal STEMI pathway result", () => {
    expect(
      normalizeQuickReplyOptions(
        "STEMI or equivalent identified. Activate the STEMI pathway immediately. The Rush hs-TnI pathway stops here.",
        []
      )
    ).toEqual([]);
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
        "Please provide a brief symptom description.",
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

  it("returns ESRD fallback buttons when the model omits tool options", () => {
    expect(
      normalizeQuickReplyOptions(
        "Does the patient have end-stage renal disease (ESRD)?",
        []
      )
    ).toEqual(["Yes - ESRD", "No ESRD"]);
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

  it("keeps symptom duration prompts in patient basics", () => {
    expect(getPathwayStep("How many hours have the symptoms been present?")).toBe(
      "basics"
    );
  });
});

describe("getStepGuidance", () => {
  it("returns physician-facing guidance for the active pathway step", () => {
    expect(getStepGuidance("troponin0")).toMatchObject({
      title: "0-hour HST",
      needNow: expect.stringContaining("0-hour HST"),
      why: expect.stringContaining("sex-specific"),
    });

    expect(getStepGuidance("disposition").watchFor).toContain(
      "treating physician"
    );
  });
});

describe("quick-reply prompt cleanup", () => {
  it("removes duplicated button-helper prose from visible assistant text", () => {
    expect(
      cleanQuickReplyPromptText(
        "Hello. Does the EKG show STEMI or STEMI equivalent?\n\nI will provide buttons for quick replies."
      )
    ).toBe("Hello. Does the EKG show STEMI or STEMI equivalent?");

    expect(
      cleanQuickReplyPromptText(
        "Next, patient sex: Male or Female? I'll provide quick buttons for response."
      )
    ).toBe("Next, patient sex: Male or Female?");

    expect(
      cleanQuickReplyPromptText(
        "Hello. Does the EKG show STEMI or STEMI equivalent? I will provide options."
      )
    ).toBe("Hello. Does the EKG show STEMI or STEMI equivalent?");

    expect(
      cleanQuickReplyPromptText(
        "Does the EKG show STEMI or STEMI equivalent?\n(functions.suggest_followups)"
      )
    ).toBe("Does the EKG show STEMI or STEMI equivalent?");
  });

  it("detects duplicate follow-up text after quick-reply buttons", () => {
    expect(
      isDuplicateQuickReplyPromptText(
        "Does the EKG show STEMI or STEMI equivalent? (Please select)",
        "Hello. Does the EKG show STEMI or STEMI equivalent?",
        ["Yes - STEMI", "No STEMI"]
      )
    ).toBe(true);

    expect(
      isDuplicateQuickReplyPromptText(
        "Please specify patient sex: Male or Female?",
        "Next, patient sex: Male or Female?",
        ["Male", "Female"]
      )
    ).toBe(true);
  });

  it("collapses repeated adjacent free-text questions", () => {
    expect(
      cleanRepeatedQuestionText(
        "What is the symptom duration in hours? Please provide the number of hours since chest pain onset.What is the symptom duration in hours? Please provide the number of hours since chest pain onset."
      )
    ).toBe(
      "What is the symptom duration in hours? Please provide the number of hours since chest pain onset."
    );
  });

  it("hides stale follow-up text when stale buttons were suppressed for a free-text prompt", () => {
    expect(
      isDuplicateQuickReplyPromptText(
        "Please confirm: Does the patient have ESRD?",
        "What is the symptom duration in hours?",
        ["Yes - ESRD", "No ESRD"]
      )
    ).toBe(true);
  });

  it("keeps non-duplicate clinical text after quick-reply buttons", () => {
    expect(
      isDuplicateQuickReplyPromptText(
        "Noted ischemic ST/T changes (Footnote A) on EKG. Next, patient sex: Male or Female?",
        "Are there ischemic ST or T-wave changes?",
        ["Male", "Female"]
      )
    ).toBe(false);
  });
});
