import { tool } from "ai";
import { z } from "zod";
import {
  TROPONIN_THRESHOLDS as T,
  FOOTNOTES,
  HEART_SCORE_RISK,
  DISPOSITIONS,
} from "./constants";

export const assessEkg = tool({
  description:
    "Assess EKG findings to determine STEMI status and ischemic changes. Call this first when starting the pathway.",
  inputSchema: z.object({
    stemi_or_equivalent: z
      .boolean()
      .describe("Does the EKG show STEMI or STEMI equivalent?"),
    ischemic_changes: z
      .boolean()
      .describe(
        "Are there ischemic ST or T-wave changes (non-STEMI pattern)?"
      ),
  }),
  execute: async ({ stemi_or_equivalent, ischemic_changes }) => {
    if (stemi_or_equivalent) {
      return {
        action: "STEMI_PATHWAY",
        message:
          "STEMI or equivalent identified. Activate STEMI pathway immediately.",
        urgent: true,
      };
    }
    return {
      action: "CONTINUE",
      ischemic_changes,
      cardiology_consult: ischemic_changes,
      footnote: ischemic_changes ? FOOTNOTES.A : null,
      message: ischemic_changes
        ? "Ischemic changes noted — early cardiology consult recommended."
        : "No STEMI. Proceed with troponin workup.",
    };
  },
});

export const evaluateTroponin = tool({
  description:
    "Evaluate a high-sensitivity troponin I value against sex-specific 99th percentile URL thresholds.",
  inputSchema: z.object({
    value: z.number().nonnegative().describe("HST value in ng/L"),
    hour: z.enum(["0", "2", "4"]).describe("Timepoint of the draw"),
    sex: z.enum(["male", "female"]).describe("Patient sex"),
    is_esrd: z.boolean().describe("Does the patient have ESRD?"),
    symptom_duration_hours: z
      .number()
      .nonnegative()
      .optional()
      .describe("Hours since symptom onset"),
    clinical_suspicion: z
      .enum(["low", "moderate", "high"])
      .optional()
      .describe("Clinical suspicion for ACS"),
  }),
  execute: async ({
    value,
    hour,
    sex,
    is_esrd,
    symptom_duration_hours,
    clinical_suspicion,
  }) => {
    const url99 = sex === "male" ? T.MALE_99_URL : T.FEMALE_99_URL;
    const above_url = value >= url99;
    const flags: string[] = [];
    const footnotes: string[] = [];

    if (value > T.HIGH_PPV) {
      flags.push(`HST >200 ng/L: PPV 70% for MI.`);
      footnotes.push(FOOTNOTES.D);
    }

    if (is_esrd) {
      flags.push("ESRD patient — must obtain 2hr HST regardless of 0hr value.");
      footnotes.push(FOOTNOTES.C);
    }

    const early_rule_out_eligible =
      hour === "0" &&
      value < T.EARLY_RULE_OUT &&
      !is_esrd &&
      (symptom_duration_hours ?? 0) > 3 &&
      clinical_suspicion === "low";

    if (early_rule_out_eligible) {
      flags.push("Eligible for early MI rule-out (NPV 99.5%).");
      footnotes.push(FOOTNOTES.B);
    }

    return {
      value,
      hour,
      sex,
      url_99_threshold: url99,
      above_url,
      early_rule_out_eligible,
      flags,
      footnotes,
      message: above_url
        ? `HST ${value} ng/L is AT or ABOVE the ${sex} 99% URL of ${url99} ng/L.`
        : `HST ${value} ng/L is below the ${sex} 99% URL of ${url99} ng/L.`,
    };
  },
});

export const calculateDelta = tool({
  description:
    "Calculate the delta (change) between the 0hr troponin and a subsequent draw. Determines significance per Rush pathway rules.",
  inputSchema: z.object({
    hst_0hr: z.number().nonnegative().describe("0-hour HST value in ng/L"),
    hst_current: z
      .number()
      .nonnegative()
      .describe("Current HST value in ng/L"),
    hour: z
      .enum(["2", "4"])
      .describe("Timepoint of the current draw (2hr or 4hr)"),
  }),
  execute: async ({ hst_0hr, hst_current, hour }) => {
    const absolute_delta = Math.abs(hst_current - hst_0hr);
    const direction =
      hst_current > hst_0hr
        ? "rising"
        : hst_current < hst_0hr
          ? "falling"
          : "unchanged";
    const max_value = Math.max(hst_0hr, hst_current);

    let significant: boolean;
    let method: string;

    if (max_value >= T.HIGH_VALUE_CUTOFF) {
      const denominator = Math.min(hst_0hr, hst_current);
      if (denominator === 0) {
        significant = true;
        method = `Rise from 0 to ${max_value} ng/L — inherently significant`;
      } else {
        const pct_change = absolute_delta / denominator;
        significant = pct_change >= T.SIGNIFICANT_DELTA_PERCENT;
        method = `20% change rule (HST ≥100): ${(pct_change * 100).toFixed(1)}% change`;
      }
    } else {
      significant = absolute_delta >= T.SIGNIFICANT_DELTA_ABSOLUTE;
      method = `Absolute delta rule: ${absolute_delta} ng/L (threshold: ${T.SIGNIFICANT_DELTA_ABSOLUTE} ng/L)`;
    }

    return {
      hst_0hr,
      hst_current,
      hour,
      absolute_delta,
      direction,
      significant,
      method,
      footnote: FOOTNOTES.G,
      message: significant
        ? `Significant delta detected (${method}). Direction: ${direction}.`
        : `Delta is NOT significant (${method}). Direction: ${direction}.`,
    };
  },
});

const heartComponent = z.union([z.literal(0), z.literal(1), z.literal(2)]);

