import { tool } from "ai";
import { z } from "zod";
import {
  TROPONIN_THRESHOLDS as T,
  FOOTNOTES,
  HEART_SCORE_RISK,
  DISPOSITIONS,
} from "./constants";

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function sourceDocumentsLowClinicalSuspicion(text: string) {
  const normalized = text.trim();
  return (
    /^low$/i.test(normalized) ||
    /(?:clinical suspicion(?: for acs)?|suspicion for acs)[^\n.]*\blow\b|\blow\b[^\n.]*(?:clinical suspicion(?: for acs)?|suspicion for acs)/i.test(
      normalized
    )
  );
}

function getUserMessageTexts(messages: unknown[]) {
  return messages.flatMap((message) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("role" in message) ||
      message.role !== "user" ||
      !("content" in message)
    ) {
      return [];
    }

    return [textFromMessageContent(message.content)];
  });
}

function hasExplicitLowClinicalSuspicion(
  messages: unknown[],
  clinicalSuspicionSource?: string
) {
  if (
    !clinicalSuspicionSource ||
    !sourceDocumentsLowClinicalSuspicion(clinicalSuspicionSource)
  ) {
    return false;
  }

  const source = clinicalSuspicionSource.trim().toLowerCase();
  return getUserMessageTexts(messages).some((text) => {
    const normalized = text.trim().toLowerCase();
    return (
      normalized.includes(source) ||
      (/^low$/i.test(clinicalSuspicionSource.trim()) &&
        sourceDocumentsLowClinicalSuspicion(text))
    );
  });
}

