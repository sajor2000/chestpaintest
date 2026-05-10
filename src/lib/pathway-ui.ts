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
  { id: "basics", label: "Basics", detail: "Sex, ESRD, onset" },
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
    .replace(/\s*\bOptions:\s*[^\n.]+\.?/gi, "")
    .replace(/\s*\((?:please\s+)?(?:select|choose|respond)[^)]*\)/gi, "")
    .replace(/\s*\bPlease\s+(?:select|choose|respond)(?:\s+one)?\.?/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  return /low-risk discharge pathway confirmed|final risk|discharge with follow-up|admit|observation recommended/i.test(
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
  if (/\besrd\b|\bsex\b|\bmale\b|\bfemale\b|patient basics/i.test(text)) {
    return "basics";
  }
  return "ekg";
}
