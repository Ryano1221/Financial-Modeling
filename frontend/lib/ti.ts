import type { ScenarioInput, TiSourceOfTruth } from "@/lib/types";

type TiLike = {
  rsf?: number | null;
  ti_allowance_psf?: number | null;
  ti_budget_total?: number | null;
  ti_source_of_truth?: TiSourceOfTruth | null;
};

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNonNegativeOrNull(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed == null) return null;
  return Math.max(0, parsed);
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function round0(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

export function normalizeTiSourceOfTruth(
  raw: unknown,
  fallback: TiSourceOfTruth = "psf"
): TiSourceOfTruth {
  return raw === "total" ? "total" : raw === "psf" ? "psf" : fallback;
}

export function hasValidRsfForTi(raw: unknown): boolean {
  const parsed = toFiniteNumber(raw);
  return parsed != null && parsed > 0;
}

export function effectiveTiBudgetTotal(s: TiLike): number {
  const source = normalizeTiSourceOfTruth(s.ti_source_of_truth, "psf");
  const total = toNonNegativeOrNull(s.ti_budget_total);
  const psf = toNonNegativeOrNull(s.ti_allowance_psf);
  const rsf = toFiniteNumber(s.rsf);
  const hasRsf = rsf != null && rsf > 0;

  if (source === "total" && total != null) return round0(total);
  if (psf != null && hasRsf) return round0(psf * (rsf as number));
  if (total != null) return round0(total);
  return 0;
}

export function effectiveTiAllowancePsf(s: TiLike): number {
  const source = normalizeTiSourceOfTruth(s.ti_source_of_truth, "psf");
  const total = toNonNegativeOrNull(s.ti_budget_total);
  const psf = toNonNegativeOrNull(s.ti_allowance_psf);
  const rsf = toFiniteNumber(s.rsf);
  const hasRsf = rsf != null && rsf > 0;

  if (source === "psf" && psf != null) return round2(psf);
  if (total != null && hasRsf) return round2(total / (rsf as number));
  if (psf != null) return round2(psf);
  return 0;
}

export function syncTiFields<T extends TiLike>(scenario: T): T & {
  ti_allowance_psf: number;
  ti_budget_total: number;
  ti_source_of_truth: TiSourceOfTruth;
} {
  const source = normalizeTiSourceOfTruth(scenario.ti_source_of_truth, "psf");
  const rsf = toFiniteNumber(scenario.rsf);
  const hasRsf = rsf != null && rsf > 0;
  let allowance = toNonNegativeOrNull(scenario.ti_allowance_psf);
  let total = toNonNegativeOrNull(scenario.ti_budget_total);

  if (source === "total") {
    if (total == null) {
      total = allowance != null && hasRsf ? round0(allowance * (rsf as number)) : 0;
    }
    if (hasRsf) {
      allowance = round2(total / (rsf as number));
    } else if (allowance == null) {
      allowance = 0;
    }
  } else {
    if (allowance == null) {
      allowance = total != null && hasRsf ? round2(total / (rsf as number)) : 0;
    }
    if (hasRsf) {
      total = round0(allowance * (rsf as number));
    } else if (total == null) {
      total = 0;
    }
  }

  return {
    ...scenario,
    ti_source_of_truth: source,
    ti_allowance_psf: round2(allowance ?? 0),
    ti_budget_total: round0(total ?? 0),
  };
}

export function withTiDefaults(scenario: ScenarioInput): ScenarioInput {
  return syncTiFields({
    ...scenario,
    ti_source_of_truth: scenario.ti_source_of_truth ?? "psf",
  });
}
