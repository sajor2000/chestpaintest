/**
 * Rush hs-TnI Pathway Tests
 *
 * Source of truth: "HIGH SENSITIVITY TROP I ALGORITHM" PDF
 * Every test references the specific PDF decision node it validates.
 */
import { describe, it, expect } from "vitest";

// Import the tool execute functions directly
// We call .execute() on each tool's returned object
import {
  assessEkg,
  evaluateTroponin,
  calculateDelta,
  calculateHeartScore,
  determineDisposition,
} from "../lib/tools";

// Helper: call tool execute with args
const ekg = (args: Parameters<typeof assessEkg.execute>[0]) =>
  assessEkg.execute(args, { toolCallId: "t", messages: [], abortSignal: undefined as unknown as AbortSignal });
const trop = (args: Parameters<typeof evaluateTroponin.execute>[0]) =>
  evaluateTroponin.execute(args, { toolCallId: "t", messages: [], abortSignal: undefined as unknown as AbortSignal });
const delta = (args: Parameters<typeof calculateDelta.execute>[0]) =>
  calculateDelta.execute(args, { toolCallId: "t", messages: [], abortSignal: undefined as unknown as AbortSignal });
const heart = (args: Parameters<typeof calculateHeartScore.execute>[0]) =>
  calculateHeartScore.execute(args, { toolCallId: "t", messages: [], abortSignal: undefined as unknown as AbortSignal });
const dispo = (args: Parameters<typeof determineDisposition.execute>[0]) =>
  determineDisposition.execute(args, { toolCallId: "t", messages: [], abortSignal: undefined as unknown as AbortSignal });

// ============================================================
// PDF Node: "STEMI/EQV?" diamond at top of flowchart
// ============================================================
describe("assess_ekg — PDF: STEMI/EQV decision diamond", () => {
  it("STEMI → routes to STEMI PATHWAY", async () => {
    const r = await ekg({ stemi_or_equivalent: true, ischemic_changes: false });
    expect(r.action).toBe("STEMI_PATHWAY");
    expect(r.urgent).toBe(true);
  });

  it("STEMI equivalent → routes to STEMI PATHWAY", async () => {
    const r = await ekg({ stemi_or_equivalent: true, ischemic_changes: true });
    expect(r.action).toBe("STEMI_PATHWAY");
  });

  it("NO STEMI, no ischemic changes → CONTINUE", async () => {
    const r = await ekg({ stemi_or_equivalent: false, ischemic_changes: false });
    expect(r.action).toBe("CONTINUE");
    expect(r.cardiology_consult).toBe(false);
    expect(r.footnote).toBeNull();
  });

  // PDF Footnote A: "Ischemic ST or T changes → early cardiology consult"
  it("NO STEMI, ischemic ST/T changes → CONTINUE + cardiology consult (Footnote A)", async () => {
    const r = await ekg({ stemi_or_equivalent: false, ischemic_changes: true });
    expect(r.action).toBe("CONTINUE");
    expect(r.cardiology_consult).toBe(true);
    expect(r.footnote).toContain("cardiology consult");
  });
});

// ============================================================
// PDF: 99% URL thresholds box — Males 35 ng/L, Females 14 ng/L
// ============================================================
describe("evaluate_troponin — PDF: 99% URL thresholds", () => {
  it("Male 99% URL = 35 ng/L — value 34 is below", async () => {
    const r = await trop({ value: 34, hour: "0", sex: "male", is_esrd: false });
    expect(r.above_url).toBe(false);
    expect(r.url_99_threshold).toBe(35);
  });

  it("Male 99% URL = 35 ng/L — value 35 is AT (≥)", async () => {
    const r = await trop({ value: 35, hour: "0", sex: "male", is_esrd: false });
    expect(r.above_url).toBe(true);
  });

  it("Male 99% URL = 35 ng/L — value 36 is above", async () => {
    const r = await trop({ value: 36, hour: "0", sex: "male", is_esrd: false });
    expect(r.above_url).toBe(true);
  });

  it("Female 99% URL = 14 ng/L — value 13 is below", async () => {
    const r = await trop({ value: 13, hour: "0", sex: "female", is_esrd: false });
    expect(r.above_url).toBe(false);
    expect(r.url_99_threshold).toBe(14);
  });

  it("Female 99% URL = 14 ng/L — value 14 is AT (≥)", async () => {
    const r = await trop({ value: 14, hour: "0", sex: "female", is_esrd: false });
    expect(r.above_url).toBe(true);
  });
});

