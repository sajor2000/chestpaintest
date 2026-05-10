import type { UIMessage } from "ai";

type HeartComponents = {
  history?: 0 | 1 | 2;
  ekg?: 0 | 1 | 2;
  age?: 0 | 1 | 2;
  risk_factors?: 0 | 1 | 2;
  troponin?: 0 | 1 | 2;
};

export type PathwayState = {
  fields: {
    stemiOrEquivalent?: boolean;
    ischemicChanges?: boolean;
    sex?: "male" | "female";
    isEsrd?: boolean;
    symptomDurationHours?: number;
    ongoingChestPain?: boolean;
    hst0?: number;
    hst2?: number;
    hst4?: number;
    clinicalSuspicion?: "low" | "moderate" | "high";
    heartComponents?: HeartComponents;
    recentNormalTesting?: boolean;
    chronicUnchangedHst?: boolean;
  };
  presentFields: string[];
  missingRequiredFields: string[];
  nextAction: string;
};

function textFromMessage(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function latestUserText(messages: UIMessage[]) {
  return messages
    .filter((message) => message.role === "user")
    .map(textFromMessage)
    .join("\n");
}

function hasNegatedPhrase(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function extractBoolean(text: string, yesPattern: RegExp, noPattern: RegExp) {
  if (hasNegatedPhrase(text, noPattern)) return false;
  if (yesPattern.test(text)) return true;
  return undefined;
}

function extractNumber(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1] !== undefined) return Number(match[1]);
  }
  return undefined;
}

function extractHeartComponent(
  text: string,
  label: string,
  aliases: string[]
): 0 | 1 | 2 | undefined {
  const labelPattern = [label, ...aliases].join("|");
  const match = new RegExp(`(?:${labelPattern})\\s*(?:score|component)?\\s*[:=]?\\s*([012])`, "i").exec(text);
  if (!match) return undefined;
  return Number(match[1]) as 0 | 1 | 2;
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;
}

function getPresentFields(fields: PathwayState["fields"]) {
  const present = Object.entries(fields)
    .flatMap(([key, value]) => {
      if (value === undefined) return [];
      if (key === "heartComponents") {
        return Object.keys(compactObject(value as Record<string, unknown>)).map(
          (component) => `heart.${component}`
        );
      }
      return [key];
    });
  return present.sort();
}

function getMissingRequiredFields(fields: PathwayState["fields"]) {
  const missing: string[] = [];
  if (fields.stemiOrEquivalent === undefined) missing.push("stemiOrEquivalent");
  if (fields.ischemicChanges === undefined) missing.push("ischemicChanges");
  if (!fields.sex) missing.push("sex");
  if (fields.isEsrd === undefined) missing.push("isEsrd");
  if (fields.symptomDurationHours === undefined) {
    missing.push("symptomDurationHours");
  }
  if (fields.hst0 === undefined) missing.push("hst0");
  return missing;
}

function getNextAction(fields: PathwayState["fields"]) {
  if (fields.stemiOrEquivalent === undefined) {
    return "Ask whether the EKG shows STEMI or STEMI equivalent.";
  }
  if (fields.stemiOrEquivalent) {
    return "Call assess_ekg with stemi_or_equivalent true and stop the hs-TnI pathway if STEMI_PATHWAY is returned.";
  }
  if (fields.ischemicChanges === undefined) {
    return "Ask whether ischemic ST or T-wave changes are present.";
  }
  if (!fields.sex) return "Ask for patient sex: Male or Female.";
  if (fields.isEsrd === undefined) return "Ask whether the patient has ESRD.";
  if (fields.symptomDurationHours === undefined) {
    return "Ask for symptom duration in hours.";
  }
  if (fields.hst0 === undefined) return "Ask for the 0-hour HST value in ng/L.";

  const canEvaluateInitialTroponin =
    fields.sex && fields.isEsrd !== undefined && fields.hst0 !== undefined;
  const needsSuspicionForEarlyRuleOut =
    canEvaluateInitialTroponin &&
    fields.hst0 !== undefined &&
    fields.hst0 < 5 &&
    fields.symptomDurationHours !== undefined &&
    fields.symptomDurationHours > 3 &&
    fields.isEsrd === false &&
    !fields.clinicalSuspicion;

  if (needsSuspicionForEarlyRuleOut) {
    return "Call evaluate_troponin for 0-hour HST, then ask exactly: Clinical suspicion for ACS: Low, Moderate, or High?";
  }
  if (fields.hst2 === undefined) {
    return "Call assess_ekg and evaluate_troponin for the 0-hour HST, then ask for the 2-hour HST and repeat EKG unless early rule-out is confirmed by tools.";
  }

  const heart = fields.heartComponents ?? {};
  const missingHeart = [
    "history",
    "ekg",
    "age",
    "risk_factors",
    "troponin",
  ].filter((field) => heart[field as keyof HeartComponents] === undefined);

  if (missingHeart.length > 0) {
    return `Call assess_ekg, evaluate_troponin for available HST values, and calculate_delta; then ask for HEART component: ${missingHeart[0]}.`;
  }

  return "All core pathway data present. Call assess_ekg, evaluate_troponin for each HST value, calculate_delta, calculate_heart_score, and determine_disposition. Do not re-ask for present fields.";
}

