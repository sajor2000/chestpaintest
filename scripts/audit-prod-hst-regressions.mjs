import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PROD_BASE_URL =
  process.env.PROD_BASE_URL ?? "https://rush-chest-pain-cds.vercel.app";
const OUTPUT_DIR = path.resolve("output/hst-regressions");

function nowIso() {
  return new Date().toISOString();
}

function uiMessage(id, text) {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function resultData(state, kind) {
  return state.results?.findLast?.((result) => result.kind === kind)?.data ?? null;
}

function summarizeState(state) {
  const disposition = resultData(state, "determine_disposition");
  const delta = resultData(state, "calculate_delta");

  return {
    step: state.step,
    requiredField: state.requiredField ?? null,
    terminal: state.terminal ?? false,
    risk: disposition?.risk ?? null,
    disposition: disposition?.disposition ?? null,
    deltaCategory: delta?.delta_category ?? null,
    significantDelta: delta?.significant ?? null,
    clinicalDeltaFlag: delta?.clinical_delta_flag ?? null,
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
    try {
      const response = await fetch(`${PROD_BASE_URL.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`POST /api/chat returned ${response.status}: ${text.slice(0, 300)}`);
      }
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
      }
    }
  }
  throw lastError;
}

function assertExpected(summary, expected) {
  const mismatches = [];
  for (const [key, value] of Object.entries(expected)) {
    if (summary[key] !== value) {
      mismatches.push(`${key}: expected ${value}, got ${summary[key]}`);
    }
  }
  return mismatches;
}

const CASES = [
  {
    name: "significant 2hr absolute delta below URL routes high",
    messages: [
      uiMessage("1a", "No STEMI."),
      uiMessage("1b", "No ischemic EKG changes."),
      uiMessage("1c", "Patient sex: male."),
      uiMessage("1d", "ESRD: no."),
      uiMessage("1e", "Symptom duration: 5 hours."),
      uiMessage("1f", "0-hour HST value: 10 ng/L."),
      uiMessage("1g", "2-hour HST value: 26 ng/L."),
      uiMessage("1h", "2-hour repeat EKG ischemic changes: no."),
    ],
    expected: {
      requiredField: null,
      risk: "HIGH",
      deltaCategory: "significant",
      significantDelta: true,
    },
  },
  {
    name: "high-value 20 percent delta routes high",
    messages: [
      uiMessage("2a", "No STEMI."),
      uiMessage("2b", "No ischemic EKG changes."),
      uiMessage("2c", "Patient sex: male."),
      uiMessage("2d", "ESRD: no."),
      uiMessage("2e", "Symptom duration: 5 hours."),
      uiMessage("2f", "0-hour HST value: 110 ng/L."),
      uiMessage("2g", "2-hour HST value: 132 ng/L."),
      uiMessage("2h", "2-hour repeat EKG ischemic changes: no."),
    ],
    expected: {
      requiredField: null,
      risk: "HIGH",
      deltaCategory: "significant",
      significantDelta: true,
    },
  },
  {
    name: "falling significant delta routes high without ongoing-pain prompt",
    messages: [
      uiMessage("3a", "No STEMI."),
      uiMessage("3b", "No ischemic EKG changes."),
      uiMessage("3c", "Patient sex: male."),
      uiMessage("3d", "ESRD: no."),
      uiMessage("3e", "Symptom duration: 6 hours."),
      uiMessage("3f", "0-hour HST value: 90 ng/L."),
      uiMessage("3g", "2-hour HST value: 70 ng/L."),
      uiMessage("3h", "2-hour repeat EKG ischemic changes: no."),
    ],
    expected: {
      requiredField: null,
      risk: "HIGH",
      deltaCategory: "significant",
      significantDelta: true,
    },
  },
  {
    name: "intermediate 4hr branch stays intermediate, not chronic injury",
    messages: [
      uiMessage("4a", "No STEMI."),
      uiMessage("4b", "No ischemic EKG changes."),
      uiMessage("4c", "Patient sex: male."),
      uiMessage("4d", "ESRD: no."),
      uiMessage("4e", "Symptom duration: 5 hours."),
      uiMessage("4f", "0-hour HST value: 10 ng/L."),
      uiMessage("4g", "2-hour HST value: 18 ng/L."),
      uiMessage("4h", "2-hour repeat EKG ischemic changes: no."),
      uiMessage("4i", "4-hour HST value: 20 ng/L."),
      uiMessage("4j", "4-hour repeat EKG ischemic changes: no."),
      uiMessage(
        "4k",
        "HEART components: history 1, EKG 0, age 1, risk factors 2, troponin 0."
      ),
      uiMessage("4l", "Ongoing chest pain answer: No ongoing pain."),
      uiMessage("4m", "No recent normal cardiac testing."),
      uiMessage("4n", "No known chronic unchanged HST."),
    ],
    expected: {
      requiredField: null,
      risk: "INTERMEDIATE",
      deltaCategory: "intermediate",
      significantDelta: false,
    },
  },
  {
    name: "female above-URL minimal delta routes chronic injury",
    messages: [
      uiMessage("5a", "No STEMI."),
      uiMessage("5b", "No ischemic EKG changes."),
      uiMessage("5c", "Patient sex: female."),
      uiMessage("5d", "ESRD: no."),
      uiMessage("5e", "Symptom duration: 5 hours."),
      uiMessage("5f", "0-hour HST value: 15 ng/L."),
      uiMessage("5g", "2-hour HST value: 17 ng/L."),
      uiMessage("5h", "2-hour repeat EKG ischemic changes: no."),
      uiMessage("5i", "Ongoing chest pain answer: No ongoing pain."),
    ],
    expected: {
      requiredField: null,
      risk: "CHRONIC_INJURY",
      deltaCategory: "minimal",
      significantDelta: false,
    },
  },
  {
    name: "compound duration advances to 0h HST",
    messages: [
      uiMessage("6a", "No STEMI."),
      uiMessage("6b", "No ischemic EKG changes."),
      uiMessage("6c", "Patient sex: male."),
      uiMessage("6d", "ESRD: no."),
      uiMessage("6e", "Symptoms present for 3 hours 15 minutes."),
    ],
    expected: {
      requiredField: "hst0",
      risk: null,
      symptomDurationHours: 3.25,
    },
  },
];

async function runCase(testCase) {
  try {
    const stream = await postChat(testCase.messages);
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
  console.log(`HST production regression replay started at ${startedAt}`);
  console.log(`Target: ${PROD_BASE_URL}`);
  console.log(`Artifacts: ${OUTPUT_DIR}`);

  const results = [];
  for (const testCase of CASES) {
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