// ============================================================
// PDF: Early rule-out box — "<5ng/L, Sx >3hr, & Low Suspicion ACS"
// PDF Footnote B: "NPV for MI is 99.5%"
// ============================================================
describe("evaluate_troponin — PDF: Early MI rule-out", () => {
  it("HST <5, Sx >3hr, low suspicion, 0hr, not ESRD → eligible", async () => {
    const r = await trop({
      value: 3,
      hour: "0",
      sex: "male",
      is_esrd: false,
      symptom_duration_hours: 4,
      clinical_suspicion: "low",
    });
    expect(r.early_rule_out_eligible).toBe(true);
    expect(r.footnotes).toContain("NPV for MI is 99.5%.");
  });

  it("HST = 5 (not < 5) → NOT eligible", async () => {
    const r = await trop({
      value: 5,
      hour: "0",
      sex: "male",
      is_esrd: false,
      symptom_duration_hours: 4,
      clinical_suspicion: "low",
    });
    expect(r.early_rule_out_eligible).toBe(false);
  });

  it("HST <5 but Sx = 3hr (not > 3hr) → NOT eligible", async () => {
    const r = await trop({
      value: 3,
      hour: "0",
      sex: "male",
      is_esrd: false,
      symptom_duration_hours: 3,
      clinical_suspicion: "low",
    });
    expect(r.early_rule_out_eligible).toBe(false);
  });

  it("HST <5 but moderate suspicion → NOT eligible", async () => {
    const r = await trop({
      value: 3,
      hour: "0",
      sex: "male",
      is_esrd: false,
      symptom_duration_hours: 5,
      clinical_suspicion: "moderate",
    });
    expect(r.early_rule_out_eligible).toBe(false);
  });

  it("HST <5 but hour = 2 (not 0hr draw) → NOT eligible", async () => {
    const r = await trop({
      value: 3,
      hour: "2",
      sex: "male",
      is_esrd: false,
      symptom_duration_hours: 5,
      clinical_suspicion: "low",
    });
    expect(r.early_rule_out_eligible).toBe(false);
  });

  // PDF Footnote C: "ALL ESRD patients need 2hr HST"
  it("HST <5, all criteria met, but ESRD → NOT eligible (Footnote C)", async () => {
    const r = await trop({
      value: 3,
      hour: "0",
      sex: "male",
      is_esrd: true,
      symptom_duration_hours: 5,
      clinical_suspicion: "low",
    });
    expect(r.early_rule_out_eligible).toBe(false);
    expect(r.footnotes).toContain("ALL ESRD patients need 2hr HST.");
  });
});

// ============================================================
// PDF Footnote D: "0 hr Trop >200 has a PPV of 70% for MI"
// ============================================================
describe("evaluate_troponin — PDF Footnote D: PPV at >200", () => {
  it("HST = 200 → does NOT trigger PPV flag (>200, not ≥200)", async () => {
    const r = await trop({ value: 200, hour: "0", sex: "male", is_esrd: false });
    expect(r.flags.some((f: string) => f.includes("PPV 70%"))).toBe(false);
  });

  it("HST = 201 → triggers PPV 70% flag", async () => {
    const r = await trop({ value: 201, hour: "0", sex: "male", is_esrd: false });
    expect(r.flags.some((f: string) => f.includes("PPV 70%"))).toBe(true);
  });
});

