export type PathwayStepId =
  | "ekg"
  | "basics"
  | "troponin0"
  | "delta"
  | "heart"
  | "disposition";

export type PathwayStep = {
  id: PathwayStepId;
  label: string;
  detail: string;
};

export const PATHWAY_STEPS: PathwayStep[] = [
  { id: "ekg", label: "EKG", detail: "STEMI and ischemic changes" },
  { id: "basics", label: "Basics", detail: "Sex and ESRD status" },
  { id: "troponin0", label: "0h HST", detail: "Initial troponin and rule-out" },
  { id: "delta", label: "Serial HST", detail: "2h/4h delta pathway" },
  { id: "heart", label: "HEART", detail: "Risk score components" },
  { id: "disposition", label: "Disposition", detail: "Tool-confirmed final risk" },
];

const QUICK_REPLY_RULES: Array<{
  match: RegExp;
  options: string[];
}> = [
  {
    match: /\b(stemi|stemi equivalent|stemi\/eqv)\b/i,
    options: ["Yes - STEMI", "No STEMI"],
  },
  {
    match: /\bischemic\b|st[- ]?t|t[- ]?wave/i,
    options: ["Yes - ischemic changes", "No ischemic changes"],
  },
  {
    match: /\besrd\b|end[- ]stage renal/i,
    options: ["Yes - ESRD", "No ESRD"],
  },
  {
    match: /\bsex\b|\bmale\b|\bfemale\b/i,
    options: ["Male", "Female"],
  },
  {
    match: /clinical suspicion|suspicion for acs/i,
    options: ["Low", "Moderate", "High"],
  },
  {
    match: /ongoing.*chest pain|chest pain.*ongoing/i,
    options: ["Yes - ongoing pain", "No ongoing pain"],
  },
  {
    match: /recent normal.*testing|normal cardiac testing/i,
    options: ["Yes - recent normal testing", "No recent normal testing"],
  },
];

export function normalizeQuickReplyOptions(
  lastTextBlock: string,
  toolOptions: string[]
): string[] {
  const question = lastTextBlock.trim();
  const matchedRule = QUICK_REPLY_RULES.find((rule) => rule.match.test(question));
  if (matchedRule) return matchedRule.options;
  return toolOptions;
}

export function getPathwayStep(text: string): PathwayStepId {
  if (/disposition|final risk/i.test(text)) {
    return "disposition";
  }
  if (/heart score|heart risk|h\.?e\.?a\.?r\.?t\b.*scor|calculate.*heart|history.*ekg.*age/i.test(text)) {
    return "heart";
  }
  if (/\bdelta\b|\b2[- ]?hour\b|\b2h\b|\b4[- ]?hour\b|\b4h\b|serial hst|repeat hst/i.test(text)) {
    return "delta";
  }
  if (/\b0[- ]?hour\b|\b0h\b|initial.*hst|initial.*troponin|early.*rule[- ]out/i.test(text)) {
    return "troponin0";
  }
  if (/\besrd\b|\bsex\b|\bmale\b|\bfemale\b|patient basics/i.test(text)) {
    return "basics";
  }
  return "ekg";
}
