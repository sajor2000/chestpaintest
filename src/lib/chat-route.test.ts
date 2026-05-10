import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/azure", () => ({
  getModel: () => "mock-model",
}));

vi.mock("@/lib/chat-request", async () => {
  return await import("./chat-request");
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

vi.mock("ai", () => ({
  convertToModelMessages: vi.fn(async (messages) => messages),
  stepCountIs: vi.fn((steps) => ({ steps })),
  streamText: vi.fn(() => ({
    toUIMessageStreamResponse: () => new Response("ok"),
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

  it("adds server-owned pathway state to the model system prompt", async () => {
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
                  text: "No STEMI. Female. No ESRD. Symptoms started 5 hours ago. 0-hour HST is 3 ng/L.",
                },
              ],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("SERVER-OWNED PATHWAY STATE"),
      })
    );
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('"sex":"female"'),
      })
    );
  });
});