// ============================================================
// PDF: Significant delta box
// "2hr = 15 ng/L, 4hr = 15 ng/L, HST ≥ 100 use 20%"
// PDF Footnote G: "change can be in either direction"
// ============================================================
describe("calculate_delta — PDF: Significant delta rules", () => {
  // Absolute rule: delta ≥ 15 ng/L when both values < 100
  it("2hr absolute delta = 15 → significant", async () => {
    const r = await delta({ hst_0hr: 10, hst_current: 25, hour: "2" });
    expect(r.significant).toBe(true);
    expect(r.absolute_delta).toBe(15);
  });

  it("2hr absolute delta = 14 → NOT significant", async () => {
    const r = await delta({ hst_0hr: 10, hst_current: 24, hour: "2" });
    expect(r.significant).toBe(false);
    expect(r.absolute_delta).toBe(14);
  });

  it("4hr absolute delta = 15 → significant", async () => {
    const r = await delta({ hst_0hr: 5, hst_current: 20, hour: "4" });
    expect(r.significant).toBe(true);
  });

  // PDF Footnote G: declining HST can indicate recent MI
  it("Falling delta ≥ 15 → significant (direction = falling)", async () => {
    const r = await delta({ hst_0hr: 30, hst_current: 10, hour: "2" });
    expect(r.significant).toBe(true);
    expect(r.direction).toBe("falling");
  });

  it("Unchanged values → NOT significant, direction = unchanged", async () => {
    const r = await delta({ hst_0hr: 20, hst_current: 20, hour: "2" });
    expect(r.significant).toBe(false);
    expect(r.direction).toBe("unchanged");
  });

  // PDF: "HST ≥ 100, use 20%"
  it("HST ≥ 100 uses 20% rule — 20% change → significant", async () => {
    const r = await delta({ hst_0hr: 100, hst_current: 125, hour: "2" });
    // delta = 25, denominator = min(100,125) = 100, pct = 25% ≥ 20%
    expect(r.significant).toBe(true);
    expect(r.method).toContain("20% change rule");
  });

  it("HST ≥ 100, 19% change → NOT significant", async () => {
    const r = await delta({ hst_0hr: 100, hst_current: 119, hour: "2" });
    // delta = 19, denominator = 100, pct = 19% < 20%
    expect(r.significant).toBe(false);
  });

  it("HST ≥ 100, exactly 20% → significant", async () => {
    const r = await delta({ hst_0hr: 100, hst_current: 120, hour: "2" });
    // delta = 20, denominator = 100, pct = 20% ≥ 20%
    expect(r.significant).toBe(true);
  });

  it("High value falling: hst_0hr=150, hst_current=110 → 20% rule", async () => {
    const r = await delta({ hst_0hr: 150, hst_current: 110, hour: "2" });
    // delta = 40, denominator = min(110,150) = 110, pct = 36.4% ≥ 20%
    expect(r.significant).toBe(true);
    expect(r.direction).toBe("falling");
  });

  // Edge case: hst_0hr = 0 (P0 fix verification)
  it("0hr = 0, current = 150 → significant (inherently)", async () => {
    const r = await delta({ hst_0hr: 0, hst_current: 150, hour: "2" });
    expect(r.significant).toBe(true);
    expect(r.method).toContain("inherently significant");
  });

  it("0hr = 0, current = 5 → absolute rule, delta 5 < 15 → NOT significant", async () => {
    const r = await delta({ hst_0hr: 0, hst_current: 5, hour: "2" });
    expect(r.significant).toBe(false);
  });

  // Boundary: max_value exactly 100 triggers % rule
  it("max_value = 100 exactly → uses 20% rule", async () => {
    const r = await delta({ hst_0hr: 80, hst_current: 100, hour: "2" });
    expect(r.method).toContain("20% change rule");
  });

  // Boundary: max_value = 99 → uses absolute rule
  it("max_value = 99 → uses absolute rule", async () => {
    const r = await delta({ hst_0hr: 80, hst_current: 99, hour: "2" });
    expect(r.method).toContain("Absolute delta rule");
  });
});

