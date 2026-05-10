/**
 * 30-case decision-tree audit against the original Rush hs-TnI pathway image.
 *
 * Source node map:
 * - STEMI/EQV -> STEMI pathway
 * - No STEMI with ischemic ST/T changes -> early cardiology consult
 * - 0-hour HST with sex-specific 99% URL thresholds
 * - Early MI rule-out: HST <5, symptoms >3hr, low suspicion ACS
 * - ESRD and >200 ng/L footnote guards
 * - 2-hour / 4-hour delta lanes: <4, 4-14, significant delta
 * - Terminal dispositions: Low, Intermediate, Chronic Injury, High, Pending repeat/4hr
 */
import { describe, expect, it } from "vitest";

import {
  assessEkg,
  calculateDelta,
  determineDisposition,
  evaluateTroponin,
} from "../lib/tools";

const toolCtx = {
  toolCallId: "decision-tree-audit",
  abortSignal: undefined as unknown as AbortSignal,
};

const ekg = (args: Parameters<typeof assessEkg.execute>[0]) =>
  assessEkg.execute(args, { ...toolCtx, messages: [] });

type TropArgs = Omit<
  Parameters<typeof evaluateTroponin.execute>[0],
  "value_source"
> & {
  value_source?: string;
  messages?: Parameters<typeof evaluateTroponin.execute>[1]["messages"];
};

const trop = ({ messages, ...args }: TropArgs) => {
  const clinicalSuspicionSource =
    args.clinical_suspicion_source ??
    (args.clinical_suspicion
      ? `Clinical suspicion for ACS: ${args.clinical_suspicion}`
      : undefined);

  return evaluateTroponin.execute(
    {
      ...args,
      value_source: args.value_source ?? `${args.value} ng/L HST`,
      clinical_suspicion_source: clinicalSuspicionSource,
    },
    {
      ...toolCtx,
      messages:
        messages ??
        (clinicalSuspicionSource
          ? [{ role: "user" as const, content: clinicalSuspicionSource }]
          : []),
    }
  );
};

const delta = (args: Parameters<typeof calculateDelta.execute>[0]) =>
  calculateDelta.execute(args, { ...toolCtx, messages: [] });

const baseDisposition = {
  any_troponin_above_url: false,
  ekg_ischemic_changes: false,
  ongoing_chest_pain: false,
  heart_score: 5,
  symptom_duration_hours: 5,
  is_esrd: false,
  recent_normal_testing: false,
  chronic_unchanged_hst: false,
  early_rule_out: false,
  delta_range: "minimal" as const,
  has_4hr_result: false,
};

type DispositionArgs = Parameters<typeof determineDisposition.execute>[0] & {
  messages?: Parameters<typeof determineDisposition.execute>[1]["messages"];
};

const disposition = ({ messages, ...args }: DispositionArgs) =>
  determineDisposition.execute(args, {
    ...toolCtx,
    messages:
      messages ??
      (args.early_rule_out
        ? [{ role: "user" as const, content: "Clinical suspicion for ACS: low." }]
        : []),
  });

