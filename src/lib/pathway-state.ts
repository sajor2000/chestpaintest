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

function userTexts(messages: UIMessage[]) {
  return messages
    .filter((message) => message.role === "user")
    .map(textFromMessage);
}

function latestMatch<T>(
  texts: string[],
  extractor: (text: string) => T | undefined
) {
  for (const text of [...texts].reverse()) {
    const value = extractor(text);
    if (value !== undefined) return value;
  }
  return undefined;
}

function extractBoolean(text: string, yesPattern: RegExp, noPattern: RegExp) {
  const yesMatch = yesPattern.exec(text);
  const noMatch = noPattern.exec(text);
  if (!yesMatch && !noMatch) return undefined;
  if (yesMatch && noMatch) {
    const noMatchEnd = noMatch.index + noMatch[0].length;
    if (noMatch.index <= yesMatch.index && yesMatch.index < noMatchEnd) {
      return false;
    }
    return yesMatch.index > noMatch.index;
  }
  return Boolean(yesMatch);
}

function extractLatestBoolean(
  text: string,
  yesPattern: RegExp,
  noPattern: RegExp
) {
  const noMatches = [...text.matchAll(noPattern)].map((match) => ({
    index: match.index,
    end: match.index + match[0].length,
    value: false,
  }));
  const yesMatches = [...text.matchAll(yesPattern)]
    .filter((match) => {
      const index = match.index;
      return !noMatches.some((no) => no.index <= index && index < no.end);
    })
    .map((match) => ({
      index: match.index,
      end: match.index + match[0].length,
      value: true,
    }));

  const latest = [...noMatches, ...yesMatches].sort(
    (a, b) => a.index - b.index
  ).at(-1);
  return latest?.value;
}

function extractLatestNumber(text: string, patterns: RegExp[]) {
  let latest: { index: number; value: number } | undefined;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1] === undefined) continue;
      if (!latest || match.index > latest.index) {
        latest = { index: match.index, value: Number(match[1]) };
      }
    }
  }
  return latest?.value;
}