export const calculateHeartScore = tool({
  description:
    "Calculate the HEART score from its 5 components. Each component is scored 0, 1, or 2.",
  inputSchema: z.object({
    history: heartComponent.describe(
      "History: 0=slightly suspicious, 1=moderately suspicious, 2=highly suspicious"
    ),
    ekg: heartComponent.describe(
      "EKG: 0=normal, 1=non-specific repolarization disturbance, 2=significant ST deviation"
    ),
    age: heartComponent.describe("Age: 0=<45, 1=45-64, 2=≥65"),
    risk_factors: heartComponent.describe(
      "Risk factors: 0=no known, 1=1-2 factors, 2=≥3 factors or history of atherosclerotic disease"
    ),
    troponin: heartComponent.describe(
      "Initial troponin: 0=≤normal limit, 1=1-3x normal limit, 2=>3x normal limit"
    ),
  }),
  execute: async ({ history, ekg, age, risk_factors, troponin }) => {
    const total = history + ekg + age + risk_factors + troponin;
    let risk_level: string;
    if (total <= HEART_SCORE_RISK.LOW.max) risk_level = "Low";
    else if (total <= HEART_SCORE_RISK.MODERATE.max) risk_level = "Moderate";
    else risk_level = "High";

    return {
      components: { history, ekg, age, risk_factors, troponin },
      total,
      risk_level,
      footnote: total >= 4 ? FOOTNOTES.E : null,
      message: `HEART Score: ${total}/10 (${risk_level} risk).${total >= 4 ? " Consider additional testing." : ""}`,
    };
  },
});

export const determineDisposition = tool({
  description:
    "Determine final risk stratification and disposition based on all collected pathway data. Call this when enough data has been gathered.",
  inputSchema: z.object({
    any_troponin_above_url: z
      .boolean()
      .describe("Was any troponin value at or above the sex-specific 99% URL?"),
    significant_delta: z
      .boolean()
      .describe("Was there a significant troponin delta?"),
    ekg_ischemic_changes: z.boolean().describe("Ischemic EKG changes present?"),
    ongoing_chest_pain: z
      .boolean()
      .describe("Is the patient having ongoing cardiac chest pain?"),
    heart_score: z.number().int().min(0).max(10).describe("HEART score total"),
    symptom_duration_hours: z
      .number()
      .nonnegative()
      .describe("Hours since symptom onset"),
    is_esrd: z.boolean(),
    recent_normal_testing: z
      .boolean()
      .describe("Recent normal cardiac testing on file?"),
    chronic_unchanged_hst: z
      .boolean()
      .describe("Known chronic unchanged HST elevation?"),
    early_rule_out: z
      .boolean()
      .describe("Met early rule-out criteria (<5 ng/L, Sx>3hr, low suspicion)?"),
  }),
  execute: async (input) => {
    if (input.early_rule_out && input.is_esrd) {
      return {
        risk: "HIGH",
        disposition: "ESRD patients cannot use early rule-out. A 2-hour HST is required.",
        rationale: "ESRD exclusion — early rule-out does not apply.",
        footnotes: [FOOTNOTES.C],
      };
    }

    if (input.early_rule_out) {
      return {
        risk: "LOW",
        disposition: DISPOSITIONS.LOW,
        rationale:
          "Early MI rule-out met: HST <5 ng/L, symptoms >3hr, low clinical suspicion. NPV 99.5%.",
        footnotes: [FOOTNOTES.B],
      };
    }

    if (input.any_troponin_above_url && input.significant_delta) {
      return {
        risk: "HIGH",
        disposition: DISPOSITIONS.HIGH,
        rationale:
          "Troponin above 99% URL with significant delta. Cardiology evaluation required.",
        footnotes: [FOOTNOTES.G],
      };
    }

    if (
      input.significant_delta ||
      input.ekg_ischemic_changes ||
      input.ongoing_chest_pain
    ) {
      const reasons = [
        input.significant_delta && "Significant troponin delta",
        input.ekg_ischemic_changes && "Ischemic EKG changes",
        input.ongoing_chest_pain && "Ongoing cardiac chest pain",
      ].filter((x): x is string => Boolean(x));

      const fn = [
        input.ekg_ischemic_changes ? FOOTNOTES.A : null,
        input.significant_delta ? FOOTNOTES.G : null,
      ].filter((x): x is string => x !== null);

      return {
        risk: "HIGH",
        disposition: DISPOSITIONS.HIGH,
        rationale: reasons.join(", ") + ".",
        footnotes: fn,
      };
    }

    if (input.any_troponin_above_url) {
      return {
        risk: "INTERMEDIATE",
        disposition: DISPOSITIONS.INTERMEDIATE,
        rationale:
          "Troponin at or above 99% URL without significant delta. Clinical correlation and observation required.",
        footnotes: [],
      };
    }

    if (
      !input.significant_delta &&
      !input.any_troponin_above_url &&
      input.heart_score < 4 &&
      (input.recent_normal_testing || input.chronic_unchanged_hst)
    ) {
      if (input.chronic_unchanged_hst) {
        return {
          risk: "CHRONIC_INJURY",
          disposition: DISPOSITIONS.CHRONIC_INJURY,
          rationale:
            "No significant delta with known chronic unchanged HST elevation.",
          footnotes: [],
        };
      }
      return {
        risk: "LOW",
        disposition: DISPOSITIONS.LOW,
        rationale:
          "No significant delta, below 99% URL, HEART <4, with recent normal testing.",
        footnotes: [],
      };
    }

    return {
      risk: "INTERMEDIATE",
      disposition: DISPOSITIONS.INTERMEDIATE,
      rationale:
        "Does not meet criteria for low or high risk. Observation recommended with additional testing.",
      footnotes: [FOOTNOTES.E],
    };
  },
});
