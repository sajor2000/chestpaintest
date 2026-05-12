import type { UIMessage } from "ai";

const MAX_MESSAGES = 80;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_FILE_DATA_URL_LENGTH = 1_400_000; // ~1 MB base64
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

type UnknownRecord = Record<string, unknown>;
type SanitizedTextPart = { type: "text"; text: string };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function normalizeYesNo(value: string) {
  const normalized = value.trim().toLowerCase();
  if (/^(yes|y|yes\s*-\s*.+)$/.test(normalized)) return "yes";
  if (/^(no|n|no\s+.+|no\s*-\s*.+)$/.test(normalized)) return "no";
  return null;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const TENS_WORDS: Record<string, number> = {
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function parseNumberLike(value: string) {
  const trimmed = value.trim().toLowerCase();
  const numeric = trimmed.match(/^(\d+(?:\.\d+)?)(?:\s*(?:h|hr|hrs|hour|hours))?(?:\s+ago)?$/);
  if (numeric) return numeric[1];
  if (NUMBER_WORDS[trimmed] !== undefined) {
    return NUMBER_WORDS[trimmed].toString();
  }

  const phrase = trimmed.replace(/-/g, " ");
  const parts = phrase.split(/\s+/);
  if (parts.length === 2 && TENS_WORDS[parts[0]] && NUMBER_WORDS[parts[1]]) {
    return (TENS_WORDS[parts[0]] + NUMBER_WORDS[parts[1]]).toString();
  }
  if (TENS_WORDS[phrase]) return TENS_WORDS[phrase].toString();
  return null;
}

function normalizeTextForPathwayContext(
  text: string,
  activeQuestion?: string | null
) {
  const trimmed = text.trim().toLowerCase();
  const extraPathwayText =
    text.trim().length > 24 &&
    /\b(heart components?|symptoms?|0\s*[- ]?hour|2\s*[- ]?hour|4\s*[- ]?hour|hst|hs-?tni|troponin|trop|clinical suspicion)\b/i.test(
      text
    )
      ? ` ${text.trim()}`
      : "";
  const question = activeQuestion?.toLowerCase() ?? "";
  const yesNo = normalizeYesNo(text);

  if (
    trimmed === "male" ||
    trimmed === "female" ||
    (question.includes("sex") && (trimmed === "m" || trimmed === "f"))
  ) {
    const sex = trimmed === "m" ? "male" : trimmed === "f" ? "female" : trimmed;
    return `Patient sex: ${sex}.`;
  }

  if (question.includes("stemi")) {
    if (yesNo) return yesNo === "yes" ? "Yes - STEMI." : "No STEMI.";
  }

  if (question.includes("esrd") || question.includes("end-stage renal")) {
    if (yesNo) {
      return `ESRD: ${yesNo}. This is not an HST/troponin value.${extraPathwayText}`;
    }
  }

  if (question.includes("ongoing") && question.includes("chest pain")) {
    if (yesNo) {
      const label =
        yesNo === "yes" ? "Yes - ongoing pain" : "No ongoing pain";
      return `Ongoing chest pain answer: ${label}. This is not an HST/troponin value.${extraPathwayText}`;
    }
  }

  if (question.includes("clinical suspicion")) {
    const suspicion = trimmed.match(/\b(low|moderate|high)\b/)?.[1];
    if (suspicion) {
      return `Clinical suspicion for ACS: ${suspicion}.`;
    }
  }

  if (question.includes("recent normal") && question.includes("testing")) {
    if (yesNo) {
      return yesNo === "yes"
        ? `Recent normal cardiac testing is present.${extraPathwayText}`
        : `No recent normal cardiac testing.${extraPathwayText}`;
    }
  }

  if (question.includes("chronic") && question.includes("hst")) {
    if (yesNo) {
      return yesNo === "yes"
        ? `Known chronic unchanged HST.${extraPathwayText}`
        : `No known chronic unchanged HST.${extraPathwayText}`;
    }
  }

  const parsedHeartNumber = parseNumberLike(text);
  const heartScore =
    text.trim().match(/^([012])(?:\s*[-–—].*)?$/)?.[1] ??
    (parsedHeartNumber && /^[012]$/.test(parsedHeartNumber)
      ? parsedHeartNumber
      : undefined);
  if (heartScore) {
    const heartComponent =
      question.includes("history") && question.includes("acs")
        ? "history"
        : question.includes("ekg") && question.includes("heart")
          ? "EKG"
          : question.includes("age") && question.includes("heart")
            ? "age"
            : question.includes("risk factor")
              ? "risk factors"
              : question.includes("troponin") && question.includes("heart")
                ? "troponin"
                : null;
    if (heartComponent) {
      return `HEART components: ${heartComponent} ${heartScore}.`;
    }
  }

  if (
    question.includes("repeat") &&
    question.includes("ekg") &&
    question.includes("ischemic")
  ) {
    if (yesNo) {
      const timepoint =
        question.match(/\b(2|4)[-\s]?(?:hour|hr)\b/)?.[1] ??
        question.match(/\b(2|4)h\b/)?.[1];
      const label = timepoint
        ? `${timepoint}-hour repeat EKG ischemic changes`
        : "Repeat EKG ischemic changes";
      return `${label}: ${yesNo}.`;
    }
  }

  if (
    question.includes("ischemic") &&
    (question.includes("ekg") ||
      question.includes("st") ||
      question.includes("t-wave"))
  ) {
    if (yesNo) {
      return yesNo === "yes"
        ? "Yes - ischemic changes."
        : "No ischemic changes.";
    }
  }

  if (
    question.includes("onset") &&
    question.includes("chest pain") &&
    text.trim().length <= 80
  ) {
    return `Chest pain onset: ${text.trim()}. This is not an HST/troponin value.`;
  }

  if (
    (question.includes("duration") ||
      (question.includes("how many") && question.includes("hours")) ||
      (question.includes("hours") && question.includes("present"))) &&
    (question.includes("symptom") ||
      question.includes("symptoms") ||
      question.includes("chest pain"))
  ) {
    const durationHours = parseNumberLike(text);
    if (durationHours !== null) {
      return `Symptom duration: ${durationHours} hours. This is not an HST/troponin value.`;
    }
  }

  if (
    (question.includes("hst") ||
      question.includes("hs-tni") ||
      question.includes("troponin"))
  ) {
    const parsedNumber = parseNumberLike(text);
    const hstPattern =
      /^(?:\d+(?:\.\d+)?(?:\s*ng\/?l)?|\d+(?:\.\d+)?\s*ng\/?l\s*(?:hst|hs-?tni|troponin|trop)|(?:hst|hs-?tni|troponin|trop)\s*(?:is|=)?\s*\d+(?:\.\d+)?(?:\s*ng\/?l)?)$/i;
    if (!parsedNumber && !hstPattern.test(text.trim())) return text;
    const timepoint =
      question.match(/\b(0|2|4)[-\s]?(?:hour|hr)\b/)?.[1] ??
      question.match(/\b(0|2|4)h\b/)?.[1];
    const label = timepoint ? `${timepoint}-hour HST value` : "HST value";
    const value = parsedNumber ?? text.trim().match(/\d+(?:\.\d+)?/)?.[0] ?? text.trim();
    return `${label}: ${value} ng/L.`;
  }

  return text;
}

function extractLastQuestion(text: string) {
  const questionEnd = text.lastIndexOf("?");
  if (questionEnd === -1) return null;

  const questionPrefix = text.slice(0, questionEnd + 1);
  const sentenceBreaks = [
    questionPrefix.lastIndexOf("\n"),
    questionPrefix.lastIndexOf(". "),
    questionPrefix.lastIndexOf("! "),
  ];
  const start = Math.max(...sentenceBreaks);
  const question =
    start === -1 ? questionPrefix.trim() : questionPrefix.slice(start + 1).trim();

  return question.length > 0 ? question : null;
}

function isActivePathwayPrompt(text: string) {
  const lower = text.toLowerCase();
  return (
    lower.includes("sex") ||
    lower.includes("esrd") ||
    lower.includes("end-stage renal") ||
    lower.includes("onset") ||
    lower.includes("duration") ||
    lower.includes("ongoing") ||
    lower.includes("hst") ||
    lower.includes("hs-tni") ||
    lower.includes("troponin") ||
    lower.includes("clinical suspicion") ||
    lower.includes("chest pain character")
  );
}

function extractActivePrompt(text: string) {
  const question = extractLastQuestion(text);
  if (question) return question;

  const candidates = text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?:\.|!)\s+/))
    .map((line) => line.trim())
    .filter(Boolean);
  for (const candidate of candidates.reverse()) {
    if (isActivePathwayPrompt(candidate)) return candidate;
  }
  return null;
}