describe("original pathway decision tree audit — 30 named cases", () => {
  it("01 STEMI/EQV routes immediately to STEMI pathway", async () => {
    const result = await ekg({ stemi_or_equivalent: true, ischemic_changes: false });

    expect(result.action).toBe("STEMI_PATHWAY");
    expect(result.urgent).toBe(true);
  });

  it("02 no STEMI with ischemic ST/T changes flags cardiology consult and high-risk disposition", async () => {
    const ekgResult = await ekg({
      stemi_or_equivalent: false,
      ischemic_changes: true,
    });
    const final = await disposition({
      ...baseDisposition,
      ekg_ischemic_changes: true,
    });

    expect(ekgResult.action).toBe("CONTINUE");
    expect(ekgResult.cardiology_consult).toBe(true);
    expect(ekgResult.footnote).toContain("early cardiology consult");
    expect(final.risk).toBe("HIGH");
    expect(final.footnotes).toContain("Ischemic ST or T changes → early cardiology consult.");
  });

  it("03 no STEMI and no ischemic ST/T changes continues to troponin workup", async () => {
    const result = await ekg({
      stemi_or_equivalent: false,
      ischemic_changes: false,
    });

    expect(result.action).toBe("CONTINUE");
    expect(result.cardiology_consult).toBe(false);
    expect(result.footnote).toBeNull();
  });

  it("04 male HST at 35 ng/L is at or above the male 99% URL", async () => {
    const result = await trop({ value: 35, hour: "0", sex: "male", is_esrd: false });

    expect(result.url_99_threshold).toBe(35);
    expect(result.above_url).toBe(true);
  });

  it("05 female HST at 14 ng/L is at or above the female 99% URL", async () => {
    const result = await trop({ value: 14, hour: "0", sex: "female", is_esrd: false });

    expect(result.url_99_threshold).toBe(14);
    expect(result.above_url).toBe(true);
  });

  it("06 early rule-out criteria route to low risk with NPV footnote", async () => {
    const troponin = await trop({
      value: 3,
      hour: "0",
      sex: "male",
      is_esrd: false,
      symptom_duration_hours: 4,
      clinical_suspicion: "low",
    });
    const final = await disposition({
      ...baseDisposition,
      early_rule_out: troponin.early_rule_out_eligible,
    });

    expect(troponin.early_rule_out_eligible).toBe(true);
    expect(final.risk).toBe("LOW");
    expect(final.footnotes).toContain("NPV for MI is 99.5%.");
  });

  it("07 HST equal to 5 ng/L does not meet the less-than-5 early rule-out gate", async () => {
    const result = await trop({
      value: 5,
      hour: "0",
      sex: "male",
      is_esrd: false,
      symptom_duration_hours: 4,
      clinical_suspicion: "low",
    });

    expect(result.early_rule_out_eligible).toBe(false);
  });

  it("08 symptom duration equal to 3 hours does not meet the greater-than-3-hour gate", async () => {
    const result = await trop({
      value: 3,
      hour: "0",
      sex: "male",
      is_esrd: false,
      symptom_duration_hours: 3,
      clinical_suspicion: "low",
    });

    expect(result.early_rule_out_eligible).toBe(false);
  });

  it("09 moderate suspicion blocks early rule-out despite HST less than 5 and symptoms over 3 hours", async () => {
    const result = await trop({
      value: 3,
      hour: "0",
      sex: "male",
      is_esrd: false,
      symptom_duration_hours: 4,
      clinical_suspicion: "moderate",
    });

    expect(result.early_rule_out_eligible).toBe(false);
    expect(result.needs_clinical_suspicion).toBe(false);
  });

  it("10 missing explicit low-suspicion answer keeps early rule-out pending for clinician answer", async () => {
    const result = await trop({
      value: 3,
      hour: "0",
      sex: "male",
      is_esrd: false,
      symptom_duration_hours: 4,
    });

    expect(result.early_rule_out_eligible).toBe(false);
    expect(result.needs_clinical_suspicion).toBe(true);
  });

  it("11 ESRD blocks early rule-out and emits the ESRD footnote", async () => {
    const result = await trop({
      value: 3,
      hour: "0",
      sex: "male",
      is_esrd: true,
      symptom_duration_hours: 4,
      clinical_suspicion: "low",
    });

    expect(result.early_rule_out_eligible).toBe(false);
    expect(result.footnotes).toContain("ALL ESRD patients need 2hr HST.");
  });

  it("12 0-hour HST above 200 emits the PPV 70% footnote", async () => {
    const result = await trop({
      value: 201,
      hour: "0",
      sex: "male",
      is_esrd: false,
    });

    expect(result.flags.some((flag: string) => flag.includes("PPV 70%"))).toBe(true);
    expect(result.footnotes).toContain("0hr Trop >200 has a PPV of 70% for MI.");
  });

  it("13 delta less than 4 ng/L stays in the minimal delta lane", async () => {
    const result = await delta({ hst_0hr: 6, hst_current: 9, hour: "2" });

    expect(result.absolute_delta).toBe(3);
    expect(result.delta_category).toBe("minimal");
    expect(result.needs_4hr_hst).toBe(false);
  });

  it("14 delta equal to 4 ng/L enters the intermediate 4-hour lane", async () => {
    const result = await delta({ hst_0hr: 6, hst_current: 10, hour: "2" });

    expect(result.absolute_delta).toBe(4);
    expect(result.delta_category).toBe("intermediate");
    expect(result.needs_4hr_hst).toBe(true);
  });

  it("15 delta equal to 14 ng/L remains intermediate and does not become significant", async () => {
    const result = await delta({ hst_0hr: 6, hst_current: 20, hour: "2" });

    expect(result.absolute_delta).toBe(14);
    expect(result.delta_category).toBe("intermediate");
    expect(result.significant).toBe(false);
  });

  it("16 delta equal to 15 ng/L is clinically significant by the absolute rule", async () => {
    const result = await delta({ hst_0hr: 6, hst_current: 21, hour: "2" });

    expect(result.absolute_delta).toBe(15);
    expect(result.delta_category).toBe("significant");
    expect(result.significant).toBe(true);
  });

  it("17 falling delta of at least 15 ng/L is significant per footnote G", async () => {
    const result = await delta({ hst_0hr: 30, hst_current: 10, hour: "2" });

    expect(result.direction).toBe("falling");
    expect(result.delta_category).toBe("significant");
    expect(result.footnote).toContain("Declining HST");
  });

  it("18 HST at or above 100 uses the 20% rule; 19% is not significant", async () => {
    const result = await delta({ hst_0hr: 100, hst_current: 119, hour: "2" });

    expect(result.method).toContain("20% change rule");
    expect(result.significant).toBe(false);
    expect(result.delta_category).toBe("intermediate");
  });

  it("19 HST at or above 100 uses the 20% rule; exactly 20% is significant", async () => {
    const result = await delta({ hst_0hr: 100, hst_current: 120, hour: "2" });

    expect(result.method).toContain("20% change rule");
    expect(result.significant).toBe(true);
    expect(result.delta_category).toBe("significant");
  });

  it("20 intermediate delta below the 99% URL stays pending until 4-hour HST and repeat EKG", async () => {
    const result = await disposition({
      ...baseDisposition,
      any_troponin_above_url: false,
      delta_range: "intermediate",
      has_4hr_result: false,
    });

    expect(result.risk).toBe("PENDING");
    expect(result.disposition).toContain("4-hour HST");
    expect(result.footnotes).toContain(
      "The change in delta can be in either direction. Declining HST can be indicative of recent MI."
    );
  });

  it("21 4-hour follow-up after intermediate 2-hour delta can route low when final criteria are met", async () => {
    const twoHour = await delta({ hst_0hr: 3, hst_current: 10, hour: "2" });
    const fourHour = await delta({ hst_0hr: 3, hst_current: 5, hour: "4" });
    const result = await disposition({
      ...baseDisposition,
      heart_score: 2,
      delta_range: fourHour.delta_category,
      has_4hr_result: true,
    });

    expect(twoHour.delta_category).toBe("intermediate");
    expect(fourHour.delta_category).toBe("minimal");
    expect(result.risk).toBe("LOW");
  });

  it("22 symptoms under 4 hours with minimal delta require repeat HST before final disposition", async () => {
    const result = await disposition({
      ...baseDisposition,
      heart_score: 2,
      symptom_duration_hours: 3.5,
      delta_range: "minimal",
    });

    expect(result.risk).toBe("PENDING");
    expect(result.disposition).toContain("Repeat HST");
    expect(result.footnotes).toContain("Sx <4hr → repeat HST and follow pathway.");
  });

  it("23 below-URL minimal-delta path routes low risk when HEART score is less than 4", async () => {
    const result = await disposition({
      ...baseDisposition,
      heart_score: 3,
      delta_range: "minimal",
    });

    expect(result.risk).toBe("LOW");
    expect(result.rationale).toContain("HEART Score 3 (<4)");
  });

  it("24 below-URL minimal-delta path routes low risk with recent normal testing even when HEART is at least 4", async () => {
    const result = await disposition({
      ...baseDisposition,
      heart_score: 4,
      recent_normal_testing: true,
      delta_range: "minimal",
    });

    expect(result.risk).toBe("LOW");
    expect(result.rationale).toContain("recent normal cardiac testing");
  });

  it("25 below-URL minimal-delta path routes low risk with chronic unchanged HST even when HEART is at least 4", async () => {
    const result = await disposition({
      ...baseDisposition,
      heart_score: 4,
      chronic_unchanged_hst: true,
      delta_range: "minimal",
    });

    expect(result.risk).toBe("LOW");
    expect(result.rationale).toContain("known chronic unchanged HST elevation");
  });

  it("26 below-URL minimal-delta path routes intermediate when no low-risk OR criteria are present", async () => {
    const result = await disposition({
      ...baseDisposition,
      heart_score: 4,
      delta_range: "minimal",
    });

    expect(result.risk).toBe("INTERMEDIATE");
    expect(result.disposition).toBe("Observation with additional testing.");
    expect(result.footnotes).toContain(
      "HEART Score ≥4 OR high clinical suspicion → consider additional testing."
    );
  });

  it("27 above-URL troponin without significant delta routes to chronic injury", async () => {
    const result = await disposition({
      ...baseDisposition,
      any_troponin_above_url: true,
      delta_range: "minimal",
    });

    expect(result.risk).toBe("CHRONIC_INJURY");
    expect(result.disposition).toBe("Evaluate etiology.");
  });

  it("28 above-URL troponin with significant delta routes high risk to cardiology evaluation", async () => {
    const result = await disposition({
      ...baseDisposition,
      any_troponin_above_url: true,
      delta_range: "significant",
    });

    expect(result.risk).toBe("HIGH");
    expect(result.disposition).toBe("Admit.");
    expect(result.rationale).toContain("Troponin above 99% URL with significant delta");
  });

  it("29 ongoing cardiac chest pain independently routes high risk", async () => {
    const result = await disposition({
      ...baseDisposition,
      ongoing_chest_pain: true,
      delta_range: "minimal",
    });

    expect(result.risk).toBe("HIGH");
    expect(result.rationale).toContain("Ongoing cardiac chest pain");
  });

  it("30 ESRD double-lock prevents accidental early-rule-out disposition", async () => {
    const result = await disposition({
      ...baseDisposition,
      is_esrd: true,
      early_rule_out: true,
    });

    expect(result.risk).toBe("HIGH");
    expect(result.disposition).toContain("ESRD patients cannot use early rule-out");
    expect(result.footnotes).toContain("ALL ESRD patients need 2hr HST.");
  });
});
