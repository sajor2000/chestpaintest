import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/azure", () => ({
  model: {},
}));

vi.mock("@/lib/chat-request", async () => {
  return await import("./chat-request");
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
});
