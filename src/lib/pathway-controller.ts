import type { UIMessage } from "ai";

import type { PathwayStepId } from "./pathway-ui";
import { resolvePathwayState } from "./pathway-state";
import {
  assessEkg,
  calculateDelta,
  calculateHeartScore,
  determineDisposition,
  evaluateTroponin,
} from "./tools";

type HeartComponents = NonNullable<
  ReturnType<typeof resolvePathwayState>["fields"]["heartComponents"]
>;

type PathwayValues = ReturnType<typeof resolvePathwayState>["fields"] & {
  repeatEkg2hIschemic?: boolean;
  repeatEkg4hIschemic?: boolean;
};

export type PathwayRequiredField =
  | "stemiOrEquivalent"
  | "ischemicChanges"
  | "sex"
  | "isEsrd"
  | "symptomDurationHours"
  | "hst0"
  | "clinicalSuspicion"
  | "hst2"
  | "repeatEkg2h"
  | "hst4"
  | "repeatEkg4h"
  | "ongoingChestPain"
  | "heart.history"
  | "heart.ekg"
  | "heart.age"
  | "heart.risk_factors"
  | "heart.troponin"
  | "recentNormalTesting"
  | "chronicUnchangedHst";

export type PathwayControllerResult = {
  kind:
    | "assess_ekg"
    | "evaluate_troponin"
    | "calculate_delta"
    | "calculate_heart_score"
    | "determine_disposition";
  hour?: "0" | "2" | "4";
  data: Record<string, unknown>;
};

export type PathwayControllerSnapshot = {
  step: PathwayStepId;
  requiredField: PathwayRequiredField | null;
  acceptedFields: string[];
  question: string | null;
  allowedOptions: string[];
  terminal: boolean;
  values: PathwayValues;
  results: PathwayControllerResult[];
  llmInstruction: string;
};

const toolCtx = {
  toolCallId: "pathway-controller",
  abortSignal: undefined as unknown as AbortSignal,
};

