import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { resolvePathwayController } from "./pathway-controller";

const userMessage = (text: string): UIMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

const resolve = (texts: string[]) =>
  resolvePathwayController(texts.map(userMessage));

describe("deterministic pathway controller", () => {
  it("starts with the canonical STEMI question and buttons", async () => {
    const snapshot = await resolve(["Start the Rush hs-TnI pathway."]);

    expect(snapshot.step).toBe("ekg");
    expect(snapshot.requiredField).toBe("stemiOrEquivalent");
    expect(snapshot.question).toBe(
      "Does the EKG show STEMI or STEMI equivalent?"
    );
    expect(snapshot.allowedOptions).toEqual(["Yes - STEMI", "No STEMI"]);
    expect(snapshot.terminal).toBe(false);
  });

  it("uses the latest explicit corrections for canonical state", async () => {
    const snapshot = await resolve([
      "Female. No ESRD. Symptoms started 5 hours ago. 0-hour HST is 3 ng/L. Clinical suspicion for ACS is moderate. HEART components: history 0, EKG 0, age 1, risk factors 0, troponin 0. No recent normal cardiac testing and no known chronic unchanged HST.",
      "Correction: patient is male. Yes ESRD. Symptoms started 2 hours ago. 0-hour HST is 6 ng/L. Clinical suspicion for ACS is high. HEART components: history 2, EKG 1, age 2, risk factors 2, troponin 1. Recent normal cardiac testing is present. Chronic unchanged HST is known.",
    ]);

    expect(snapshot.values.sex).toBe("male");
    expect(snapshot.values.isEsrd).toBe(true);
    expect(snapshot.values.symptomDurationHours).toBe(2);
    expect(snapshot.values.hst0).toBe(6);
    expect(snapshot.values.clinicalSuspicion).toBe("high");
    expect(snapshot.values.heartComponents).toEqual({
      history: 2,
      ekg: 1,
      age: 2,
      risk_factors: 2,
      troponin: 1,
    });
    expect(snapshot.values.recentNormalTesting).toBe(true);
    expect(snapshot.values.chronicUnchangedHst).toBe(true);
  });

  it("stops immediately with deterministic STEMI result and no buttons", async () => {
    const snapshot = await resolve(["Yes - STEMI"]);

    expect(snapshot.terminal).toBe(true);
    expect(snapshot.requiredField).toBeNull();
    expect(snapshot.allowedOptions).toEqual([]);
    expect(snapshot.results.at(-1)).toMatchObject({
      kind: "assess_ekg",
      data: { action: "STEMI_PATHWAY", urgent: true },
    });
  });

  it("asks for clinical suspicion when early rule-out needs only explicit suspicion", async () => {
    const snapshot = await resolve([
      "No STEMI. No ischemic changes. Male. No ESRD. Symptoms started 4 hours ago. 0-hour HST is 3 ng/L.",
    ]);

    expect(snapshot.requiredField).toBe("clinicalSuspicion");
    expect(snapshot.step).toBe("troponin0");
    expect(snapshot.allowedOptions).toEqual(["Low", "Moderate", "High"]);
    expect(snapshot.results).toContainEqual(
      expect.objectContaining({
        kind: "evaluate_troponin",
        hour: "0",
        data: expect.objectContaining({ needs_clinical_suspicion: true }),
      })
    );
  });

  it("finalizes early rule-out deterministically after explicit low suspicion", async () => {
    const snapshot = await resolve([
      "No STEMI. No ischemic changes. Male. No ESRD. Symptoms started 4 hours ago. 0-hour HST is 3 ng/L. Clinical suspicion for ACS: low.",
    ]);

    expect(snapshot.step).toBe("disposition");
    expect(snapshot.requiredField).toBeNull();
    expect(snapshot.terminal).toBe(true);
    expect(snapshot.allowedOptions).toEqual([]);
    expect(snapshot.results.at(-1)).toMatchObject({
      kind: "determine_disposition",
      data: { risk: "LOW" },
    });
  });

  it("requires 4-hour HST after intermediate 2-hour delta and repeat EKG", async () => {
    const snapshot = await resolve([
      "No STEMI. No ischemic changes. Male. No ESRD. Symptoms started 5 hours ago. 0-hour HST is 6 ng/L. 2-hour HST is 10 ng/L. Repeat 2-hour EKG has no ischemic changes.",
    ]);

    expect(snapshot.requiredField).toBe("hst4");
    expect(snapshot.step).toBe("delta");
    expect(snapshot.question).toContain("4-hour HST");
    expect(snapshot.results).toContainEqual(
      expect.objectContaining({
        kind: "calculate_delta",
        hour: "2",
        data: expect.objectContaining({ delta_category: "intermediate" }),
      })
    );
  });

  it("walks HEART components one at a time after serial troponin and pain data", async () => {
    const snapshot = await resolve([
      "No STEMI. No ischemic changes. Male. No ESRD. Symptoms started 5 hours ago. 0-hour HST is 6 ng/L. 2-hour HST is 8 ng/L. Repeat 2-hour EKG has no ischemic changes. No ongoing chest pain.",
    ]);

    expect(snapshot.step).toBe("heart");
    expect(snapshot.requiredField).toBe("heart.history");
    expect(snapshot.allowedOptions).toEqual([
      "0 - Slightly suspicious",
      "1 - Moderately suspicious",
      "2 - Highly suspicious",
    ]);
  });

  it("asks low-risk qualifier questions only when HEART is 4 or higher on a below-URL minimal-delta path", async () => {
    const snapshot = await resolve([
      "No STEMI. No ischemic changes. Male. No ESRD. Symptoms started 5 hours ago. 0-hour HST is 6 ng/L. 2-hour HST is 8 ng/L. Repeat 2-hour EKG has no ischemic changes. No ongoing chest pain. HEART components: history 1, EKG 1, age 1, risk factors 1, troponin 0.",
    ]);

    expect(snapshot.requiredField).toBe("recentNormalTesting");
    expect(snapshot.allowedOptions).toEqual([
      "Yes - recent normal testing",
      "No recent normal testing",
    ]);
  });

  it("does not infer HEART components from HST timepoints or partial bundles", async () => {
    const snapshot = await resolve([
      "No STEMI. No ischemic changes. Male. No ESRD. Symptoms started 5 hours ago. 0-hour HST is 6 ng/L. 2-hour HST is 8 ng/L. Repeat 2-hour EKG has no ischemic changes. No ongoing chest pain. HEART components: age 1, troponin 0. 2-hour HST is 8 ng/L.",
    ]);

    expect(snapshot.values.heartComponents).toEqual({ age: 1, troponin: 0 });
    expect(snapshot.requiredField).toBe("heart.history");
  });
});
