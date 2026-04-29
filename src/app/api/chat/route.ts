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

function validateMessages(messages: UIMessage[]): UIMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      ...m,
      parts: m.parts.map((p) =>
        p.type === "text"
          ? { ...p, text: p.text.slice(0, MAX_MESSAGE_LENGTH) }
          : p
      ),
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
