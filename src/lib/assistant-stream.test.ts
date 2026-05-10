import { describe, expect, it } from "vitest";

import {
  cleanAssistantText,
  createAssistantTextCleanupTransform,
} from "./assistant-stream";

describe("assistant stream cleanup", () => {
  it("removes button filler from complete assistant text", () => {
    expect(
      cleanAssistantText(
        "Hello. Does the EKG show STEMI or STEMI equivalent? I will provide options."
      )
    ).toBe("Hello. Does the EKG show STEMI or STEMI equivalent?");
  });

  it("cleans forbidden filler even when the model streamed it across token chunks", async () => {
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-start", id: "0" });
        controller.enqueue({ type: "text-delta", id: "0", text: "Hello." });
        controller.enqueue({ type: "text-delta", id: "0", text: " Does" });
        controller.enqueue({ type: "text-delta", id: "0", text: " the EKG show STEMI?" });
        controller.enqueue({ type: "text-delta", id: "0", text: " I" });
        controller.enqueue({ type: "text-delta", id: "0", text: " will" });
        controller.enqueue({ type: "text-delta", id: "0", text: " provide" });
        controller.enqueue({ type: "text-delta", id: "0", text: " options." });
        controller.enqueue({ type: "text-end", id: "0" });
        controller.close();
      },
    });

    const output = input.pipeThrough(createAssistantTextCleanupTransform());
    const reader = output.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(chunks).toEqual([
      { type: "text-start", id: "0" },
      { type: "text-delta", id: "0", text: "Hello. Does the EKG show STEMI?" },
      { type: "text-end", id: "0" },
    ]);
  });
});
