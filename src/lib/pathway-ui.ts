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

export type StepGuidance = {
  title: string;
  needNow: string;
  why: string;
  watchFor: string;
};

export const PATHWAY_STEPS: PathwayStep[] = [
  { id: "ekg", label: "EKG", detail: "STEMI and ischemic changes" },
  { id: "basics", label: "Basics", detail: "Sex, ESRD, onset" },
  { id: "troponin0", label: "0h HST", detail: "Initial troponin and rule-out" },
  { id: "delta", label: "Serial HST", detail: "2h/4h delta pathway" },
  { id: "heart", label: "HEART", detail: "Risk score components" },
  { id: "disposition", label: "Disposition", detail: "Tool-confirmed final risk" },
];

const STEP_GUIDANCE: Record<PathwayStepId, StepGuidance> = {
  ekg: {
    title: "EKG gate",
    needNow: "Confirm STEMI/equivalent first, then ischemic ST or T-wave changes.",
    why: "STEMI stops this pathway for immediate activation; ischemic changes trigger early cardiology consultation.",
    watchFor: "Do not move to troponin until the EKG branch is explicit.",
  },
  basics: {
    title: "Patient basics",
    needNow: "Capture sex, ESRD status, symptom duration, onset context, and ongoing chest pain.",
    why: "These fields set the sex-specific 99% URL and decide whether early rule-out is allowed.",
    watchFor: "ESRD blocks early rule-out; short symptoms require repeat HST.",
  },
  troponin0: {
    title: "0-hour HST",
    needNow: "Enter the numeric 0-hour HST value in ng/L.",
    why: "The initial HST is compared with sex-specific thresholds and may open the early rule-out branch.",
    watchFor: "HST <5 still needs symptoms >3 hours and explicit low ACS suspicion.",
  },
  delta: {
    title: "Serial HST",
    needNow: "Enter 2-hour HST, repeat EKG status, and 4-hour HST if the delta is intermediate.",
    why: "The pathway uses minimal, intermediate, and significant delta lanes to decide the next action.",
    watchFor: "Delta 4-14 needs 4-hour HST; significant delta is high risk.",
  },
  heart: {
    title: "HEART scoring",
    needNow: "Score History, EKG, Age, Risk Factors, and Troponin with clinician confirmation.",
    why: "HEART <4 can support low-risk disposition when no high-risk pathway flags are present.",
    watchFor: "The app can suggest criteria, but the clinician owns each HEART component score.",
  },
  disposition: {
    title: "Disposition",
    needNow: "Review the tool-confirmed risk category, rationale, footnotes, and documentation prompts.",
    why: "The final card summarizes the prespecified Rush pathway output for clinical review.",
    watchFor: "Final judgment remains with the treating physician.",
  },
};

export function getStepGuidance(step: PathwayStepId) {
  return STEP_GUIDANCE[step];
}

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
    match: /\bsex\b|\bmale\s*(?:\/|or)\s*female\b|\bfemale\s*(?:\/|or)\s*male\b/i,
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

function getActiveQuestionText(text: string) {
  const questionEnd = text.lastIndexOf("?");
  if (questionEnd === -1) return text;

  const questionPrefix = text.slice(0, questionEnd + 1);
  const sentenceBreaks = [
    questionPrefix.lastIndexOf("\n"),
    questionPrefix.lastIndexOf(". "),
    questionPrefix.lastIndexOf("! "),
  ];
  const start = Math.max(...sentenceBreaks);
  return start === -1
    ? questionPrefix.trim()
    : questionPrefix.slice(start + 1).trim();
}

