export function classifyBrowserStatus(status) {
  return {
    status,
    clinicalFailure: status === "FAIL",
    blocked: status === "BROWSER_BLOCKED",
  };
}

export function summarizeClinicianJudgeOutcomes(cases, judgeMode = "report") {
  const deterministicFailures = cases.filter(
    (entry) => entry.deterministicStatus === "FAIL"
  ).length;
  const judgeFailures = cases.filter(
    (entry) => entry.judgeVerdict === "FAIL"
  ).length;
  const browserBlocked = cases.filter(
    (entry) => entry.browserStatus === "BROWSER_BLOCKED"
  ).length;
  const browserFailures = cases.filter(
    (entry) => classifyBrowserStatus(entry.browserStatus).clinicalFailure
  ).length;

  return {
    deterministicFailures,
    judgeFailures,
    browserBlocked,
    browserFailures,
    shouldFail:
      deterministicFailures > 0 ||
      browserFailures > 0 ||
      (judgeMode === "strict" && judgeFailures > 0),
  };
}
