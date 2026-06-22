export function summarizeMdStressState(state) {
  const risk = state.results?.findLast?.(
    (result) => result.kind === "determine_disposition"
  )?.data?.risk;
  const action = state.results?.findLast?.(
    (result) => result.kind === "assess_ekg"
  )?.data?.action;

  return {
    requiredField: state.requiredField,
    terminal: state.terminal,
    risk: risk ?? null,
    action: action ?? null,
    acceptedFields: state.acceptedFields,
    values: state.values,
  };
}

export function buildApiCasePassSummary(name, state) {
  const summary = summarizeMdStressState(state);
  return {
    name,
    requiredField: summary.requiredField,
    terminal: summary.terminal,
    risk: summary.risk,
    action: summary.action,
  };
}

export function buildApiCaseFailureSummary(name, error) {
  return {
    name,
    status: "fail",
    error: error instanceof Error ? error.message : String(error),
  };
}

export function summarizeApiCaseOutcomes(outcomes) {
  const apiSummaries = outcomes.map((outcome) => outcome.summary);
  const failures = outcomes
    .filter((outcome) => outcome.status === "fail")
    .map((outcome) => outcome.summary);

  return {
    apiSummaries,
    failures,
    shouldFail: failures.length > 0,
  };
}
