export const TROPONIN_THRESHOLDS = {
  MALE_99_URL: 35,
  FEMALE_99_URL: 14,
  EARLY_RULE_OUT: 5,
  HIGH_PPV: 200,
  SIGNIFICANT_DELTA_ABSOLUTE: 15,
  SIGNIFICANT_DELTA_PERCENT: 0.2,
  HIGH_VALUE_CUTOFF: 100,
} as const;

export const HEART_SCORE_RISK = {
  LOW: { min: 0, max: 3, label: "Low" },
  MODERATE: { min: 4, max: 6, label: "Moderate" },
  HIGH: { min: 7, max: 10, label: "High" },
} as const;

type FootnoteKey = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export const FOOTNOTES: Record<FootnoteKey, string> = {
  A: "Ischemic ST or T changes → early cardiology consult.",
  B: "NPV for MI is 99.5%.",
  C: "ALL ESRD patients need 2hr HST.",
  D: "0hr Trop >200 has a PPV of 70% for MI.",
  E: "HEART Score ≥4 OR high clinical suspicion → consider additional testing.",
  F: "Sx <4hr → repeat HST and follow pathway.",
  G: "The change in delta can be in either direction. Declining HST can be indicative of recent MI.",
};

export const LOINC_HS_TROPONIN_I = "89579-7";

export const DISPOSITIONS = {
  LOW: "Discharge with follow-up.",
  INTERMEDIATE: "Observation with additional testing.",
  CHRONIC_INJURY: "Evaluate etiology.",
  HIGH: "Admit.",
} as const;
