import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { buildPathwayStatePrompt, resolvePathwayState } from "./pathway-state";

const userMessage = (text: string): UIMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

describe("server-owned pathway state", () => {
  it("extracts bundled clinician data so the model does not re-ask for sex or earlier fields", () => {
    const state = resolvePathwayState([
      userMessage(
        "Test case: No STEMI or STEMI equivalent. No ischemic ST/T changes. Female. No ESRD. Symptoms started 5 hours ago; no ongoing chest pain. 0-hour HST is 3 ng/L. 2-hour HST is 10 ng/L. Repeat EKG has no ischemic changes. Clinical suspicion for ACS is moderate. HEART components: history 0, EKG 0, age 1, risk factors 0, troponin 0. No recent normal cardiac testing and no known chronic unchanged HST."
      ),
    ]);

    expect(state.fields.sex).toBe("female");
    expect(state.fields.isEsrd).toBe(false);
    expect(state.fields.symptomDurationHours).toBe(5);
    expect(state.fields.hst0).toBe(3);
    expect(state.fields.hst2).toBe(10);
    expect(state.fields.clinicalSuspicion).toBe("moderate");
    expect(state.fields.heartComponents).toEqual({
      history: 0,
      ekg: 0,
      age: 1,
      risk_factors: 0,
      troponin: 0,
    });
    expect(state.missingRequiredFields).not.toContain("sex");
    expect(state.nextAction).toContain("assess_ekg");
    expect(state.nextAction).toContain("calculate_delta");
  });

  it("identifies sex as the next required field after EKG findings only", () => {
    const state = resolvePathwayState([
      userMessage("No STEMI. No ischemic ST or T-wave changes."),
    ]);

    expect(state.fields.stemiOrEquivalent).toBe(false);
    expect(state.fields.ischemicChanges).toBe(false);
    expect(state.missingRequiredFields).toContain("sex");
    expect(state.nextAction).toBe("Ask for patient sex: Male or Female.");
  });

  it("builds a compact server-owned state prompt for the chat route", () => {
    const prompt = buildPathwayStatePrompt([
      userMessage(
        "Female, no ESRD, symptoms started 2 hours ago, 0-hour HST is 6 ng/L, 2-hour HST is 7 ng/L, no ongoing chest pain."
      ),
    ]);

    expect(prompt).toContain("SERVER-OWNED PATHWAY STATE");
    expect(prompt).toContain('"sex":"female"');
    expect(prompt).toContain('"hst0":6');
    expect(prompt).toContain('"hst2":7');
    expect(prompt).toContain("Do not re-ask for fields listed in presentFields");
  });

  it("prefers the latest explicit clinician corrections for scalar pathway fields", () => {
    const state = resolvePathwayState([
      userMessage(
        "Female. No ESRD. Symptoms started 5 hours ago. No ongoing chest pain. 0-hour HST is 3 ng/L. Clinical suspicion for ACS is moderate. No recent normal cardiac testing and no known chronic unchanged HST."
      ),
      userMessage(
        "Correction: patient is male. Yes ESRD. Chest pain is ongoing. Symptoms started 2 hours ago. 0-hour HST is 6 ng/L. Clinical suspicion for ACS is high. Recent normal cardiac testing is present. Chronic unchanged HST is known."
      ),
    ]);

    expect(state.fields.sex).toBe("male");
    expect(state.fields.isEsrd).toBe(true);
    expect(state.fields.ongoingChestPain).toBe(true);
    expect(state.fields.symptomDurationHours).toBe(2);
    expect(state.fields.hst0).toBe(6);
    expect(state.fields.clinicalSuspicion).toBe("high");
    expect(state.fields.recentNormalTesting).toBe(true);
    expect(state.fields.chronicUnchangedHst).toBe(true);
  });

  it("prefers the latest explicit HST correction for each timepoint", () => {
    const state = resolvePathwayState([
      userMessage(
        "Female. No ESRD. Symptoms started 5 hours ago. 0-hour HST is 3 ng/L. 2-hour HST is 10 ng/L. 4-hour HST is 8 ng/L."
      ),
      userMessage(
        "Correction: 0-hour HST is 6 ng/L. 2-hour HST is 7 ng/L. 4-hour HST is 9 ng/L."
      ),
    ]);

    expect(state.fields.hst0).toBe(6);
    expect(state.fields.hst2).toBe(7);
    expect(state.fields.hst4).toBe(9);
  });

  it("does not infer HEART EKG from age text or HST timepoints", () => {
    expect(
      resolvePathwayState([userMessage("HEART components: age 1, troponin 0.")])
        .fields.heartComponents
    ).toEqual({ age: 1, troponin: 0 });

    expect(
      resolvePathwayState([userMessage("2-hour HST is 7 ng/L.")]).fields
        .heartComponents
    ).toBeUndefined();
  });

  it("keeps partial HEART component bundles partial instead of filling missing components", () => {
    const state = resolvePathwayState([
      userMessage("HEART components: history 0, age 1, troponin 0."),
    ]);

    expect(state.fields.heartComponents).toEqual({
      history: 0,
      age: 1,
      troponin: 0,
    });
    expect(state.presentFields).toContain("heart.history");
    expect(state.presentFields).toContain("heart.age");
    expect(state.presentFields).toContain("heart.troponin");
    expect(state.presentFields).not.toContain("heart.ekg");
    expect(state.presentFields).not.toContain("heart.risk_factors");
  });
});
