type RentStepLike = {
  start?: number;
  end?: number;
  rate_psf_yr?: number;
  startMonth?: number;
  endMonth?: number;
  ratePsfYr?: number;
};

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

type NormalizedStep = {
  start: number;
  end: number;
  rate: number;
};

function normalizeSteps(steps: RentStepLike[] | undefined): NormalizedStep[] {
  if (!steps || steps.length === 0) return [];
  return steps
    .map((s) => {
      const start = Math.max(0, Math.floor(toNumber(s.start ?? s.startMonth)));
      const endRaw = Math.floor(toNumber(s.end ?? s.endMonth));
      const end = Math.max(start, endRaw);
      const rate = Math.max(0, toNumber(s.rate_psf_yr ?? s.ratePsfYr));
      return { start, end, rate };
    })
    .filter((s) => s.rate > 0)
    .sort((a, b) => a.start - b.start);
}

function annualizedRate(firstRate: number, nextRate: number, monthDelta: number): number {
  if (firstRate <= 0 || nextRate <= 0 || monthDelta <= 0) return 0;
  const years = monthDelta / 12;
  if (years <= 0) return 0;
  return Math.pow(nextRate / firstRate, 1 / years) - 1;
}

function stepChangeRate(firstRate: number, nextRate: number): number {
  if (firstRate <= 0 || nextRate <= 0) return 0;
  return nextRate / firstRate - 1;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function buildTransitions(normalized: NormalizedStep[]): Array<{ start: number; monthDelta: number; stepPct: number; annualPct: number }> {
  const transitions: Array<{ start: number; monthDelta: number; stepPct: number; annualPct: number }> = [];
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const current = normalized[i];
    const next = normalized[i + 1];
    if (!current || !next) continue;
    if (next.start <= current.start) continue;
    if (next.rate === current.rate) continue;
    const monthDelta = next.start - current.start;
    const stepPct = stepChangeRate(current.rate, next.rate);
    const annualPct = annualizedRate(current.rate, next.rate, monthDelta);
    if (!Number.isFinite(stepPct) || !Number.isFinite(annualPct)) continue;
    transitions.push({ start: current.start, monthDelta, stepPct, annualPct });
  }
  return transitions;
}

/**
 * Return the first contractual base rent $/SF/YR from steps.
 */
export function initialBaseRentPsfYrFromSteps(steps: RentStepLike[] | undefined): number {
  const normalized = normalizeSteps(steps);
  return normalized.length > 0 ? normalized[0].rate : 0;
}

/**
 * Prefer early annual transitions for display so long-tail odd rows do not skew headline escalation.
 * Returns decimal (e.g. 0.03 = 3%).
 */
export function inferDisplayedRentEscalationPercentFromSteps(steps: RentStepLike[] | undefined): number {
  const normalized = normalizeSteps(steps);
  if (normalized.length < 2) return 0;
  const transitions = buildTransitions(normalized);
  if (transitions.length === 0) return 0;
  const nearAnnual = transitions.filter((transition) => transition.monthDelta >= 6 && transition.monthDelta <= 18);
  if (nearAnnual.length > 0) {
    const earlyAnnual = nearAnnual
      .sort((a, b) => a.start - b.start)
      .slice(0, 4)
      .map((transition) => transition.annualPct);
    if (earlyAnnual.length > 0) {
      const value = median(earlyAnnual);
      return Number.isFinite(value) ? value : 0;
    }
  }
  return inferRentEscalationPercentFromSteps(steps);
}

/**
 * Return annual rent escalation as a decimal (e.g. 0.03 = 3.00%).
 * Robust for both explicit annual % escalations and fixed-dollar step schedules.
 */
export function inferRentEscalationPercentFromSteps(steps: RentStepLike[] | undefined): number {
  const normalized = normalizeSteps(steps);
  if (normalized.length < 2) return 0;
  const transitions = buildTransitions(normalized);

  if (transitions.length === 0) return 0;

  // If schedule transitions are roughly yearly, annualized is the most faithful output.
  const nearAnnual = transitions.filter((transition) => transition.monthDelta >= 6 && transition.monthDelta <= 18);
  const nearAnnualValue = median(nearAnnual.map((transition) => transition.annualPct));
  if (Number.isFinite(nearAnnualValue) && nearAnnual.length > 0) {
    return nearAnnualValue;
  }

  // For sparse multi-year steps (common in proposals), show the explicit step-to-step escalation.
  const stepValue = median(transitions.map((transition) => transition.stepPct));
  return Number.isFinite(stepValue) ? stepValue : 0;
}