export function cleanQuickReplyPromptText(text: string) {
  return text
    .replace(
      /\s*\bI(?:'ll| will)\s+(?:provide|show|add)\s+(?:quick[- ]reply\s+|quick\s+)?buttons?(?:\s+(?:for\s+(?:you|response|quick replies)|below))?\.?/gi,
      ""
    )
    .replace(
      /\s*\bI(?:'ll| will)\s+(?:provide|show|add)\s+(?:the\s+)?(?:quick[- ]reply\s+|quick\s+)?options?(?:\s+(?:for\s+(?:you|response)|below))?\.?/gi,
      ""
    )
    .replace(/\s*\bI will provide buttons for quick replies\.?/gi, "")
    .replace(/\s*\(?\s*functions\.suggest_followups\s*\)?/gi, "")
    .replace(/\s*\bOptions:\s*[^\n.]+\.?/gi, "")
    .replace(/\s*\((?:please\s+)?(?:select|choose|respond)[^)]*\)/gi, "")
    .replace(/\s*\bPlease\s+(?:select|choose|respond)(?:\s+one)?\.?/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanRepeatedQuestionText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";

  if (trimmed.length % 2 === 0) {
    const midpoint = trimmed.length / 2;
    const firstHalf = trimmed.slice(0, midpoint);
    if (firstHalf === trimmed.slice(midpoint)) return firstHalf.trim();
  }

  const adjacentQuestion = /^([\s\S]+\?)\s*\1$/.exec(trimmed);
  if (adjacentQuestion) return adjacentQuestion[1].trim();

  return trimmed.replace(/([^\n?]+\?)\s*\1/g, "$1").trim();
}

function normalizedQuestionSignature(text: string, options: string[]) {
  const cleaned = cleanQuickReplyPromptText(text);
  const question = getActiveQuestionText(cleaned).toLowerCase();
  const optionKey = normalizeQuickReplyOptions(cleaned, options).join("|");
  const topicKey =
    optionKey ||
    options
      .map((option) => option.toLowerCase().replace(/[^a-z0-9]+/g, " "))
      .join("|");

  return {
    topicKey,
    questionKey: question
      .replace(/\b(please|select|choose|respond|specify|answer|next|patient)\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

export function isDuplicateQuickReplyPromptText(
  text: string,
  previousText: string,
  options: string[]
) {
  const cleaned = cleanQuickReplyPromptText(text);
  if (!cleaned) return true;

  const previousVisibleOptions = normalizeQuickReplyOptions(
    previousText,
    options
  );
  const currentVisibleOptions = normalizeQuickReplyOptions(cleaned, options);
  if (previousVisibleOptions.length === 0 && currentVisibleOptions.length > 0) {
    return true;
  }

  const current = normalizedQuestionSignature(cleaned, options);
  const previous = normalizedQuestionSignature(previousText, options);
  if (!current.topicKey || current.topicKey !== previous.topicKey) return false;

  if (current.questionKey === previous.questionKey) return true;
  if (current.questionKey.length < 12 || previous.questionKey.length < 12) {
    return false;
  }

  return (
    current.questionKey.includes(previous.questionKey) ||
    previous.questionKey.includes(current.questionKey)
  );
}

function isFreeTextLabPrompt(text: string) {
  return (
    /\b(hst|hs-tni|troponin)\b/i.test(text) &&
    /\b(value|ng\/?l|provide|enter|what was)\b/i.test(text) &&
    !/\bheart\b/i.test(text) &&
    !/\bscore\b/i.test(text)
  );
}

function isFreeTextSymptomTimingPrompt(text: string) {
  return (
    /\b(symptom|symptoms|chest pain|pain|sx|onset|duration|started|began|hours?)\b/i.test(
      text
    ) &&
    /\b(what|when|duration|onset|started|began|hours?|how long)\b/i.test(text) &&
    !/\besrd\b/i.test(text) &&
    !/\bongoing\b/i.test(text)
  );
}

function isFinalDispositionText(text: string) {
  return /low-risk discharge pathway confirmed|final risk|discharge with follow-up|admit|observation recommended|stemi pathway|activate (?:the )?stemi pathway|pathway stops here/i.test(
    text
  );
}

export function normalizeQuickReplyOptions(
  lastTextBlock: string,
  toolOptions: string[]
): string[] {
  if (isFinalDispositionText(lastTextBlock)) return [];

  const question = getActiveQuestionText(lastTextBlock.trim());
  let bestRule: (typeof QUICK_REPLY_RULES)[number] | null = null;
  let bestPos = -1;
  for (const rule of QUICK_REPLY_RULES) {
    const m = rule.match.exec(question);
    if (m && m.index > bestPos) {
      bestPos = m.index;
      bestRule = rule;
    }
  }
  if (bestRule) return bestRule.options;
  if (isFreeTextLabPrompt(question) || isFreeTextSymptomTimingPrompt(question)) {
    return [];
  }
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
  if (
    /\besrd\b|\bsex\b|\bmale\b|\bfemale\b|patient basics|\bsymptoms?\b|\bduration\b|\bonset\b|\bhow many hours\b/i.test(
      text
    )
  ) {
    return "basics";
  }
  return "ekg";
}