export function resolvePathwayState(messages: UIMessage[]): PathwayState {
  const text = latestUserText(messages);
  const lower = text.toLowerCase();

  const stemiOrEquivalent = extractBoolean(
    lower,
    /\b(?:yes\s*-\s*)?(?:stemi|stemi equivalent|stemi\/eqv)\b(?![^.\n]*\bno\b)/i,
    /\bno\s+(?:stemi|stemi equivalent|stemi\/eqv)\b|\bno\s+stemi\s+or\s+stemi equivalent\b/i
  );
  const ischemicChanges = extractBoolean(
    lower,
    /\b(?:yes\s*-\s*)?ischemic(?:\s+st\/?t|\s+st|\s+t-wave|\s+changes)?\b/i,
    /\bno\s+ischemic\b|\bno\s+ischemic\s+st\/?t\b|\bno\s+ischemic\s+st\s+or\s+t-wave\b/i
  );

  const sex = /\bfemale\b/i.test(text)
    ? "female"
    : /\bmale\b/i.test(text)
      ? "male"
      : undefined;

  const isEsrd = extractBoolean(
    lower,
    /\b(?:yes\s*-\s*)?esrd\b|\bend-stage renal disease\b/i,
    /\bno\s+esrd\b|\bnot\s+esrd\b|\bno\s+end-stage renal\b/i
  );

  const symptomDurationHours = extractNumber(text, [
    /symptom duration:\s*(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i,
    /symptoms?\s+(?:started|began)\s+(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s+ago/i,
    /\bsx\s*[<>]?\s*(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i,
    /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s+(?:of\s+)?symptoms/i,
  ]);

  const ongoingChestPain = extractBoolean(
    lower,
    /\b(?:yes\s*-\s*)?ongoing (?:cardiac )?chest pain\b|\bchest pain is ongoing\b/i,
    /\bno ongoing (?:cardiac )?chest pain\b|\bchest pain (?:is )?not ongoing\b|\bno chest pain now\b/i
  );

  const hst0 = extractNumber(text, [
    /\b0\s*[- ]?\s*(?:hour|hr|h)\s*(?:hst|hs-tni|troponin)(?:\s+(?:is|=|value:))?\s*(\d+(?:\.\d+)?)\s*(?:ng\/?l)?/i,
    /\b(?:hst|hs-tni|troponin)\s*(?:0\s*[- ]?\s*(?:hour|hr|h))\s*(?:is|=|value:)?\s*(\d+(?:\.\d+)?)\s*(?:ng\/?l)?/i,
  ]);
  const hst2 = extractNumber(text, [
    /\b2\s*[- ]?\s*(?:hour|hr|h)\s*(?:hst|hs-tni|troponin)(?:\s+(?:is|=|value:))?\s*(\d+(?:\.\d+)?)\s*(?:ng\/?l)?/i,
    /\b(?:hst|hs-tni|troponin)\s*(?:2\s*[- ]?\s*(?:hour|hr|h))\s*(?:is|=|value:)?\s*(\d+(?:\.\d+)?)\s*(?:ng\/?l)?/i,
  ]);
  const hst4 = extractNumber(text, [
    /\b4\s*[- ]?\s*(?:hour|hr|h)\s*(?:hst|hs-tni|troponin)(?:\s+(?:is|=|value:))?\s*(\d+(?:\.\d+)?)\s*(?:ng\/?l)?/i,
    /\b(?:hst|hs-tni|troponin)\s*(?:4\s*[- ]?\s*(?:hour|hr|h))\s*(?:is|=|value:)?\s*(\d+(?:\.\d+)?)\s*(?:ng\/?l)?/i,
  ]);

  const suspicionMatch =
    /clinical suspicion(?: for acs)?\s*(?:is|:)?\s*(low|moderate|high)\b/i.exec(
      text
    ) ?? /\b(low|moderate|high)\s+clinical suspicion\b/i.exec(text);
  const clinicalSuspicion = suspicionMatch?.[1]?.toLowerCase() as
    | "low"
    | "moderate"
    | "high"
    | undefined;

  const heartComponents = compactObject({
    history: extractHeartComponent(text, "history", ["h"]),
    ekg: extractHeartComponent(text, "ekg", ["e"]),
    age: extractHeartComponent(text, "age", ["a"]),
    risk_factors: extractHeartComponent(text, "risk factors?", ["r"]),
    troponin: extractHeartComponent(text, "troponin", ["t"]),
  }) as HeartComponents;

  const fields: PathwayState["fields"] = compactObject({
    stemiOrEquivalent,
    ischemicChanges,
    sex,
    isEsrd,
    symptomDurationHours,
    ongoingChestPain,
    hst0,
    hst2,
    hst4,
    clinicalSuspicion,
    heartComponents:
      Object.keys(heartComponents).length > 0 ? heartComponents : undefined,
    recentNormalTesting: extractBoolean(
      lower,
      /\brecent normal (?:cardiac )?testing\b/i,
      /\bno recent normal (?:cardiac )?testing\b/i
    ),
    chronicUnchangedHst: extractBoolean(
      lower,
      /\bchronic unchanged hst\b|\bknown chronic unchanged hst\b/i,
      /\bno (?:known )?chronic unchanged hst\b/i
    ),
  });

  return {
    fields,
    presentFields: getPresentFields(fields),
    missingRequiredFields: getMissingRequiredFields(fields),
    nextAction: getNextAction(fields),
  };
}

export function buildPathwayStatePrompt(messages: UIMessage[]) {
  const state = resolvePathwayState(messages);

  return [
    "## SERVER-OWNED PATHWAY STATE",
    "The server parsed the clinician-provided pathway data below. Treat this as canonical context for what has already been captured.",
    `state_json: ${JSON.stringify(state)}`,
    `canonical_next_action: ${state.nextAction}`,
    "Do not re-ask for fields listed in presentFields unless the clinician corrects them. If all required values for a tool are present, call the tool instead of asking for the same value again.",
  ].join("\n");
}
