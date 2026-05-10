import type { UIMessage } from "ai";

const MAX_MESSAGES = 30;
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

function normalizeTextForPathwayContext(
  text: string,
  activeQuestion?: string | null
) {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "male" || trimmed === "female") {
    return `Patient sex: ${trimmed}.`;
  }

  const question = activeQuestion?.toLowerCase() ?? "";
  const yesNo = normalizeYesNo(text);

  if (question.includes("esrd") || question.includes("end-stage renal")) {
    if (yesNo) return `ESRD: ${yesNo}. This is not an HST/troponin value.`;
  }

  if (question.includes("ongoing") && question.includes("chest pain")) {
    if (yesNo) {
      const label =
        yesNo === "yes" ? "Yes - ongoing pain" : "No ongoing pain";
      return `Ongoing chest pain answer: ${label}. This is not an HST/troponin value.`;
    }
  }

  if (question.includes("clinical suspicion")) {
    if (["low", "moderate", "high"].includes(trimmed)) {
      return `Clinical suspicion for ACS: ${trimmed}.`;
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
      question.includes("chest pain")) &&
    /^\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours)$/i.test(text.trim())
  ) {
    return `Symptom duration: ${text.trim()}. This is not an HST/troponin value.`;
  }

  if (
    (question.includes("hst") ||
      question.includes("hs-tni") ||
      question.includes("troponin")) &&
    /^\d+(?:\.\d+)?(?:\s*ng\/?l)?$/i.test(text.trim())
  ) {
    const timepoint =
      question.match(/\b(0|2|4)[-\s]?(?:hour|hr)\b/)?.[1] ??
      question.match(/\b(0|2|4)h\b/)?.[1];
    const label = timepoint ? `${timepoint}-hour HST value` : "HST value";
    const value = text.trim().replace(/\s*ng\/?l$/i, "");
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
