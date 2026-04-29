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

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
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
