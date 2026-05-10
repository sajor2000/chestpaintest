import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./system-prompt";

describe("SYSTEM_PROMPT clinical safety framing", () => {
  it("frames the app as a prespecified protocol surface, not an independent clinical decision-maker", () => {
    expect(SYSTEM_PROMPT).toContain("prespecified Rush hs-TnI protocol");
    expect(SYSTEM_PROMPT).toContain("does not make independent clinical decisions");
  });

  it("requires early rule-out to be finalized by the controller before HEART scoring", () => {
    expect(SYSTEM_PROMPT).toContain(
      "If the controller snapshot reports `early_rule_out_eligible: true`"
    );
    expect(SYSTEM_PROMPT).toContain(
      "Do not continue to HEART scoring unless the controller requires it"
    );
  });

  it("forbids treating non-troponin answers as HST values", () => {
    expect(SYSTEM_PROMPT).toContain(
      "NEVER treat symptom duration, onset time, ESRD answers, ongoing-pain answers, sex, or clinical suspicion as a troponin value"
    );
  });

  it("requires explicit clinical suspicion before early rule-out", () => {
    expect(SYSTEM_PROMPT).toContain(
      "NEVER infer clinical suspicion from symptoms or documentation text"
    );
    expect(SYSTEM_PROMPT).toContain(
      "If the controller asks \"Clinical suspicion for ACS?\", ask only that question"
    );
  });

  it("accepts plain typed yes/no answers for the active yes/no step", () => {
    expect(SYSTEM_PROMPT).toContain(
      "If the physician types a plain \"yes\" or \"no\" in response to the current ESRD or ongoing chest-pain question"
    );
    expect(SYSTEM_PROMPT).toContain("Do not ask the same yes/no question again");
  });

  it("accepts a typed HST value as enough source text for the controller", () => {
    expect(SYSTEM_PROMPT).toContain(
      "A typed answer like \"3 ng/L hs-TnI\" is enough source text"
    );
  });

  it("stops after a final non-pending disposition", () => {
    expect(SYSTEM_PROMPT).toContain(
      "After the server controller returns a final risk other than \"PENDING\""
    );
    expect(SYSTEM_PROMPT).toContain(
      "do not offer buttons after a final disposition"
    );
  });

  it("keeps quick-reply prompts visually clean", () => {
    expect(SYSTEM_PROMPT).toContain("ask the question once");
    expect(SYSTEM_PROMPT).toContain(
      "do not repeat the button labels in prose"
    );
    expect(SYSTEM_PROMPT).toContain("The UI already shows the buttons");
    expect(SYSTEM_PROMPT).toContain("I will provide options");
    expect(SYSTEM_PROMPT).toContain(
      "Do not add a second text block that restates the same question"
    );
    expect(SYSTEM_PROMPT).toContain(
      "Do not request buttons for free-text numeric/time questions"
    );
  });
});