// ============================================================
// PDF: HEART Score box — "Calculate HEART SCORE"
// PDF Footnote E: "Heart Score ≥4 OR high clinical suspicion
//                  consider additional testing"
// ============================================================
describe("calculate_heart_score — PDF: HEART Score", () => {
  it("All zeros → score 0, Low risk", async () => {
    const r = await heart({ history: 0, ekg: 0, age: 0, risk_factors: 0, troponin: 0 });
    expect(r.total).toBe(0);
    expect(r.risk_level).toBe("Low");
    expect(r.footnote).toBeNull();
  });

  it("Score 3 → Low risk (boundary)", async () => {
    const r = await heart({ history: 1, ekg: 1, age: 1, risk_factors: 0, troponin: 0 });
    expect(r.total).toBe(3);
    expect(r.risk_level).toBe("Low");
    expect(r.footnote).toBeNull();
  });

  it("Score 4 → Moderate risk + Footnote E", async () => {
    const r = await heart({ history: 2, ekg: 1, age: 1, risk_factors: 0, troponin: 0 });
    expect(r.total).toBe(4);
    expect(r.risk_level).toBe("Moderate");
    expect(r.footnote).toContain("additional testing");
  });

  it("Score 6 → Moderate risk (boundary)", async () => {
    const r = await heart({ history: 2, ekg: 2, age: 2, risk_factors: 0, troponin: 0 });
    expect(r.total).toBe(6);
    expect(r.risk_level).toBe("Moderate");
  });

  it("Score 7 → High risk", async () => {
    const r = await heart({ history: 2, ekg: 2, age: 2, risk_factors: 1, troponin: 0 });
    expect(r.total).toBe(7);
    expect(r.risk_level).toBe("High");
  });

  it("Max score 10 → High risk", async () => {
    const r = await heart({ history: 2, ekg: 2, age: 2, risk_factors: 2, troponin: 2 });
    expect(r.total).toBe(10);
    expect(r.risk_level).toBe("High");
  });
});

// ============================================================
// PDF: Disposition paths — the final risk stratification
// Tests every terminal node in the flowchart
// ============================================================

const baseDispo = {
  any_troponin_above_url: false,
  significant_delta: false,
  ekg_ischemic_changes: false,
  ongoing_chest_pain: false,
  heart_score: 2,
  symptom_duration_hours: 5,
  is_esrd: false,
  recent_normal_testing: false,
  chronic_unchanged_hst: false,
  early_rule_out: false,
};

describe("determine_disposition — PDF: Early MI rule-out path", () => {
  // PDF: "<5ng/L, Sx >3hr, & Low Suspicion ACS" → "MI ruled out"
  it("Early rule-out met → LOW risk, discharge", async () => {
    const r = await dispo({ ...baseDispo, early_rule_out: true });
    expect(r.risk).toBe("LOW");
    expect(r.disposition).toContain("Discharge");
    expect(r.footnotes).toContain("NPV for MI is 99.5%.");
    expect(r.recommendations).toContain(
      "Review return precautions for recurrent, worsening, or persistent chest pain."
    );
  });

  // PDF Footnote C: ESRD blocks early rule-out
  it("Early rule-out + ESRD → BLOCKED, not low risk", async () => {
    const r = await dispo({ ...baseDispo, early_rule_out: true, is_esrd: true });
    expect(r.risk).not.toBe("LOW");
    expect(r.footnotes).toContain("ALL ESRD patients need 2hr HST.");
  });
});

