export function getResultRisk(state) {
  return state?.results?.findLast?.((result) => result.kind === "determine_disposition")
    ?.data?.risk;
}

export function getResultAction(state) {
  return state?.results?.findLast?.((result) => result.kind === "assess_ekg")?.data
    ?.action;
}

function sameArray(actual = [], expected = []) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function summarizeState(state) {
  return JSON.stringify({
    step: state?.step,
    requiredField: state?.requiredField,
    terminal: state?.terminal,
    allowedOptions: state?.allowedOptions ?? [],
    risk: getResultRisk(state) ?? null,
    action: getResultAction(state) ?? null,
    values: state?.values,
  });
}

export function evaluateApiFaithfulness(state, expected, caseName) {
  const concerns = [];
  const allowedOptions = state?.allowedOptions ?? [];

  if (!state) {
    return {
      status: "FAIL",
      concerns: [`${caseName}: stream did not include data-pathway-state`],
    };
  }

  if ("step" in expected && state.step !== expected.step) {
    concerns.push(
      `${caseName}: expected step ${expected.step}, got ${state.step}; state=${summarizeState(state)}`
    );
  }

  if ("requiredField" in expected && state.requiredField !== expected.requiredField) {
    concerns.push(
      `${caseName}: expected requiredField ${expected.requiredField}, got ${state.requiredField}; state=${summarizeState(state)}`
    );
  }

  if ("terminal" in expected && state.terminal !== expected.terminal) {
    concerns.push(
      `${caseName}: expected terminal ${expected.terminal}, got ${state.terminal}; state=${summarizeState(state)}`
    );
  }

  if ("risk" in expected && getResultRisk(state) !== expected.risk) {
    concerns.push(
      `${caseName}: expected risk ${expected.risk}, got ${getResultRisk(state)}; state=${summarizeState(state)}`
    );
  }

  if ("action" in expected && getResultAction(state) !== expected.action) {
    concerns.push(
      `${caseName}: expected action ${expected.action}, got ${getResultAction(state)}; state=${summarizeState(state)}`
    );
  }

  if ("allowedOptions" in expected && !sameArray(allowedOptions, expected.allowedOptions)) {
    concerns.push(
      `${caseName}: expected allowedOptions ${JSON.stringify(expected.allowedOptions)}, got ${JSON.stringify(allowedOptions)}; state=${summarizeState(state)}`
    );
  }

  if (expected.values) {
    for (const [key, value] of Object.entries(expected.values)) {
      if (state.values?.[key] !== value) {
        concerns.push(
          `${caseName}: expected values.${key}=${value}, got ${state.values?.[key]}; state=${summarizeState(state)}`
        );
      }
    }
  }

  if (state.terminal && allowedOptions.length > 0) {
    concerns.push(
      `${caseName}: terminal state still exposes allowedOptions ${JSON.stringify(allowedOptions)}; state=${summarizeState(state)}`
    );
  }

  if (state.terminal && state.requiredField) {
    concerns.push(
      `${caseName}: terminal state still requires ${state.requiredField}; state=${summarizeState(state)}`
    );
  }

  if (!state.terminal && state.requiredField && typeof state.question !== "string") {
    concerns.push(
      `${caseName}: nonterminal state has no clinician-facing question; state=${summarizeState(state)}`
    );
  }

  return { status: concerns.length ? "FAIL" : "PASS", concerns };
}

export function evaluateBrowserFaithfulness(
  browserResult,
  apiState,
  expected,
  caseName
) {
  if (!browserResult || browserResult.status !== "PASS") {
    return {
      status: browserResult?.status ?? "NOT_RUN",
      concerns: browserResult?.error ? [browserResult.error] : [],
    };
  }

  const concerns = [];
  const expectedQuickReplies =
    browserResult.latestControllerState?.allowedOptions ?? apiState?.allowedOptions ?? [];
  const quickReplies = browserResult.quickReplyButtons ?? [];

  if (!sameArray(quickReplies, expectedQuickReplies)) {
    concerns.push(
      `${caseName}: visible quick replies ${JSON.stringify(quickReplies)} do not match controller allowedOptions ${JSON.stringify(expectedQuickReplies)}`
    );
  }

  if (browserResult.latestControllerState) {
    const stateExpectation = {};
    const step = expected.step ?? apiState?.step;
    const requiredField = expected.requiredField ?? apiState?.requiredField;
    const terminal = expected.terminal ?? apiState?.terminal;
    const risk = expected.risk ?? getResultRisk(apiState);
    const action = expected.action ?? getResultAction(apiState);
    if (step !== undefined) stateExpectation.step = step;
    if (requiredField !== undefined) stateExpectation.requiredField = requiredField;
    if (terminal !== undefined) stateExpectation.terminal = terminal;
    if (risk !== undefined) stateExpectation.risk = risk;
    if (action !== undefined) stateExpectation.action = action;
    stateExpectation.allowedOptions =
      expected.allowedOptions ?? browserResult.latestControllerState.allowedOptions ?? [];
    if (expected.values) stateExpectation.values = expected.values;

    const browserStateResult = evaluateApiFaithfulness(
      browserResult.latestControllerState,
      stateExpectation,
      `${caseName} browser controller state`
    );
    concerns.push(...browserStateResult.concerns);
  }

  return { status: concerns.length ? "FAIL" : "PASS", concerns };
}