function sanitizeUserTextPart(
  part: UnknownRecord,
  activeQuestion?: string | null
) {
  if (part.type !== "text") return null;
  if (typeof part.text !== "string") {
    throw new RequestValidationError("text parts require text");
  }
  return {
    type: "text" as const,
    text: normalizeTextForPathwayContext(part.text, activeQuestion).slice(
      0,
      MAX_MESSAGE_LENGTH
    ),
  };
}

function sanitizeAssistantQuestionPart(parts: unknown[]): SanitizedTextPart | null {
  const controllerQuestion = parts
    .filter(isRecord)
    .map((part) => {
      if (part.type !== "data-pathway-state" || !isRecord(part.data)) {
        return null;
      }
      return typeof part.data.question === "string" ? part.data.question : null;
    })
    .filter((question): question is string => Boolean(question?.trim()))
    .pop();
  if (controllerQuestion) {
    return {
      type: "text",
      text: controllerQuestion.slice(0, MAX_MESSAGE_LENGTH),
    };
  }

  const assistantText = parts
    .filter(isRecord)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
  const question = extractActivePrompt(assistantText);
  if (!question) return null;

  return {
    type: "text",
    text: question.slice(0, MAX_MESSAGE_LENGTH),
  };
}

function sanitizeFilePart(part: UnknownRecord) {
  if (part.type !== "file") return null;
  const { mediaType, url, filename } = part;
  if (typeof mediaType !== "string" || !ALLOWED_IMAGE_TYPES.has(mediaType)) {
    return null;
  }
  if (typeof url !== "string" || url.length > MAX_FILE_DATA_URL_LENGTH) {
    return null;
  }
  if (!url.startsWith(`data:${mediaType};base64,`)) {
    return null;
  }
  return {
    type: "file" as const,
    mediaType,
    url,
    ...(typeof filename === "string" ? { filename } : {}),
  };
}