describe("determine_disposition — PDF: High Risk paths", () => {
  // PDF High Risk box: "1. Significant delta"
  it("Significant delta alone → HIGH, admit", async () => {
    const r = await dispo({ ...baseDispo, significant_delta: true });
    expect(r.risk).toBe("HIGH");
    expect(r.disposition).toContain("Admit");
  });

  // PDF High Risk box: "2. EKG changes"
  it("EKG ischemic changes alone → HIGH, admit", async () => {
    const r = await dispo({ ...baseDispo, ekg_ischemic_changes: true });
    expect(r.risk).toBe("HIGH");
    expect(r.disposition).toContain("Admit");
  });

  // PDF High Risk box: "3. On-going cardiac CP"
  it("Ongoing cardiac chest pain alone → HIGH, admit", async () => {
    const r = await dispo({ ...baseDispo, ongoing_chest_pain: true });
    expect(r.risk).toBe("HIGH");
    expect(r.disposition).toContain("Admit");
  });

  // PDF: "0 or 2hr ≥Sex Specific 99%URL" + "Significant delta YES"
  // → Cardiology Evaluation → HIGH
  it("Above URL + significant delta → HIGH, admit", async () => {
    const r = await dispo({
      ...baseDispo,
      any_troponin_above_url: true,
      significant_delta: true,
    });
    expect(r.risk).toBe("HIGH");
    expect(r.disposition).toContain("Admit");
  });

  // All three high-risk features combined
  it("All high-risk features → HIGH", async () => {
    const r = await dispo({
      ...baseDispo,
      significant_delta: true,
      ekg_ischemic_changes: true,
      ongoing_chest_pain: true,
    });
    expect(r.risk).toBe("HIGH");
    expect(r.rationale).toContain("Significant troponin delta");
    expect(r.rationale).toContain("Ischemic EKG changes");
    expect(r.rationale).toContain("Ongoing cardiac chest pain");
  });
});

describe("determine_disposition — PDF: Above URL without delta", () => {
  // PDF: "0 or 2hr ≥Sex Specific 99%URL" → "Significant delta NO" → "Chronic Injury"
  // But only if chronic unchanged HST; otherwise intermediate
  it("Above URL, no significant delta → INTERMEDIATE (observation)", async () => {
    const r = await dispo({ ...baseDispo, any_troponin_above_url: true });
    expect(r.risk).toBe("INTERMEDIATE");
    expect(r.disposition).toContain("Observation");
  });
});

describe("determine_disposition — PDF: Low Risk after 4hr path", () => {
  // PDF: "No significant delta AND *" with conditions:
  // "1. Recent normal testing, 2. Chronic unchanged HST elevation, 3. Heart Score <4"

  it("No delta, below URL, HEART <4, recent normal testing → LOW", async () => {
    const r = await dispo({
      ...baseDispo,
      heart_score: 2,
      recent_normal_testing: true,
    });
    expect(r.risk).toBe("LOW");
    expect(r.disposition).toContain("Discharge");
    expect(r.recommendations).toContain(
      "Arrange outpatient follow-up according to local chest pain pathway practice."
    );
  });

  it("No delta, below URL, HEART <4, chronic unchanged HST → CHRONIC_INJURY", async () => {
    const r = await dispo({
      ...baseDispo,
      heart_score: 2,
      chronic_unchanged_hst: true,
    });
    expect(r.risk).toBe("CHRONIC_INJURY");
    expect(r.disposition).toContain("Evaluate etiology");
  });

  // HEART ≥ 4 blocks the low-risk path even with recent normal testing
  it("No delta, below URL, HEART = 4, recent normal testing → INTERMEDIATE (not low)", async () => {
    const r = await dispo({
      ...baseDispo,
      heart_score: 4,
      recent_normal_testing: true,
    });
    expect(r.risk).toBe("INTERMEDIATE");
  });
});

describe("determine_disposition — PDF: Intermediate Risk", () => {
  // PDF: "Not meeting criteria for low or high risk"
  it("No high-risk features, no low-risk criteria → INTERMEDIATE", async () => {
    const r = await dispo(baseDispo);
    expect(r.risk).toBe("INTERMEDIATE");
    expect(r.disposition).toContain("Observation");
  });

  // Below URL, delta not significant, HEART ≥4, no recent testing
  it("HEART ≥4, no recent testing, no chronic → INTERMEDIATE", async () => {
    const r = await dispo({ ...baseDispo, heart_score: 5 });
    expect(r.risk).toBe("INTERMEDIATE");
  });
});

