import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { sanitizeClientMessages } from "../lib/chat-request";
import { resolvePathwayController } from "../lib/pathway-controller";
import { resolvePathwayState } from "../lib/pathway-state";

const userMessage = (text: string): UIMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

const resolve = (text: string) => resolvePathwayController([userMessage(text)]);

const baseText =
  "No STEMI. No ischemic changes. Male. No ESRD. Symptoms started 5 hours ago.";

describe("June 2026 HST prototype regression cases", () => {
  it("routes significant 2-hour absolute delta below URL to high risk without 4-hour HST", async () => {
    const snapshot = await resolve(
      `${baseText} 0-hour HST is 6 ng/L. 2-hour HST is 21 ng/L. 2-hour repeat EKG ischemic changes: no.`
    );

    expect(snapshot.terminal).toBe(true);
    expect(snapshot.requiredField).toBeNull();
    expect(snapshot.results).toContainEqual(
      expect.objectContaining({
        kind: "calculate_delta",
        hour: "2",
        data: expect.objectContaining({ delta_category: "significant" }),
      })
    );
    expect(snapshot.results.at(-1)).toMatchObject({
      kind: "determine_disposition",
      data: { risk: "HIGH" },
    });
  });

  it("applies the high-value 20 percent delta rule at 2 hours without falling back to 4-hour HST", async () => {
    const snapshot = await resolve(
      `${baseText} 0-hour HST is 100 ng/L. 2-hour HST is 120 ng/L. 2-hour repeat EKG ischemic changes: no.`
    );

    expect(snapshot.terminal).toBe(true);
    expect(snapshot.requiredField).toBeNull();
    expect(snapshot.results).toContainEqual(
      expect.objectContaining({
        kind: "calculate_delta",
        hour: "2",
        data: expect.objectContaining({
          delta_category: "significant",
          method: expect.stringContaining("20% change rule"),
        }),
      })
    );
    expect(snapshot.results.at(-1)).toMatchObject({
      kind: "determine_disposition",
      data: { risk: "HIGH" },
    });
  });

  it("does not ask ongoing chest pain after a falling significant delta has already ruled high risk", async () => {
    const snapshot = await resolve(
      `${baseText} 0-hour HST is 30 ng/L. 2-hour HST is 10 ng/L. 2-hour repeat EKG ischemic changes: no.`
    );

    expect(snapshot.terminal).toBe(true);
    expect(snapshot.requiredField).toBeNull();
    expect(snapshot.results).toContainEqual(
      expect.objectContaining({
        kind: "calculate_delta",
        data: expect.objectContaining({
          delta_category: "significant",
          direction: "falling",
        }),
      })
    );
    expect(snapshot.results.at(-1)).toMatchObject({
      kind: "determine_disposition",
      data: { risk: "HIGH" },
    });
  });

  it("does not offer chronic injury after the intermediate-delta 4-hour branch", async () => {
    const snapshot = await resolve(
      `${baseText} 0-hour HST is 16 ng/L. 2-hour HST is 25 ng/L. 2-hour repeat EKG ischemic changes: no. 4-hour HST is 20 ng/L. 4-hour repeat EKG ischemic changes: no. No ongoing chest pain. HEART components: history 1, EKG 1, age 1, risk factors 1, troponin 0. No recent normal cardiac testing and no known chronic unchanged HST.`
    );

    expect(snapshot.terminal).toBe(true);
    expect(snapshot.requiredField).toBeNull();
    expect(snapshot.results).toContainEqual(
      expect.objectContaining({
        kind: "calculate_delta",
        hour: "2",
        data: expect.objectContaining({ delta_category: "intermediate" }),
      })
    );
    expect(snapshot.results.at(-1)).toMatchObject({
      kind: "determine_disposition",
      data: { risk: "INTERMEDIATE" },
    });
  });

  it("routes female above-URL minimal serial delta to chronic injury without 4-hour HST", async () => {
    const snapshot = await resolve(
      "No STEMI. No ischemic changes. Female. No ESRD. Symptoms started 5 hours ago. 0-hour HST is 16 ng/L. 2-hour HST is 17 ng/L. 2-hour repeat EKG ischemic changes: no."
    );

    expect(snapshot.terminal).toBe(true);
    expect(snapshot.requiredField).toBeNull();
    expect(snapshot.results).toContainEqual(
      expect.objectContaining({
        kind: "evaluate_troponin",
        hour: "0",
        data: expect.objectContaining({
          url_99_threshold: 14,
          above_url: true,
        }),
      })
    );
    expect(snapshot.results.at(-1)).toMatchObject({
      kind: "determine_disposition",
      data: { risk: "CHRONIC_INJURY" },
    });
  });

  it("parses compound symptom duration text and advances to the 0-hour HST prompt", () => {
    const sanitized = sanitizeClientMessages([
      {
        id: "assistant-duration",
        role: "assistant",
        parts: [
          { type: "text", text: "How many hours have the symptoms been present?" },
        ],
      },
      {
        id: "user-duration",
        role: "user",
        parts: [{ type: "text", text: "3 hours 15 minutes" }],
      },
    ]);
    const state = resolvePathwayState([
      userMessage(
        "No STEMI. No ischemic changes. Male. No ESRD. Symptoms started 3 hours 15 minutes ago."
      ),
    ]);

    expect(sanitized.at(-1)).toEqual({
      id: "user-duration",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Symptom duration: 3.25 hours. This is not an HST/troponin value.",
        },
      ],
    });
    expect(state.fields.symptomDurationHours).toBe(3.25);
    expect(state.nextAction).toBe("Ask for the 0-hour HST value in ng/L.");
  });
});
