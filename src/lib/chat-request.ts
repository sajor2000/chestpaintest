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

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function sanitizeTextPart(part: UnknownRecord) {
  if (part.type !== "text") return null;
  if (typeof part.text !== "string") {
    throw new RequestValidationError("text parts require text");
  }
  return { type: "text" as const, text: part.text.slice(0, MAX_MESSAGE_LENGTH) };
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
  ReturnType<typeof sanitizeTextPart> | ReturnType<typeof sanitizeFilePart>
>;

export function sanitizeClientMessages(messages: unknown): UIMessage[] {
  if (!Array.isArray(messages)) {
    throw new RequestValidationError("messages array required");
  }

  return messages
    .filter((message) => isRecord(message) && message.role === "user")
    .slice(-MAX_MESSAGES)
    .map((message) => {
      if (!Array.isArray(message.parts)) {
        throw new RequestValidationError("message parts array required");
      }

      const parts: SanitizedPart[] = [];
      for (const part of message.parts as unknown[]) {
        if (!isRecord(part)) continue;
        const sanitizedPart = sanitizeTextPart(part) ?? sanitizeFilePart(part);
        if (sanitizedPart) parts.push(sanitizedPart);
      }

      return {
        id: typeof message.id === "string" ? message.id : crypto.randomUUID(),
        role: "user" as const,
        parts,
      };
    })
    .filter((message) => message.parts.length > 0) as UIMessage[];
}