function troponinSourceValues(valueSource: string) {
  const unitValues = [...valueSource.matchAll(/(\d+(?:\.\d+)?)\s*ng\/?l\b/gi)].map(
    (match) => Number(match[1])
  );
  if (unitValues.length > 0) return unitValues;

  const withoutTimepoints = valueSource.replace(
    /\b[024]\s*[- ]?(?:hour|hr|h)\b/gi,
    ""
  );
  return [...withoutTimepoints.matchAll(/\d+(?:\.\d+)?/g)].map((match) =>
    Number(match[0])
  );
}

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
    value_source: z
      .string()
      .min(1)
      .describe(
        "Verbatim clinician-provided source text showing this is an HST, hs-TnI, or troponin value in ng/L. The user's answer itself is sufficient when it includes a numeric value plus HST, hs-TnI, troponin, or ng/L. Do not use symptom duration, onset, ESRD, ongoing pain, sex, or suspicion answers."
      ),
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
    clinical_suspicion_source: z
      .string()
      .optional()
      .describe(
        "Verbatim clinician source for clinical suspicion. Required to use low suspicion for early rule-out; must explicitly say clinical suspicion is low or be the direct Low choice."
      ),
  }),
  execute: async (
    {
      value,
      value_source,
      hour,
      sex,
      is_esrd,
      symptom_duration_hours,
      clinical_suspicion,
      clinical_suspicion_source,
    },
    { messages }
  ) => {
    const sourceLooksLikeTroponin =
      /\b(hst|hs-tni|troponin)\b/i.test(value_source) ||
      /\bng\/?l\b/i.test(value_source);
    const sourceIsBareNumber = /^\d+(?:\.\d+)?$/.test(value_source.trim());
    const sourceExplicitlyNotTroponin =
      /not an? (?:hst|hs-tni|troponin)/i.test(value_source) ||
      /not .*troponin value/i.test(value_source);
    const sourceIsKnownNonTroponinContext =
      /\bsymptom duration\b/i.test(value_source) ||
      /\bchest pain onset\b/i.test(value_source) ||
      /\bongoing chest pain\b/i.test(value_source) ||
      /\besrd\b/i.test(value_source);
    const sourceValues = troponinSourceValues(value_source);
    const sourceValueMatches = sourceValues.some(
      (sourceValue) => Math.abs(sourceValue - value) < 1e-9
    );

    if (
      sourceExplicitlyNotTroponin ||
      sourceIsKnownNonTroponinContext ||
      (!sourceLooksLikeTroponin && !sourceIsBareNumber) ||
      sourceValues.length === 0
    ) {
      return {
        invalid_input: true,
        message:
          "Troponin evaluation was not performed because the provided source text does not explicitly document an HST/hs-TnI/troponin value. Ask for the troponin value in ng/L before calling evaluate_troponin.",
      };
    }

    if (!sourceValueMatches) {
      return {
        invalid_input: true,
        message:
          "Troponin evaluation was not performed because the documented source value does not match the numeric value passed to evaluate_troponin. Ask for the HST value in ng/L and call the tool with the exact same value.",
      };
    }

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

    const explicitLowSuspicion =
      clinical_suspicion === "low" &&
      hasExplicitLowClinicalSuspicion(messages, clinical_suspicion_source);
    const ruleOutBiomarkerContext =
      hour === "0" &&
      value < T.EARLY_RULE_OUT &&
      !is_esrd &&
      (symptom_duration_hours ?? 0) > 3;
    const needs_clinical_suspicion =
      ruleOutBiomarkerContext &&
      !explicitLowSuspicion &&
      clinical_suspicion !== "moderate" &&
      clinical_suspicion !== "high";

    const early_rule_out_eligible =
      ruleOutBiomarkerContext && explicitLowSuspicion;

    if (early_rule_out_eligible) {
      flags.push("Eligible for early MI rule-out (NPV 99.5%).");
      footnotes.push(FOOTNOTES.B);
    }
    if (needs_clinical_suspicion) {
      flags.push(
        "Early rule-out cannot be finalized until the clinician explicitly answers clinical suspicion for ACS: Low, Moderate, or High."
      );
    }

    const thresholdMessage = above_url
      ? `HST ${value} ng/L is AT or ABOVE the ${sex} 99% URL of ${url99} ng/L.`
      : `HST ${value} ng/L is below the ${sex} 99% URL of ${url99} ng/L.`;

    return {
      value,
      hour,
      sex,
      url_99_threshold: url99,
      above_url,
      early_rule_out_eligible,
      needs_clinical_suspicion,
      flags,
      footnotes,
      message: needs_clinical_suspicion
        ? `${thresholdMessage} Ask the clinician to choose clinical suspicion for ACS: Low, Moderate, or High before finalizing early rule-out.`
        : thresholdMessage,
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
    const signed_delta = hst_current - hst_0hr;
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

    const delta_category: "minimal" | "intermediate" | "significant" =
      significant
        ? "significant"
        : absolute_delta >= T.INTERMEDIATE_DELTA_MIN
          ? "intermediate"
          : "minimal";
    const needs_4hr_hst = delta_category === "intermediate";
    const clinical_delta_flag =
      delta_category === "significant"
        ? "CLINICALLY_SIGNIFICANT_DELTA"
        : delta_category === "intermediate"
          ? "INTERMEDIATE_DELTA_REQUIRES_4HR"
          : "NO_CLINICALLY_SIGNIFICANT_DELTA";
    const math_summary = `${hst_current} - ${hst_0hr} = ${
      signed_delta >= 0 ? "+" : ""
    }${signed_delta} ng/L`;
    const logic_summary = significant
      ? `Clinically significant delta by pathway rule: ${method}.`
      : needs_4hr_hst
        ? "Intermediate delta by pathway rule: obtain 4-hour HST and repeat EKG before final disposition."
        : `No clinically significant delta by pathway rule: ${method}.`;
    const recommendations =
      delta_category === "significant"
        ? [
            "Flag this as a clinically significant delta in the pathway.",
            "Use this delta_range value as significant when calling determine_disposition.",
            "Remember that a falling significant delta can still indicate recent MI.",
          ]
        : needs_4hr_hst
          ? [
              "Do not finalize disposition from this delta alone.",
              "Obtain 4-hour HST and repeat EKG, then rerun delta logic.",
            ]
          : [
              "Continue the pathway using delta_range minimal unless another high-risk feature is present.",
            ];

    return {
      hst_0hr,
      hst_current,
      hour,
      signed_delta,
      absolute_delta,
      direction,
      significant,
      delta_category,
      needs_4hr_hst,
      clinical_delta_flag,
      math_summary,
      logic_summary,
      recommendations,
      method,
      footnote: FOOTNOTES.G,
      message: significant
        ? `Significant delta detected (${method}). Direction: ${direction}.`
        : needs_4hr_hst
          ? `Delta is intermediate (${absolute_delta} ng/L, range 4–14). A 4-hour HST and repeat EKG are required.`
          : `Delta is NOT significant (${method}). Direction: ${direction}.`,
    };
  },
});

