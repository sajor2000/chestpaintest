function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatNumber(value: number) {
  return Number.isInteger(value)
    ? value.toString()
    : value.toFixed(2).replace(/\.?0+$/, "");
}

function formatSignedNumber(value: number) {
  if (Object.is(value, -0)) return "0";
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

export type DeltaEquation = {
  current: string;
  baseline: string;
  change: string;
  expression: string;
  absolute: string;
};

export function getDeltaEquation(
  data: Record<string, unknown>
): DeltaEquation | null {
  const current = numberValue(data.hst_current);
  const baseline = numberValue(data.hst_0hr);
  if (current === null || baseline === null) return null;

  const computedSignedDelta = current - baseline;
  const signedDelta = numberValue(data.signed_delta) ?? computedSignedDelta;
  const absoluteDelta = numberValue(data.absolute_delta) ?? Math.abs(signedDelta);

  return {
    current: formatNumber(current),
    baseline: formatNumber(baseline),
    change: formatSignedNumber(signedDelta),
    expression: `${formatNumber(current)} - ${formatNumber(
      baseline
    )} = ${formatSignedNumber(signedDelta)} ng/L`,
    absolute: formatNumber(absoluteDelta),
  };
}
