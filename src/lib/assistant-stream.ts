import type { TextStreamPart, ToolSet } from "ai";

import {
  cleanQuickReplyPromptText,
  cleanRepeatedQuestionText,
} from "./pathway-ui";

export function cleanAssistantText(text: string) {
  return cleanRepeatedQuestionText(cleanQuickReplyPromptText(text));
}

export function createAssistantTextCleanupTransform<TOOLS extends ToolSet>() {
  let activeTextPart:
    | {
        id: string;
        text: string;
      }
    | undefined;

  function flush(controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>) {
    if (!activeTextPart) return;
    const cleaned = cleanAssistantText(activeTextPart.text);
    if (cleaned) {
      controller.enqueue({
        type: "text-delta",
        id: activeTextPart.id,
        text: cleaned,
      } as TextStreamPart<TOOLS>);
    }
    activeTextPart = undefined;
  }

  return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
    transform(part, controller) {
      if (part.type === "text-delta") {
        activeTextPart = {
          id: part.id,
          text: `${activeTextPart?.text ?? ""}${part.text}`,
        };
        return;
      }

      if (part.type === "text-end") {
        flush(controller);
        controller.enqueue(part);
        return;
      }

      flush(controller);
      controller.enqueue(part);
    },
    flush(controller) {
      flush(controller);
    },
  });
}