const heartComponent = z.union([z.literal(0), z.literal(1), z.literal(2)]);

const HEART_LABELS: Record<string, [string, string, string]> = {
  history: ["Slightly suspicious", "Moderately suspicious", "Highly suspicious"],
  ekg: ["Normal", "Non-specific repolarization disturbance", "Significant ST deviation"],
  age: ["< 45", "45–64", "≥ 65"],
  risk_factors: ["No known risk factors", "1–2 risk factors", "≥ 3 factors or atherosclerotic disease"],
  troponin: ["≤ normal limit", "1–3× normal limit", "> 3× normal limit"],
};

const LOW_RISK_DISCHARGE_RECOMMENDATIONS = [
  "Discharge with follow-up if the treating physician agrees the full pathway criteria are met.",
  "Review return precautions for recurrent, worsening, or persistent chest pain.",
  "Arrange outpatient follow-up according to local chest pain pathway practice.",
  "Document the low-risk pathway criteria, shared decision-making, and follow-up plan.",
];

const LOW_RISK_CHEST_PAIN_CHARTING_PROMPTS = [
  "Document exact chest pain onset time and symptom duration used for pathway routing.",
  "Document pain character, location, radiation, exertional component, and whether pain is ongoing.",
  "Document associated symptoms such as dyspnea, diaphoresis, nausea, syncope, or palpitations.",
  "Document why ACS suspicion is low and which pathway criteria supported low-risk disposition.",
];

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

    const labels = {
      history: HEART_LABELS.history[history],
      ekg: HEART_LABELS.ekg[ekg],
      age: HEART_LABELS.age[age],
      risk_factors: HEART_LABELS.risk_factors[risk_factors],
      troponin: HEART_LABELS.troponin[troponin],
    };

    return {
      components: { history, ekg, age, risk_factors, troponin },
      labels,
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
    delta_range: z
      .enum(["minimal", "intermediate", "significant"])
      .describe(
        "Delta category from calculate_delta: minimal (<4), intermediate (4-14), significant (≥15)"
      ),
    has_4hr_result: z
      .boolean()
      .describe("Has a 4-hour HST result been obtained?"),
  }),
  execute: async (input, { messages }) => {
    const significant_delta = input.delta_range === "significant";
    const explicitLowSuspicion = getUserMessageTexts(messages).some(
      sourceDocumentsLowClinicalSuspicion
    );

    if (input.early_rule_out && input.is_esrd) {
      return {
        risk: "HIGH",
        disposition: "ESRD patients cannot use early rule-out. A 2-hour HST is required.",
        rationale: "ESRD exclusion — early rule-out does not apply.",
        footnotes: [FOOTNOTES.C],
      };
    }

    if (input.early_rule_out && !explicitLowSuspicion) {
      return {
        risk: "PENDING",
        disposition:
          "Clinical suspicion for ACS must be explicitly documented as Low before early rule-out can be finalized.",
        rationale:
          "Early MI rule-out is blocked until the clinician answers the clinical suspicion prompt.",
        footnotes: [],
      };
    }

    if (input.early_rule_out) {
      return {
        risk: "LOW",
        disposition: DISPOSITIONS.LOW,
        rationale:
          "Early MI rule-out met: HST <5 ng/L, symptoms >3hr, low clinical suspicion. NPV 99.5%.",
        recommendations: LOW_RISK_DISCHARGE_RECOMMENDATIONS,
        chest_pain_charting_prompts: LOW_RISK_CHEST_PAIN_CHARTING_PROMPTS,
        footnotes: [FOOTNOTES.B],
      };
    }

    if (
      input.delta_range === "intermediate" &&
      !input.has_4hr_result &&
      !input.any_troponin_above_url
    ) {
      return {
        risk: "PENDING",
        disposition: DISPOSITIONS.PENDING_4HR,
        rationale:
          "Delta is in the 4–14 ng/L intermediate range. A 4-hour HST and repeat EKG are required before final disposition.",
        footnotes: [FOOTNOTES.G],
      };
    }

    if (input.any_troponin_above_url && significant_delta) {
      return {
        risk: "HIGH",
        disposition: DISPOSITIONS.HIGH,
        rationale:
          "Troponin above 99% URL with significant delta. Cardiology evaluation required.",
        footnotes: [FOOTNOTES.G],
      };
    }

    if (
      significant_delta ||
      input.ekg_ischemic_changes ||
      input.ongoing_chest_pain
    ) {
      const reasons = [
        significant_delta && "Significant troponin delta",
        input.ekg_ischemic_changes && "Ischemic EKG changes",
        input.ongoing_chest_pain && "Ongoing cardiac chest pain",
      ].filter((x): x is string => Boolean(x));

      const fn = [
        input.ekg_ischemic_changes ? FOOTNOTES.A : null,
        significant_delta ? FOOTNOTES.G : null,
      ].filter((x): x is string => x !== null);

      return {
        risk: "HIGH",
        disposition: DISPOSITIONS.HIGH,
        rationale: reasons.join(", ") + ".",
        footnotes: fn,
      };
    }

    if (input.any_troponin_above_url && !input.has_4hr_result) {
      return {
        risk: "CHRONIC_INJURY",
        disposition: DISPOSITIONS.CHRONIC_INJURY,
        rationale:
          "Troponin at or above 99% URL without significant delta — consistent with chronic myocardial injury. Evaluate etiology.",
        footnotes: [],
      };
    }

    if (
      !significant_delta &&
      !input.any_troponin_above_url &&
      input.delta_range === "minimal" &&
      input.symptom_duration_hours < 4
    ) {
      return {
        risk: "PENDING",
        disposition: DISPOSITIONS.PENDING_REPEAT,
        rationale:
          "Symptoms < 4 hours with minimal delta. Repeat HST and follow the pathway.",
        footnotes: [FOOTNOTES.F],
      };
    }

    if (
      !significant_delta &&
      !input.any_troponin_above_url &&
      (input.recent_normal_testing || input.chronic_unchanged_hst || input.heart_score < 4)
    ) {
      const qualifiers = [
        input.recent_normal_testing && "recent normal cardiac testing",
        input.chronic_unchanged_hst && "known chronic unchanged HST elevation",
        input.heart_score < 4 && `HEART Score ${input.heart_score} (<4)`,
      ].filter((x): x is string => Boolean(x));

      return {
        risk: "LOW",
        disposition: DISPOSITIONS.LOW,
        rationale:
          `No significant delta, below 99% URL, qualifying criteria: ${qualifiers.join(", ")}.`,
        recommendations: LOW_RISK_DISCHARGE_RECOMMENDATIONS,
        chest_pain_charting_prompts: LOW_RISK_CHEST_PAIN_CHARTING_PROMPTS,
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

export const suggestFollowups = tool({
  description:
    "Present quick-reply buttons when asking the physician a question with discrete answer options. Call this alongside your question text.",
  inputSchema: z.object({
    options: z
      .array(z.string())
      .min(2)
      .max(6)
      .describe("Button labels — short clinical phrases"),
  }),
  execute: async ({ options }) => ({ options }),
});
