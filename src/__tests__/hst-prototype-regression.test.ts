import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { HST_WORD_DOCUMENT_CASES } from "../../scripts/hst-word-document-cases.mjs";
import { sanitizeClientMessages } from "../lib/chat-request";
import { resolvePathwayController } from "../lib/pathway-controller";

type FixtureMessage =
  | string
  | {
      role: "user" | "assistant";
      text?: string;
      parts?: UIMessage["parts"];
    };

const textPart = (text: string) => ({ type: "text" as const, text });

function fixtureMessageToUiMessage(
  testCase: { name: string },
  message: FixtureMessage,
  index: number
): UIMessage {
  const id = `${testCase.name}-${index}`;
  if (typeof message === "string") {
    return { id, role: "user", parts: [textPart(message)] };
  }
  return {
    id,
    role: message.role,
    parts: message.parts ?? [textPart(message.text ?? "")],
  };
}

function resultData(
  snapshot: Awaited<ReturnType<typeof resolvePathwayController>>,
  kind: string
) {
  return snapshot.results.findLast((result) => result.kind === kind)?.data ?? null;
}

function resultDataForHour(
  snapshot: Awaited<ReturnType<typeof resolvePathwayController>>,
  kind: string,
  hour: string
) {
  return (
    snapshot.results.findLast(
      (result) => result.kind === kind && result.hour === hour
    )?.data ?? null
  );
}

function summarizeSnapshot(
  snapshot: Awaited<ReturnType<typeof resolvePathwayController>>
) {
  const disposition = resultData(snapshot, "determine_disposition");
  const delta = resultData(snapshot, "calculate_delta");
  const ekg = resultData(snapshot, "assess_ekg");
  const trop0 = resultDataForHour(snapshot, "evaluate_troponin", "0");

  return {
    requiredField: snapshot.requiredField,
    terminal: snapshot.terminal,
    action: ekg?.action ?? null,
    risk: disposition?.risk ?? null,
    deltaCategory: delta?.delta_category ?? null,
    significantDelta: delta?.significant ?? null,
    deltaMethod: delta?.method ?? null,
    deltaDirection: delta?.direction ?? null,
    url99Threshold0: trop0?.url_99_threshold ?? null,
    aboveUrl0: trop0?.above_url ?? null,
    footnotes: snapshot.results.flatMap((result) => result.data?.footnotes ?? []),
    symptomDurationHours: snapshot.values.symptomDurationHours ?? null,
  };
}

function expectSummaryToMatchExpected(
  summary: ReturnType<typeof summarizeSnapshot>,
  expected: Record<string, unknown>
) {
  for (const [key, value] of Object.entries(expected)) {
    if (key === "deltaMethodIncludes") {
      expect(summary.deltaMethod).toContain(value);
    } else if (key === "footnoteIncludes") {
      expect(summary.footnotes).toContain(value);
    } else {
      expect(summary).toMatchObject({ [key]: value });
    }
  }
}

describe("June 2026 HST Word-document regression cases", () => {
  it.each(HST_WORD_DOCUMENT_CASES)("$name", async (testCase) => {
    const messages = testCase.messages.map((message: FixtureMessage, index: number) =>
      fixtureMessageToUiMessage(testCase, message, index)
    );
    const controllerMessages = sanitizeClientMessages(messages);
    const snapshot = await resolvePathwayController(controllerMessages);

    expectSummaryToMatchExpected(
      summarizeSnapshot(snapshot),
      testCase.expected as Record<string, unknown>
    );
  });

  it("normalizes the compound-duration active-question answer before controller resolution", () => {
    const testCase = HST_WORD_DOCUMENT_CASES.find((entry) =>
      entry.name.startsWith("General bug")
    );
    expect(testCase).toBeDefined();

    const messages = testCase!.messages.map(
      (message: FixtureMessage, index: number) =>
        fixtureMessageToUiMessage(testCase!, message, index)
    );
    const sanitized = sanitizeClientMessages(messages);

    expect(sanitized.at(-1)).toEqual({
      id: `${testCase!.name}-5`,
      role: "user",
      parts: [
        {
          type: "text",
          text: "Symptom duration: 3.25 hours. This is not an HST/troponin value.",
        },
      ],
    });
  });
});
