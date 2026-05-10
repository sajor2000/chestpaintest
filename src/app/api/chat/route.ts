import {
  createUIMessageStream,
  createUIMessageStreamResponse,
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
import {
  buildPathwayControllerPrompt,
  resolvePathwayController,
} from "@/lib/pathway-controller";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";

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

  const controllerSnapshot = await resolvePathwayController(messages);
  const result = streamText({
    model: getModel(),
    system: `${SYSTEM_PROMPT}\n\n${buildPathwayControllerPrompt(controllerSnapshot)}`,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(10),
    experimental_transform: () => createAssistantTextCleanupTransform(),
  });

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({
        type: "data-pathway-state",
        id: "pathway-state",
        data: controllerSnapshot,
      });
      writer.merge(result.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
}
