import {
  streamText,
  convertToModelMessages,
  stepCountIs,
} from "ai";
import { getModel } from "@/lib/azure";
import {
  RequestValidationError,
  sanitizeClientMessages,
} from "@/lib/chat-request";
import { createAssistantTextCleanupTransform } from "@/lib/assistant-stream";
import { buildPathwayStatePrompt } from "@/lib/pathway-state";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import {
  assessEkg,
  evaluateTroponin,
  calculateDelta,
  calculateHeartScore,
  determineDisposition,
  suggestFollowups,
} from "@/lib/tools";

const MAX_CHAT_REQUEST_BODY_BYTES = 2_000_000;

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_CHAT_REQUEST_BODY_BYTES
  ) {
    return new Response(JSON.stringify({ error: "Request body too large" }), {
      status: 413,
    });
  }

  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
    });
  }

  let messages;
  try {
    messages = sanitizeClientMessages(body.messages);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
      });
    }
    throw error;
  }

  if (messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "at least one user message required" }),
      { status: 400 }
    );
  }

  const result = streamText({
    model: getModel(),
    system: `${SYSTEM_PROMPT}\n\n${buildPathwayStatePrompt(messages)}`,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(10),
    experimental_transform: () => createAssistantTextCleanupTransform(),
    tools: {
      assess_ekg: assessEkg,
      evaluate_troponin: evaluateTroponin,
      calculate_delta: calculateDelta,
      calculate_heart_score: calculateHeartScore,
      determine_disposition: determineDisposition,
      suggest_followups: suggestFollowups,
    },
  });

  return result.toUIMessageStreamResponse();
}