function textFromMessage(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function userTexts(messages: UIMessage[]) {
  return messages
    .filter((message) => message.role === "user")
    .map(textFromMessage)
    .filter(Boolean);
}

function latestMatch<T>(
  texts: string[],
  extractor: (text: string) => T | undefined
) {
  for (const text of [...texts].reverse()) {
    const value = extractor(text);
    if (value !== undefined) return value;
  }
  return undefined;
}

function extractBoolean(text: string, yesPattern: RegExp, noPattern: RegExp) {
  const yesMatch = yesPattern.exec(text);
  const noMatch = noPattern.exec(text);
  if (!yesMatch && !noMatch) return undefined;
  if (yesMatch && noMatch) return yesMatch.index > noMatch.index;
  return Boolean(yesMatch);
}

function extractRepeatEkg(texts: string[], hour: "2" | "4") {
  return latestMatch(texts, (text) =>
    extractBoolean(
      text,
      new RegExp(
        `\\brepeat\\s+${hour}\\s*[- ]?\\s*(?:hour|hr|h)?\\s*ekg[^.\\n]*\\b(?:yes|ischemic)\\b|\\b${hour}\\s*[- ]?\\s*(?:hour|hr|h)?\\s*repeat\\s+ekg\\s+ischemic\\s+changes\\s*:\\s*yes\\b`,
        "i"
      ),
      new RegExp(
        `\\brepeat\\s+${hour}\\s*[- ]?\\s*(?:hour|hr|h)?\\s*ekg[^.\\n]*\\bno\\s+ischemic\\b|\\b${hour}\\s*[- ]?\\s*(?:hour|hr|h)?\\s*repeat\\s+ekg\\s+ischemic\\s+changes\\s*:\\s*no\\b`,
        "i"
      )
    )
  );
}

function snapshot(params: {
  step: PathwayStepId;
  requiredField: PathwayRequiredField | null;
  question: string | null;
  allowedOptions?: string[];
  terminal?: boolean;
  values: PathwayValues;
  results: PathwayControllerResult[];
}) {
  const allowedOptions = params.terminal ? [] : params.allowedOptions ?? [];
  const acceptedFields = Object.entries(params.values)
    .flatMap(([key, value]) => {
      if (value === undefined) return [];
      if (key === "heartComponents") {
        return Object.keys(value as Record<string, unknown>).map(
          (component) => `heart.${component}`
        );
      }
      return [key];
    })
    .sort();

  return {
    step: params.step,
    requiredField: params.requiredField,
    acceptedFields,
    question: params.question,
    allowedOptions,
    terminal: Boolean(params.terminal),
    values: params.values,
    results: params.results,
    llmInstruction: buildLlmInstruction(
      params.requiredField,
      params.question,
      allowedOptions,
      Boolean(params.terminal)
    ),
  } satisfies PathwayControllerSnapshot;
}

function buildLlmInstruction(
  requiredField: PathwayRequiredField | null,
  question: string | null,
  allowedOptions: string[],
  terminal: boolean
) {
  if (terminal) {
    return "The deterministic server controller has reached a terminal pathway result. Explain the result briefly and do not ask another pathway question or offer buttons.";
  }
  const optionText =
    allowedOptions.length > 0
      ? ` The UI will render these server-owned buttons: ${allowedOptions.join(", ")}.`
      : "";
  return `Ask only this server-selected question: "${question}". requiredField=${requiredField}.${optionText} Explain why this data point matters, but do not choose a different next step, invent buttons, compute risk, or state disposition.`;
}

async function runAssessEkg(values: PathwayValues) {
  if (values.stemiOrEquivalent === undefined) return null;
  const data = await assessEkg.execute!(
    {
      stemi_or_equivalent: values.stemiOrEquivalent,
      ischemic_changes: Boolean(values.ischemicChanges),
    },
    { ...toolCtx, messages: [] }
  );
  return { kind: "assess_ekg" as const, data: data as Record<string, unknown> };
}

async function runEvaluateTroponin(
  values: PathwayValues,
  hour: "0" | "2" | "4",
  value: number,
  messages: UIMessage[]
) {
  if (!values.sex || values.isEsrd === undefined) return null;
  const clinicalSuspicionSource = values.clinicalSuspicion
    ? `Clinical suspicion for ACS: ${values.clinicalSuspicion}.`
    : undefined;
  const data = await evaluateTroponin.execute!(
    {
      value,
      value_source: `${hour}-hour HST is ${value} ng/L.`,
      hour,
      sex: values.sex,
      is_esrd: values.isEsrd,
      symptom_duration_hours: values.symptomDurationHours,
      clinical_suspicion: values.clinicalSuspicion,
      clinical_suspicion_source: clinicalSuspicionSource,
    },
    {
      ...toolCtx,
      messages:
        clinicalSuspicionSource !== undefined
          ? [{ role: "user", content: clinicalSuspicionSource }]
          : messages.map((message) => ({
              role: message.role,
              content: textFromMessage(message),
            })),
    }
  );
  return {
    kind: "evaluate_troponin" as const,
    hour,
    data: data as Record<string, unknown>,
  };
}

async function runDelta(hour: "2" | "4", hst0: number, hstCurrent: number) {
  const data = await calculateDelta.execute!(
    { hst_0hr: hst0, hst_current: hstCurrent, hour },
    { ...toolCtx, messages: [] }
  );
  return {
    kind: "calculate_delta" as const,
    hour,
    data: data as Record<string, unknown>,
  };
}

async function runHeart(heart: HeartComponents) {
  if (
    heart.history === undefined ||
    heart.ekg === undefined ||
    heart.age === undefined ||
    heart.risk_factors === undefined ||
    heart.troponin === undefined
  ) {
    return null;
  }
  const data = await calculateHeartScore.execute!(
    {
      history: heart.history,
      ekg: heart.ekg,
      age: heart.age,
      risk_factors: heart.risk_factors,
      troponin: heart.troponin,
    },
    { ...toolCtx, messages: [] }
  );
  return {
    kind: "calculate_heart_score" as const,
    data: data as Record<string, unknown>,
  };
}

async function runDisposition(args: {
  values: PathwayValues;
  anyTroponinAboveUrl: boolean;
  anyIschemicChanges: boolean;
  heartScore: number;
  earlyRuleOut: boolean;
  deltaRange: "minimal" | "intermediate" | "significant";
  has4hrResult: boolean;
}) {
  const data = await determineDisposition.execute!(
    {
      any_troponin_above_url: args.anyTroponinAboveUrl,
      ekg_ischemic_changes: args.anyIschemicChanges,
      ongoing_chest_pain: Boolean(args.values.ongoingChestPain),
      heart_score: args.heartScore,
      symptom_duration_hours: args.values.symptomDurationHours ?? 0,
      is_esrd: Boolean(args.values.isEsrd),
      recent_normal_testing: Boolean(args.values.recentNormalTesting),
      chronic_unchanged_hst: Boolean(args.values.chronicUnchangedHst),
      early_rule_out: args.earlyRuleOut,
      delta_range: args.deltaRange,
      has_4hr_result: args.has4hrResult,
    },
    {
      ...toolCtx,
      messages: args.earlyRuleOut
        ? [{ role: "user", content: "Clinical suspicion for ACS: low." }]
        : [],
    }
  );
  return {
    kind: "determine_disposition" as const,
    data: data as Record<string, unknown>,
  };
}

const HEART_STEPS = [
  {
    field: "heart.history" as const,
    key: "history" as const,
    question: "How suspicious is the history for ACS?",
    options: [
      "0 - Slightly suspicious",
      "1 - Moderately suspicious",
      "2 - Highly suspicious",
    ],
  },
  {
    field: "heart.ekg" as const,
    key: "ekg" as const,
    question: "EKG score for HEART?",
    options: [
      "0 - Normal",
      "1 - Non-specific changes",
      "2 - Significant ST deviation",
    ],
  },
  {
    field: "heart.age" as const,
    key: "age" as const,
    question: "Patient age category for HEART?",
    options: ["0 - Under 45", "1 - Age 45-64", "2 - Age 65+"],
  },
  {
    field: "heart.risk_factors" as const,
    key: "risk_factors" as const,
    question: "Risk factor burden for HEART?",
    options: [
      "0 - No known risk factors",
      "1 - 1-2 risk factors",
      "2 - 3+ factors or atherosclerotic disease",
    ],
  },
  {
    field: "heart.troponin" as const,
    key: "troponin" as const,
    question: "Troponin component for HEART?",
    options: [
      "0 - At or below normal limit",
      "1 - 1-3x normal limit",
      "2 - Over 3x normal limit",
    ],
  },
];

export async function resolvePathwayController(
  messages: UIMessage[]
): Promise<PathwayControllerSnapshot> {
  const baseState = resolvePathwayState(messages);
  const texts = userTexts(messages);
  const values: PathwayValues = {
    ...baseState.fields,
    repeatEkg2hIschemic: extractRepeatEkg(texts, "2"),
    repeatEkg4hIschemic: extractRepeatEkg(texts, "4"),
  };
  const results: PathwayControllerResult[] = [];

  if (values.stemiOrEquivalent === undefined) {
    return snapshot({
      step: "ekg",
      requiredField: "stemiOrEquivalent",
      question: "Does the EKG show STEMI or STEMI equivalent?",
      allowedOptions: ["Yes - STEMI", "No STEMI"],
      values,
      results,
    });
  }

  const ekgResult = await runAssessEkg(values);
  if (ekgResult) results.push(ekgResult);
  if (values.stemiOrEquivalent) {
    return snapshot({
      step: "disposition",
      requiredField: null,
      question: null,
      terminal: true,
      values,
      results,
    });
  }

  if (values.ischemicChanges === undefined) {
    return snapshot({
      step: "ekg",
      requiredField: "ischemicChanges",
      question:
        "Are there ischemic ST or T-wave changes on the EKG?",
      allowedOptions: ["Yes - ischemic changes", "No ischemic changes"],
      values,
      results,
    });
  }
  if (!values.sex) {
    return snapshot({
      step: "basics",
      requiredField: "sex",
      question: "Patient sex?",
      allowedOptions: ["Male", "Female"],
      values,
      results,
    });
  }
  if (values.isEsrd === undefined) {
    return snapshot({
      step: "basics",
      requiredField: "isEsrd",
      question: "Does the patient have end-stage renal disease (ESRD)?",
      allowedOptions: ["Yes - ESRD", "No ESRD"],
      values,
      results,
    });
  }
  if (values.symptomDurationHours === undefined) {
    return snapshot({
      step: "basics",
      requiredField: "symptomDurationHours",
      question: "How many hours have the symptoms been present?",
      values,
      results,
    });
  }
  if (values.hst0 === undefined) {
    return snapshot({
      step: "troponin0",
      requiredField: "hst0",
      question: "What is the 0-hour HST value in ng/L?",
      values,
      results,
    });
  }

  const trop0 = await runEvaluateTroponin(values, "0", values.hst0, messages);
  if (trop0) results.push(trop0);
  const trop0Data = trop0?.data as
    | {
        above_url?: boolean;
        needs_clinical_suspicion?: boolean;
        early_rule_out_eligible?: boolean;
      }
    | undefined;

  if (trop0Data?.needs_clinical_suspicion && !values.clinicalSuspicion) {
    return snapshot({
      step: "troponin0",
      requiredField: "clinicalSuspicion",
      question: "Clinical suspicion for ACS?",
      allowedOptions: ["Low", "Moderate", "High"],
      values,
      results,
    });
  }

  if (trop0Data?.early_rule_out_eligible) {
    results.push(
      await runDisposition({
        values,
        anyTroponinAboveUrl: Boolean(trop0Data.above_url),
        anyIschemicChanges: Boolean(values.ischemicChanges),
        heartScore: 0,
        earlyRuleOut: true,
        deltaRange: "minimal",
        has4hrResult: false,
      })
    );
    return snapshot({
      step: "disposition",
      requiredField: null,
      question: null,
      terminal: true,
      values,
      results,
    });
  }

  if (values.hst2 === undefined) {
    return snapshot({
      step: "delta",
      requiredField: "hst2",
      question: "What is the 2-hour HST value in ng/L?",
      values,
      results,
    });
  }

  const trop2 = await runEvaluateTroponin(values, "2", values.hst2, messages);
  const delta2 = await runDelta("2", values.hst0, values.hst2);
  if (trop2) results.push(trop2);
  results.push(delta2);

  if (values.repeatEkg2hIschemic === undefined) {
    return snapshot({
      step: "delta",
      requiredField: "repeatEkg2h",
      question:
        "Does the repeat 2-hour EKG show ischemic ST or T-wave changes?",
      allowedOptions: ["Yes - ischemic changes", "No ischemic changes"],
      values,
      results,
    });
  }

  const delta2Data = delta2.data as {
    delta_category: "minimal" | "intermediate" | "significant";
  };
  let activeDelta = delta2Data.delta_category;
  let has4hrResult = false;

  if (activeDelta === "intermediate" || values.symptomDurationHours < 4) {
    if (values.hst4 === undefined) {
      return snapshot({
        step: "delta",
        requiredField: "hst4",
        question: "What is the 4-hour HST value in ng/L?",
        values,
        results,
      });
    }
    const trop4 = await runEvaluateTroponin(values, "4", values.hst4, messages);
    const delta4 = await runDelta("4", values.hst0, values.hst4);
    if (trop4) results.push(trop4);
    results.push(delta4);
    const delta4Data = delta4.data as {
      delta_category: "minimal" | "intermediate" | "significant";
    };
    activeDelta = delta4Data.delta_category;
    has4hrResult = true;
    if (values.repeatEkg4hIschemic === undefined) {
      return snapshot({
        step: "delta",
        requiredField: "repeatEkg4h",
        question:
          "Does the repeat 4-hour EKG show ischemic ST or T-wave changes?",
        allowedOptions: ["Yes - ischemic changes", "No ischemic changes"],
        values,
        results,
      });
    }
  }

  const anyTroponinAboveUrl = [trop0, trop2, ...results]
    .filter((result) => result?.kind === "evaluate_troponin")
    .some((result) => Boolean(result?.data.above_url));
  const anyIschemicChanges = Boolean(
    values.ischemicChanges ||
      values.repeatEkg2hIschemic ||
      values.repeatEkg4hIschemic
  );

  if (values.ongoingChestPain === undefined) {
    return snapshot({
      step: "heart",
      requiredField: "ongoingChestPain",
      question: "Is the patient having ongoing cardiac chest pain?",
      allowedOptions: ["Yes - ongoing pain", "No ongoing pain"],
      values,
      results,
    });
  }

  if (anyTroponinAboveUrl || activeDelta === "significant" || anyIschemicChanges || values.ongoingChestPain) {
    results.push(
      await runDisposition({
        values,
        anyTroponinAboveUrl,
        anyIschemicChanges,
        heartScore: 10,
        earlyRuleOut: false,
        deltaRange: activeDelta,
        has4hrResult,
      })
    );
    return snapshot({
      step: "disposition",
      requiredField: null,
      question: null,
      terminal: true,
      values,
      results,
    });
  }

  const heart = values.heartComponents ?? {};
  for (const heartStep of HEART_STEPS) {
    if (heart[heartStep.key] === undefined) {
      return snapshot({
        step: "heart",
        requiredField: heartStep.field,
        question: heartStep.question,
        allowedOptions: heartStep.options,
        values,
        results,
      });
    }
  }

  const heartResult = await runHeart(heart);
  if (heartResult) results.push(heartResult);
  const heartScore = Number(heartResult?.data.total ?? 0);

  if (heartScore >= 4 && values.recentNormalTesting === undefined) {
    return snapshot({
      step: "heart",
      requiredField: "recentNormalTesting",
      question: "Is there recent normal cardiac testing on file?",
      allowedOptions: [
        "Yes - recent normal testing",
        "No recent normal testing",
      ],
      values,
      results,
    });
  }

  if (
    heartScore >= 4 &&
    !values.recentNormalTesting &&
    values.chronicUnchangedHst === undefined
  ) {
    return snapshot({
      step: "heart",
      requiredField: "chronicUnchangedHst",
      question: "Is there known chronic unchanged HST elevation?",
      allowedOptions: [
        "Yes - chronic unchanged HST",
        "No chronic unchanged HST",
      ],
      values,
      results,
    });
  }

  results.push(
    await runDisposition({
      values,
      anyTroponinAboveUrl,
      anyIschemicChanges,
      heartScore,
      earlyRuleOut: false,
      deltaRange: activeDelta,
      has4hrResult,
    })
  );
  return snapshot({
    step: "disposition",
    requiredField: null,
    question: null,
    terminal: true,
    values,
    results,
  });
}

export function buildPathwayControllerPrompt(snapshot: PathwayControllerSnapshot) {
  return [
    "## SERVER-OWNED PATHWAY CONTROLLER",
    "The server has already parsed clinician data and run deterministic pathway logic. Treat this controller snapshot as canonical.",
    `controller_json: ${JSON.stringify(snapshot)}`,
    snapshot.llmInstruction,
    "Do not choose a different pathway step. Do not invent quick-reply buttons. Do not compute clinical thresholds, deltas, HEART totals, risk, or disposition in prose.",
  ].join("\n");
}
