import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./system-prompt";

describe("SYSTEM_PROMPT clinical safety framing", () => {
  it("frames the app as a prespecified protocol surface, not an independent clinical decision-maker", () => {
    expect(SYSTEM_PROMPT).toContain("prespecified Rush hs-TnI protocol");
    expect(SYSTEM_PROMPT).toContain("does not make independent clinical decisions");
  });

  it("requires early rule-out to call disposition before HEART scoring", () => {
    expect(SYSTEM_PROMPT).toContain(
      "If `evaluate_troponin` returns `early_rule_out_eligible: true`"
    );
    expect(SYSTEM_PROMPT).toContain(
      "call `determine_disposition` immediately before asking any HEART score questions"
    );
  });

  it("forbids evaluating troponin before an explicit HST value is provided", () => {
    expect(SYSTEM_PROMPT).toContain(
      "NEVER call `evaluate_troponin` until the physician has explicitly provided an HST, hs-TnI, or troponin value"
    );
    expect(SYSTEM_PROMPT).toContain(
      "Do not treat symptom duration, onset time, ESRD answers, ongoing-pain answers, sex, or clinical suspicion as a troponin value"
    );
  });

  it("requires explicit clinical suspicion before early rule-out", () => {
    expect(SYSTEM_PROMPT).toContain(
      "NEVER infer clinical suspicion from symptoms or documentation text"
    );
    expect(SYSTEM_PROMPT).toContain(
      "Clinical suspicion for ACS: Low, Moderate, or High?"
    );
  });

  it("accepts plain typed yes/no answers for the active yes/no step", () => {
    expect(SYSTEM_PROMPT).toContain(
      "If the physician types a plain \"yes\" or \"no\" in response to the current ESRD or ongoing chest-pain question"
    );
    expect(SYSTEM_PROMPT).toContain("Do not ask the same yes/no question again");
  });

  it("accepts a typed HST value as its own source text", () => {
    expect(SYSTEM_PROMPT).toContain(
      "If the physician types an HST/hs-TnI/troponin answer such as \"3 ng/L hs-TnI\""
    );
    expect(SYSTEM_PROMPT).toContain(
      "Do not ask for a separate source unless the answer lacks any HST, hs-TnI, troponin, or ng/L wording"
    );
  });

  it("stops after a final non-pending disposition", () => {
    expect(SYSTEM_PROMPT).toContain(
      "After `determine_disposition` returns a final risk other than \"PENDING\""
    );
    expect(SYSTEM_PROMPT).toContain(
      "do not call `suggest_followups` after a final disposition"
    );
  });

  it("keeps quick-reply prompts visually clean", () => {
    expect(SYSTEM_PROMPT).toContain("ask the question once");
    expect(SYSTEM_PROMPT).toContain(
      "do not repeat the button labels in prose"
    );
    expect(SYSTEM_PROMPT).toContain("The UI already shows the buttons");
    expect(SYSTEM_PROMPT).toContain(
      "Do not add a second text block that restates the same question"
    );
    expect(SYSTEM_PROMPT).toContain(
      "Do not call `suggest_followups` for free-text numeric/time questions"
    );
  });
});