type SanitizedPart = NonNullable<
  ReturnType<typeof sanitizeUserTextPart> | ReturnType<typeof sanitizeFilePart>
>;

export function sanitizeClientMessages(messages: unknown): UIMessage[] {
  if (!Array.isArray(messages)) {
    throw new RequestValidationError("messages array required");
  }

  const sanitizedMessages: UIMessage[] = [];
  let lastAssistantQuestion: string | null = null;

  const relevantMessages = messages
    .filter(
      (message) =>
        isRecord(message) &&
        (message.role === "user" || message.role === "assistant")
    )
    .slice(-MAX_MESSAGES);

  for (const message of relevantMessages) {
    if (!Array.isArray(message.parts)) {
      throw new RequestValidationError("message parts array required");
    }

    if (message.role === "assistant") {
      const part = sanitizeAssistantQuestionPart(message.parts);
      if (part) {
        lastAssistantQuestion = part.text;
        sanitizedMessages.push({
          id: typeof message.id === "string" ? message.id : crypto.randomUUID(),
          role: "assistant",
          parts: [part],
        });
      }
      continue;
    }

    const parts: SanitizedPart[] = [];
    for (const part of message.parts as unknown[]) {
      if (!isRecord(part)) continue;
      const sanitizedPart =
        sanitizeUserTextPart(part, lastAssistantQuestion) ??
        sanitizeFilePart(part);
      if (sanitizedPart) parts.push(sanitizedPart);
    }

    if (parts.length > 0) {
      sanitizedMessages.push({
        id: typeof message.id === "string" ? message.id : crypto.randomUUID(),
        role: "user",
        parts,
      });
    }
  }

  return sanitizedMessages;
}
