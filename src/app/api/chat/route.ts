import {
  streamText,
  convertToModelMessages,
  stepCountIs,
} from "ai";
import { model } from "@/lib/azure";
import {
  RequestValidationError,
  sanitizeClientMessages,
} from "@/lib/chat-request";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import {
  assessEkg,
  evaluateTroponin,
  calculateDelta,
  calculateHeartScore,
  determineDisposition,
  suggestFollowups,
} from "@/lib/tools";

export async function POST(req: Request) {
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
      suggest_followups: suggestFollowups,
    },
  });

  return result.toUIMessageStreamResponse();
}
