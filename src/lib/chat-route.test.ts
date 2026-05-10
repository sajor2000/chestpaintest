import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/azure", () => ({
  getModel: () => "mock-model",
}));

vi.mock("@/lib/chat-request", async () => {
  return await import("./chat-request");
});

vi.mock("@/lib/assistant-stream", async () => {
  return await import("./assistant-stream");
});

vi.mock("@/lib/pathway-controller", async () => {
  return await import("./pathway-controller");
});

vi.mock("@/lib/pathway-state", async () => {
  return await import("./pathway-state");
});

vi.mock("@/lib/system-prompt", () => ({
  SYSTEM_PROMPT: "test prompt",
}));

vi.mock("@/lib/tools", () => ({
  assessEkg: {},
  evaluateTroponin: {},
  calculateDelta: {},
  calculateHeartScore: {},
  determineDisposition: {},
  suggestFollowups: {},
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  createUIMessageStream: vi.fn(({ execute }) => {
    const writes: unknown[] = [];
    const writer = {
      write: vi.fn((part) => writes.push(part)),
      merge: vi.fn(),
    };
    execute({ writer });
    return { writes, writer };
  }),
  createUIMessageStreamResponse: vi.fn(({ stream }) => {
    return new Response(JSON.stringify(stream.writes));
  }),
  convertToModelMessages: vi.fn(async (messages) => messages),
  stepCountIs: vi.fn((steps) => ({ steps })),
  streamText: vi.fn(() => ({
    toUIMessageStream: () => "model-stream",
  })),
}));

describe("/api/chat", () => {
  it("rejects oversized requests from content-length before parsing the body", async () => {
    const { POST } = await import("../app/api/chat/route");

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          "content-length": "2000001",
          "content-type": "application/json",
        },
        body: JSON.stringify({ messages: [] }),
      })
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Request body too large",
    });
  });

  it("streams canonical pathway state and binds the model to the controller step", async () => {
    const { streamText } = await import("ai");
    const { POST } = await import("../app/api/chat/route");

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              id: "u1",
              role: "user",
              parts: [
                {
                  type: "text",
                  text: "No STEMI. No ischemic changes. Female. No ESRD. Symptoms started 5 hours ago. 0-hour HST is 3 ng/L.",
                },
              ],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        type: "data-pathway-state",
        id: "pathway-state",
        data: expect.objectContaining({
          step: "troponin0",
          requiredField: "clinicalSuspicion",
          allowedOptions: ["Low", "Moderate", "High"],
        }),
      }),
    ]);
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("SERVER-OWNED PATHWAY CONTROLLER"),
      })
    );
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("requiredField"),
      })
    );
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        experimental_transform: expect.any(Function),
      })
    );
    expect(streamText).toHaveBeenCalledWith(
      expect.not.objectContaining({
        tools: expect.anything(),
      })
    );
  });
});