// ============================================================
// PDF: Disposition text box
// "Low Risk → Discharge with F/U"
// "Intermediate Risk → Observation with additional testing"
// "Chronic Injury → Evaluate etiology"
// "High Risk → Admit"
// ============================================================
describe("determine_disposition — PDF: Disposition text matches", () => {
  it("LOW → 'Discharge with follow-up'", async () => {
    const r = await dispo({ ...baseDispo, early_rule_out: true });
    expect(r.disposition).toBe("Discharge with follow-up.");
  });

  it("INTERMEDIATE → 'Observation with additional testing'", async () => {
    const r = await dispo(baseDispo);
    expect(r.disposition).toBe("Observation with additional testing.");
  });

  it("CHRONIC_INJURY → 'Evaluate etiology'", async () => {
    const r = await dispo({
      ...baseDispo,
      heart_score: 2,
      chronic_unchanged_hst: true,
    });
    expect(r.disposition).toBe("Evaluate etiology.");
  });

  it("HIGH → 'Admit'", async () => {
    const r = await dispo({ ...baseDispo, significant_delta: true });
    expect(r.disposition).toBe("Admit.");
  });
});

// ============================================================
// PDF: Full pathway scenarios — end-to-end traces through the flowchart
// ============================================================
describe("Full pathway scenarios against PDF flowchart", () => {
  it("Scenario 1: Female, no STEMI, HST 3, Sx >3hr, low suspicion → MI ruled out", async () => {
    const ekgR = await ekg({ stemi_or_equivalent: false, ischemic_changes: false });
    expect(ekgR.action).toBe("CONTINUE");

    const tropR = await trop({
      value: 3, hour: "0", sex: "female", is_esrd: false,
      symptom_duration_hours: 4, clinical_suspicion: "low",
    });
    expect(tropR.early_rule_out_eligible).toBe(true);
    expect(tropR.above_url).toBe(false);

    const dispoR = await dispo({
      any_troponin_above_url: false, significant_delta: false,
      ekg_ischemic_changes: false, ongoing_chest_pain: false,
      heart_score: 1, symptom_duration_hours: 4, is_esrd: false,
      recent_normal_testing: false, chronic_unchanged_hst: false,
      early_rule_out: true,
    });
    expect(dispoR.risk).toBe("LOW");
    expect(dispoR.disposition).toContain("Discharge");
  });

  it("Scenario 2: Male, ST depressions, HST 0hr=45, 2hr=80 → significant delta → Admit", async () => {
    const ekgR = await ekg({ stemi_or_equivalent: false, ischemic_changes: true });
    expect(ekgR.cardiology_consult).toBe(true);

    const trop0 = await trop({ value: 45, hour: "0", sex: "male", is_esrd: false });
    expect(trop0.above_url).toBe(true); // 45 ≥ 35

    const trop2 = await trop({ value: 80, hour: "2", sex: "male", is_esrd: false });
    expect(trop2.above_url).toBe(true);

    const deltaR = await delta({ hst_0hr: 45, hst_current: 80, hour: "2" });
    expect(deltaR.absolute_delta).toBe(35);
    expect(deltaR.significant).toBe(true); // 35 ≥ 15
    expect(deltaR.direction).toBe("rising");

    const dispoR = await dispo({
      any_troponin_above_url: true, significant_delta: true,
      ekg_ischemic_changes: true, ongoing_chest_pain: false,
      heart_score: 6, symptom_duration_hours: 2, is_esrd: false,
      recent_normal_testing: false, chronic_unchanged_hst: false,
      early_rule_out: false,
    });
    expect(dispoR.risk).toBe("HIGH");
    expect(dispoR.disposition).toBe("Admit.");
  });

  it("Scenario 3: Male, 0hr=8, 2hr=12 (delta 4), 4hr=18 (delta 10 from 0hr) → Intermediate", async () => {
    // 2hr delta
    const delta2 = await delta({ hst_0hr: 8, hst_current: 12, hour: "2" });
    expect(delta2.absolute_delta).toBe(4);
    expect(delta2.significant).toBe(false); // 4 < 15

    // PDF: "0hr & 2hr HST <99% URL & delta 4-14" → "4hr HST & repeat EKG"
    // 4hr delta from 0hr
    const delta4 = await delta({ hst_0hr: 8, hst_current: 18, hour: "4" });
    expect(delta4.absolute_delta).toBe(10);
    expect(delta4.significant).toBe(false); // 10 < 15

    // Not meeting low (no recent testing, HEART ≥ 4) or high → INTERMEDIATE
    const dispoR = await dispo({
      any_troponin_above_url: false, significant_delta: false,
      ekg_ischemic_changes: false, ongoing_chest_pain: false,
      heart_score: 4, symptom_duration_hours: 2, is_esrd: false,
      recent_normal_testing: false, chronic_unchanged_hst: false,
      early_rule_out: false,
    });
    expect(dispoR.risk).toBe("INTERMEDIATE");
  });

  it("Scenario 4: STEMI on EKG → immediate STEMI pathway", async () => {
    const ekgR = await ekg({ stemi_or_equivalent: true, ischemic_changes: false });
    expect(ekgR.action).toBe("STEMI_PATHWAY");
    // No further pathway steps should be taken
  });

  it("Scenario 5: ESRD, HST <5 → cannot early rule-out, must get 2hr", async () => {
    const tropR = await trop({
      value: 3, hour: "0", sex: "male", is_esrd: true,
      symptom_duration_hours: 5, clinical_suspicion: "low",
    });
    expect(tropR.early_rule_out_eligible).toBe(false);
    expect(tropR.flags.some((f: string) => f.includes("ESRD"))).toBe(true);

    // Even if LLM erroneously passes early_rule_out=true
    const dispoR = await dispo({
      ...baseDispo,
      is_esrd: true,
      early_rule_out: true,
    });
    expect(dispoR.risk).not.toBe("LOW");
  });

  it("Scenario 6: Chronic unchanged HST, no delta, HEART <4 → Chronic Injury", async () => {
    const dispoR = await dispo({
      any_troponin_above_url: false, significant_delta: false,
      ekg_ischemic_changes: false, ongoing_chest_pain: false,
      heart_score: 2, symptom_duration_hours: 6, is_esrd: false,
      recent_normal_testing: false, chronic_unchanged_hst: true,
      early_rule_out: false,
    });
    expect(dispoR.risk).toBe("CHRONIC_INJURY");
    expect(dispoR.disposition).toBe("Evaluate etiology.");
  });

  it("Scenario 7: High-value troponin using 20% rule — 0hr=120, 2hr=150", async () => {
    const deltaR = await delta({ hst_0hr: 120, hst_current: 150, hour: "2" });
    // delta = 30, denominator = min(120,150) = 120, pct = 25% ≥ 20%
    expect(deltaR.significant).toBe(true);
    expect(deltaR.method).toContain("20%");

    const dispoR = await dispo({
      any_troponin_above_url: true, significant_delta: true,
      ekg_ischemic_changes: false, ongoing_chest_pain: false,
      heart_score: 5, symptom_duration_hours: 3, is_esrd: false,
      recent_normal_testing: false, chronic_unchanged_hst: false,
      early_rule_out: false,
    });
    expect(dispoR.risk).toBe("HIGH");
  });

  it("Scenario 8: PDF right branch — above URL, no significant delta, no chronic → INTERMEDIATE", async () => {
    // PDF: "0 or 2hr ≥Sex Specific 99%URL" → "Significant delta NO" → if not chronic → should be intermediate
    const dispoR = await dispo({
      any_troponin_above_url: true, significant_delta: false,
      ekg_ischemic_changes: false, ongoing_chest_pain: false,
      heart_score: 3, symptom_duration_hours: 5, is_esrd: false,
      recent_normal_testing: false, chronic_unchanged_hst: false,
      early_rule_out: false,
    });
    expect(dispoR.risk).toBe("INTERMEDIATE");
  });
});