function parseDurationHoursText(text: string) {
  const candidates: { index: number; value: number }[] = [];
  const hourMinutePattern =
    /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(?:and\s*)?(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/gi;
  for (const match of text.matchAll(hourMinutePattern)) {
    candidates.push({
      index: match.index,
      value: Number(match[1]) + Number(match[2]) / 60,
    });
  }

  const hourPattern = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/gi;
  for (const match of text.matchAll(hourPattern)) {
    const insideCombined = candidates.some(
      (candidate) =>
        candidate.index <= match.index && match.index < candidate.index + 30
    );
    if (!insideCombined) {
      candidates.push({ index: match.index, value: Number(match[1]) });
    }
  }

  const minutePattern = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/gi;
  for (const match of text.matchAll(minutePattern)) {
    const insideCombined = candidates.some(
      (candidate) =>
        candidate.index <= match.index && match.index < candidate.index + 40
    );
    if (!insideCombined) {
      candidates.push({ index: match.index, value: Number(match[1]) / 60 });
    }
  }

  return candidates.sort((a, b) => a.index - b.index).at(-1)?.value;
}

function removeRepeatEkgClauses(text: string) {
  return text
    .replace(
      /\b(?:repeat\s+)?[24]\s*[- ]?(?:hour|hr|h)?\s*repeat\s+ekg[^.\n]*/gi,
      ""
    )
    .replace(
      /\brepeat\s+[24]\s*[- ]?(?:hour|hr|h)?\s*ekg[^.\n]*/gi,
      ""
    );
}

function extractLatestHeartComponent(
  texts: string[],
  labelPattern: string
): 0 | 1 | 2 | undefined {
  return latestMatch(texts, (text) => {
    const match = new RegExp(
      `\\b(?:${labelPattern})\\b\\s*(?:score|component)?\\s*[:=]?\\s*([012])`,
      "gi"
    ).exec(text);
    if (!match) return undefined;
    return Number(match[1]) as 0 | 1 | 2;
  });
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
  const texts = userTexts(messages);

  const stemiOrEquivalent = latestMatch(texts, (text) =>
    extractLatestBoolean(
      text,
      /\b(?:yes\s*-\s*)?(?:stemi|stemi equivalent|stemi\/eqv)\b(?![^.\n]*\bno\b)/gi,
      /\bno\s+stemi\s+or\s+stemi equivalent\b|\bno\s+(?:stemi equivalent|stemi|stemi\/eqv)\b/gi
    )
  );
  const ischemicChanges = latestMatch(texts, (text) =>
    extractLatestBoolean(
      removeRepeatEkgClauses(text),
      /\b(?:yes\s*-\s*)?ischemic(?:\s+st\/?t|\s+st|\s+t-wave|\s+changes)?\b/gi,
      /\bno\s+ischemic\b|\bno\s+ischemic\s+st\/?t\b|\bno\s+ischemic\s+st\s+or\s+t-wave\b/gi
    )
  );

  const sex = latestMatch(texts, (text) => {
    const matches = [...text.matchAll(/\b(female|male)\b/gi)];
    const latest = matches.at(-1)?.[1]?.toLowerCase();
    return latest === "female" || latest === "male" ? latest : undefined;
  });

  const isEsrd = latestMatch(texts, (text) =>
    extractBoolean(
      text,
      /\besrd\s*:\s*yes\b|\b(?:yes\s*-\s*)?esrd\b|\bend-stage renal disease\b/gi,
      /\besrd\s*:\s*no\b|\bno\s+esrd\b|\bnot\s+esrd\b|\bno\s+end-stage renal\b/gi
    )
  );

  const symptomDurationHours = latestMatch(texts, (text) => {
    const durationContext =
      /\bsymptom duration\b|\bsymptoms?\s+(?:started|began)\b|\bsx\b|\bsymptoms?\b/i.test(
        text
      );
    if (durationContext) {
      const parsedDuration = parseDurationHoursText(text);
      if (parsedDuration !== undefined) return parsedDuration;
    }
    return extractLatestNumber(text, [
      /symptom duration:\s*(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/gi,
      /symptoms?\s+(?:started|began)\s+(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s+ago/gi,
      /\bsx\s*[<>]?\s*(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/gi,
      /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s+(?:of\s+)?symptoms/gi,
    ]);
  });

  const ongoingChestPain = latestMatch(texts, (text) =>
    extractBoolean(
      text,
      /\bongoing chest pain answer:\s*yes\b|\b(?:yes\s*-\s*)?ongoing (?:cardiac )?chest pain\b|\bchest pain is ongoing\b/gi,
      /\bongoing chest pain answer:\s*no\b|\bno ongoing (?:cardiac )?(?:chest )?pain\b|\bchest pain (?:is )?not ongoing\b|\bno chest pain now\b/gi
    )
  );

  const hst0 = latestMatch(texts, (text) =>
    extractLatestNumber(text, [
      /\b0\s*[- ]?\s*(?:hour|hr|h)\s*(?:hst|hs-?tni|troponin|trop)(?:\s+(?:is|=|value:))?\s*(\d+(?:\.\d+)?)\s*(?:ng\/?l)?/gi,
      /\b(?:hst|hs-?tni|troponin|trop)\s*(?:0\s*[- ]?\s*(?:hour|hr|h))\s*(?:is|=|value:)?\s*(\d+(?:\.\d+)?)\s*(?:ng\/?l)?/gi,
    ])
  );
  const hst2 = latestMatch(texts, (text) =>
    extractLatestNumber(text, [
      /\b2\s*[- ]?\s*(?:hour|hr|h)\s*(?:hst|hs-?tni|troponin|trop)(?:\s+(?:is|=|value:))?\s*(\d+(?:\.\d+)?)\s*(?:ng\/?l)?/gi,
      /\b(?:hst|hs-?tni|troponin|trop)\s*(?:2\s*[- ]?\s*(?:hour|hr|h))\s*(?:is|=|value:)?\s*(\d+(?:\.\d+)?)\s*(?:ng\/?l)?/gi,
    ])
  );
  const hst4 = latestMatch(texts, (text) =>
    extractLatestNumber(text, [
      /\b4\s*[- ]?\s*(?:hour|hr|h)\s*(?:hst|hs-?tni|troponin|trop)(?:\s+(?:is|=|value:))?\s*(\d+(?:\.\d+)?)\s*(?:ng\/?l)?/gi,
      /\b(?:hst|hs-?tni|troponin|trop)\s*(?:4\s*[- ]?\s*(?:hour|hr|h))\s*(?:is|=|value:)?\s*(\d+(?:\.\d+)?)\s*(?:ng\/?l)?/gi,
    ])
  );

  const clinicalSuspicion = latestMatch(texts, (text) => {
    const matches = [
      ...text.matchAll(
        /clinical suspicion(?: for acs)?\s*(?:is|:)?\s*(low|moderate|high)\b/gi
      ),
      ...text.matchAll(/\b(low|moderate|high)\s+clinical suspicion\b/gi),
    ].sort((a, b) => a.index - b.index);
    const latest = matches.at(-1)?.[1]?.toLowerCase();
    return latest === "low" || latest === "moderate" || latest === "high"
      ? latest
      : undefined;
  });

  const heartComponents = compactObject({
    history: extractLatestHeartComponent(texts, "history"),
    ekg: extractLatestHeartComponent(texts, "ekg"),
    age: extractLatestHeartComponent(texts, "age"),
    risk_factors: extractLatestHeartComponent(texts, "risk factors?"),
    troponin: extractLatestHeartComponent(texts, "troponin"),
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
    recentNormalTesting: latestMatch(texts, (text) =>
      extractBoolean(
        text,
        /\brecent normal (?:cardiac )?testing\b|\brecent normal (?:cardiac )?testing is present\b/gi,
        /\bno recent normal (?:cardiac )?testing\b/gi
      )
    ),
    chronicUnchangedHst: latestMatch(texts, (text) =>
      extractBoolean(
        text,
        /\bchronic unchanged hst\b|\bknown chronic unchanged hst\b/gi,
        /\bno (?:known )?chronic unchanged hst\b/gi
      )
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
