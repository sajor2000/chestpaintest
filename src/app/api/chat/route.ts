import {
  streamText,
  UIMessage,
  convertToModelMessages,
  stepCountIs,
} from "ai";
import { model } from "@/lib/azure";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import {
  assessEkg,
  evaluateTroponin,
  calculateDelta,
  calculateHeartScore,
  determineDisposition,
} from "@/lib/tools";

const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_FILE_DATA_URL_LENGTH = 1_400_000; // ~1 MB base64
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function validateMessages(messages: UIMessage[]): UIMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      ...m,
      parts: m.parts
        .map((p) => {
          if (p.type === "text") {
            return { ...p, text: p.text.slice(0, MAX_MESSAGE_LENGTH) };
          }
          if (
            p.type === "file" &&
            "mediaType" in p &&
            "url" in p
          ) {
            const fp = p as { type: "file"; mediaType?: string; url?: string };
            if (!fp.mediaType || !ALLOWED_IMAGE_TYPES.has(fp.mediaType)) return null;
            if (!fp.url || fp.url.length > MAX_FILE_DATA_URL_LENGTH) return null;
            return p;
          }
          return p;
        })
        .filter((p): p is NonNullable<typeof p> => p !== null),
    }));
}

export async function POST(req: Request) {
  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
    });
  }

  if (!Array.isArray(body.messages)) {
    return new Response(JSON.stringify({ error: "messages array required" }), {
      status: 400,
    });
  }

  const messages = validateMessages(body.messages as UIMessage[]);

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(10),
    tools: {
      assess_ekg: assessEkg,
      evaluate_troponin: evaluateTroponin,
      calculate_delta: calculateDelta,
      calculate_heart_score: calculateHeartScore,
      determine_disposition: determineDisposition,
    },
  });

  return result.toUIMessageStreamResponse();
}
