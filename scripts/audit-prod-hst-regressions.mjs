import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { HST_WORD_DOCUMENT_CASES } from "./hst-word-document-cases.mjs";

const PROD_BASE_URL =
  process.env.PROD_BASE_URL ?? "https://rush-chest-pain-cds.vercel.app";
const OUTPUT_DIR = path.resolve("output/hst-regressions");
const CHAT_TIMEOUT_MS = Number(process.env.HST_REPLAY_TIMEOUT_MS ?? 30_000);

function nowIso() {
  return new Date().toISOString();
}

function uiMessage(id, text) {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function fixtureMessageToUiMessage(testCase, message, index) {
  const id = `${testCase.name}-${index}`;
  if (typeof message === "string") return uiMessage(id, message);
  return {
    id,
    role: message.role,
    parts: message.parts ?? [{ type: "text", text: message.text }],
  };
}

function resultData(state, kind) {
  return state.results?.findLast?.((result) => result.kind === kind)?.data ?? null;
}

function resultDataForHour(state, kind, hour) {
  return (
    state.results?.findLast?.(
      (result) => result.kind === kind && result.hour === hour
    )?.data ?? null
  );
}

function summarizeState(state) {
  const disposition = resultData(state, "determine_disposition");
  const delta = resultData(state, "calculate_delta");
  const ekg = resultData(state, "assess_ekg");
  const trop0 = resultDataForHour(state, "evaluate_troponin", "0");

  return {
    step: state.step,
    requiredField: state.requiredField ?? null,
    terminal: state.terminal ?? false,
    action: ekg?.action ?? null,
    risk: disposition?.risk ?? null,
    disposition: disposition?.disposition ?? null,
    deltaCategory: delta?.delta_category ?? null,
    significantDelta: delta?.significant ?? null,
    clinicalDeltaFlag: delta?.clinical_delta_flag ?? null,
    deltaMethod: delta?.method ?? null,
    deltaDirection: delta?.direction ?? null,
    url99Threshold0: trop0?.url_99_threshold ?? null,
    aboveUrl0: trop0?.above_url ?? null,
    footnotes: state.results?.flatMap((result) => result.data?.footnotes ?? []) ?? [],
    symptomDurationHours: state.values?.symptomDurationHours ?? null,
  };
}

function streamDataParts(streamText) {
  return streamText
    .split(/\n+/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length).trim())
    .filter((line) => line && line !== "[DONE]")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function pathwayStatePart(streamText) {
  return streamDataParts(streamText).find(
    (part) => part.type === "data-pathway-state"
  )?.data;
}

async function postChat(messages) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CHAT_TIMEOUT_MS);
    try {
      const response = await fetch(`${PROD_BASE_URL.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`POST /api/chat returned ${response.status}: ${text.slice(0, 300)}`);
      }
      return text;
    } catch (error) {
      lastError = timedOut
        ? new Error(`POST /api/chat timed out after ${CHAT_TIMEOUT_MS} ms`)
        : error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function assertExpected(summary, expected) {
  const mismatches = [];
  for (const [key, value] of Object.entries(expected)) {
    if (key === "deltaMethodIncludes") {
      if (!summary.deltaMethod?.includes(value)) {
        mismatches.push(`deltaMethod: expected to include ${value}, got ${summary.deltaMethod}`);
      }
    } else if (key === "footnoteIncludes") {
      if (!summary.footnotes?.includes(value)) {
        mismatches.push(`footnotes: expected to include ${value}, got ${summary.footnotes}`);
      }
    } else if (summary[key] !== value) {
      mismatches.push(`${key}: expected ${value}, got ${summary[key]}`);
    }
  }
  return mismatches;
}

async function runCase(testCase) {
  try {
    const stream = await postChat(
      testCase.messages.map((message, index) =>
        fixtureMessageToUiMessage(testCase, message, index)
      )
    );
    const state = pathwayStatePart(stream);
    if (!state) {
      throw new Error(`stream did not include data-pathway-state: ${stream.slice(0, 300)}`);
    }
    const summary = summarizeState(state);
    const mismatches = assertExpected(summary, testCase.expected);
    return {
      name: testCase.name,
      status: mismatches.length === 0 ? "pass" : "fail",
      expected: testCase.expected,
      actual: summary,
      detail: mismatches.join("; "),
    };
  } catch (error) {
    return {
      name: testCase.name,
      status: "fail",
      expected: testCase.expected,
      actual: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const startedAt = nowIso();
  await mkdir(OUTPUT_DIR, { recursive: true });
  console.log(`HST production Word-document replay started at ${startedAt}`);
  console.log(`Target: ${PROD_BASE_URL}`);
  console.log(`Artifacts: ${OUTPUT_DIR}`);

  const results = [];
  for (const testCase of HST_WORD_DOCUMENT_CASES) {
    const result = await runCase(testCase);
    results.push(result);
    const marker = result.status === "pass" ? "PASS" : "FAIL";
    console.log(`${marker} ${result.name}${result.detail ? ` - ${result.detail}` : ""}`);
  }

  const failed = results.filter((result) => result.status === "fail");
  const summary = {
    target: PROD_BASE_URL,
    startedAt,
    finishedAt: nowIso(),
    casesRun: results.length,
    results,
  };
  const summaryFile = path.join(OUTPUT_DIR, "hst-regression-summary.json");
  await writeFile(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Summary: ${summaryFile}`);

  if (failed.length > 0) {
    console.error(`${failed.length} HST regression replay case(s) failed.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
