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

/**
 * Return annual rent escalation as a decimal (e.g. 0.03 = 3.00%).
 * Robust for both explicit annual % escalations and fixed-dollar step schedules.
 */
export function inferRentEscalationPercentFromSteps(steps: RentStepLike[] | undefined): number {
  const normalized = normalizeSteps(steps);
  if (normalized.length < 2) return 0;
  const first = normalized[0];
  if (!first || first.rate <= 0) return 0;

  // Prefer first changed step around 1-year boundary to avoid noisy monthly anomalies.
  const yearlyCandidate = normalized.find(
    (s) => s.start > first.start && s.rate !== first.rate && (s.start - first.start) >= 11
  );
  if (yearlyCandidate) {
    const pct = annualizedRate(first.rate, yearlyCandidate.rate, yearlyCandidate.start - first.start);
    return Number.isFinite(pct) ? pct : 0;
  }

  const firstChanged = normalized.find((s) => s.start > first.start && s.rate !== first.rate);
  if (!firstChanged) return 0;
  const pct = annualizedRate(first.rate, firstChanged.rate, firstChanged.start - first.start);
  return Number.isFinite(pct) ? pct : 0;
}

