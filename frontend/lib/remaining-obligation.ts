import type {
  AbatementPeriod,
  OneTimeCost,
  OriginalExtractedLeaseSnapshot,
  ParkingAbatementPeriod,
  PhaseInStep,
  RentStep,
  ScenarioInput,
  ScenarioWithId,
} from "@/lib/types";

export type CommencedLeaseModelChoice = "full_original_term" | "remaining_obligation";

function toLocalIsoDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseIsoAsLocalDate(raw: string): Date | null {
  const value = String(raw || "").trim();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const yyyy = Number(match[1]);
  const mm = Number(match[2]);
  const dd = Number(match[3]);
  const parsed = new Date(yyyy, mm - 1, dd);
  if (
    parsed.getFullYear() !== yyyy ||
    parsed.getMonth() + 1 !== mm ||
    parsed.getDate() !== dd
  ) {
    return null;
  }
  return parsed;
}

function localStartOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addMonthsLocal(dateIso: string, monthsToAdd: number): string {
  const source = parseIsoAsLocalDate(dateIso);
  if (!source) return dateIso;
  const year = source.getFullYear();
  const month = source.getMonth();
  const day = source.getDate();
  const out = new Date(year, month + monthsToAdd, 1);
  const lastDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, lastDay));
  return toLocalIsoDate(out);
}

function monthDelta(startIso: string, endIso: string): number {
  const start = parseIsoAsLocalDate(startIso);
  const end = parseIsoAsLocalDate(endIso);
  if (!start || !end) return 0;
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function yearFromIso(dateIso: string): number | null {
  const parsed = parseIsoAsLocalDate(dateIso);
  if (!parsed) return null;
  return parsed.getFullYear();
}

function normalizeOpexByYear(raw: ScenarioInput["opex_by_calendar_year"]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [yearRaw, valueRaw] of Object.entries(raw ?? {})) {
    const year = Number(yearRaw);
    const value = Number(valueRaw);
    if (!Number.isFinite(year) || !Number.isFinite(value)) continue;
    if (year < 1900 || year > 2200 || value < 0) continue;
    out[Math.floor(year)] = value;
  }
  return out;
}

function rolledBaseOpexForRemaining(
  scenario: ScenarioInput,
  snapshot: OriginalExtractedLeaseSnapshot,
  remainingStartDate: string
): number {
  const targetYear = yearFromIso(remainingStartDate);
  if (!targetYear) return Math.max(0, Number(scenario.base_opex_psf_yr) || 0);
  const growth = Math.max(0, Number(scenario.opex_growth) || 0.03);
  const explicitByYear = normalizeOpexByYear(scenario.opex_by_calendar_year);
  const explicitYears = Object.keys(explicitByYear).map(Number).sort((a, b) => a - b);
  if (explicitYears.length > 0) {
    const floorYears = explicitYears.filter((y) => y <= targetYear);
    const baselineYear = floorYears.length > 0 ? floorYears[floorYears.length - 1] : explicitYears[0];
    const baselineValue = explicitByYear[baselineYear];
    const yearsForward = Math.max(0, targetYear - baselineYear);
    return baselineValue * Math.pow(1 + growth, yearsForward);
  }
  const commencementYear = yearFromIso(snapshot.commencement);
  const base = Math.max(0, Number(scenario.base_opex_psf_yr) || 0);
  if (!commencementYear || base <= 0) return base;
  const yearsForward = Math.max(0, targetYear - commencementYear);
  return base * Math.pow(1 + growth, yearsForward);
}

function isIsoBefore(leftIso: string, rightIso: string): boolean {
  const left = parseIsoAsLocalDate(leftIso);
  const right = parseIsoAsLocalDate(rightIso);
  if (!left || !right) return false;
  return left.getTime() < right.getTime();
}

function cloneRentSteps(steps: RentStep[] | undefined): RentStep[] {
  return (Array.isArray(steps) ? steps : []).map((step) => ({
    start: Math.max(0, Math.floor(Number(step.start) || 0)),
    end: Math.max(0, Math.floor(Number(step.end) || 0)),
    rate_psf_yr: Number(step.rate_psf_yr) || 0,
  }));
}

function clonePhaseInSteps(steps: PhaseInStep[] | undefined): PhaseInStep[] | undefined {
  const out = (Array.isArray(steps) ? steps : []).map((step) => ({
    start_month: Math.max(0, Math.floor(Number(step.start_month) || 0)),
    end_month: Math.max(0, Math.floor(Number(step.end_month) || 0)),
    rsf: Math.max(0, Number(step.rsf) || 0),
  }));
  return out.length > 0 ? out : undefined;
}

function cloneAbatementPeriods(periods: AbatementPeriod[] | undefined): AbatementPeriod[] | undefined {
  const out = (Array.isArray(periods) ? periods : []).map((period) => ({
    start_month: Math.max(0, Math.floor(Number(period.start_month) || 0)),
    end_month: Math.max(0, Math.floor(Number(period.end_month) || 0)),
    abatement_type: (period.abatement_type === "gross" ? "gross" : "base") as "base" | "gross",
  }));
  return out.length > 0 ? out : undefined;
}

function cloneParkingAbatementPeriods(
  periods: ParkingAbatementPeriod[] | undefined
): ParkingAbatementPeriod[] | undefined {
  const out = (Array.isArray(periods) ? periods : []).map((period) => ({
    start_month: Math.max(0, Math.floor(Number(period.start_month) || 0)),
    end_month: Math.max(0, Math.floor(Number(period.end_month) || 0)),
  }));
  return out.length > 0 ? out : undefined;
}

function cloneOneTimeCosts(costs: OneTimeCost[] | undefined): OneTimeCost[] | undefined {
  const out = (Array.isArray(costs) ? costs : []).map((cost) => ({
    name: String(cost.name || "").trim() || "One-time cost",
    amount: Number(cost.amount) || 0,
    month: Math.max(0, Math.floor(Number(cost.month) || 0)),
  }));
  return out.length > 0 ? out : undefined;
}

function shiftRentSteps(steps: RentStep[], elapsedMonths: number): RentStep[] {
  return steps
    .map((step) => ({
      start: Math.max(0, Math.floor(Number(step.start) || 0)),
      end: Math.max(0, Math.floor(Number(step.end) || 0)),
      rate_psf_yr: Number(step.rate_psf_yr) || 0,
    }))
    .filter((step) => step.end >= elapsedMonths)
    .map((step) => {
      const start = Math.max(0, step.start - elapsedMonths);
      const end = Math.max(start, step.end - elapsedMonths);
      return { start, end, rate_psf_yr: step.rate_psf_yr };
    });
}

function shiftPhaseInSteps(steps: PhaseInStep[] | undefined, elapsedMonths: number): PhaseInStep[] | undefined {
  const out = (Array.isArray(steps) ? steps : [])
    .map((step) => ({
      start_month: Math.max(0, Math.floor(Number(step.start_month) || 0)),
      end_month: Math.max(0, Math.floor(Number(step.end_month) || 0)),
      rsf: Math.max(0, Number(step.rsf) || 0),
    }))
    .filter((step) => step.end_month >= elapsedMonths)
    .map((step) => {
      const start = Math.max(0, step.start_month - elapsedMonths);
      const end = Math.max(start, step.end_month - elapsedMonths);
      return { start_month: start, end_month: end, rsf: step.rsf };
    });
  return out.length > 0 ? out : undefined;
}

function shiftAbatementPeriods(
  periods: AbatementPeriod[] | undefined,
  elapsedMonths: number
): AbatementPeriod[] | undefined {
  const out = (Array.isArray(periods) ? periods : [])
    .map((period) => ({
      start_month: Math.max(0, Math.floor(Number(period.start_month) || 0)),
      end_month: Math.max(0, Math.floor(Number(period.end_month) || 0)),
      abatement_type: (period.abatement_type === "gross" ? "gross" : "base") as "base" | "gross",
    }))
    .filter((period) => period.end_month >= elapsedMonths)
    .map((period) => {
      const start = Math.max(0, period.start_month - elapsedMonths);
      const end = Math.max(start, period.end_month - elapsedMonths);
      return { start_month: start, end_month: end, abatement_type: period.abatement_type };
    });
  return out.length > 0 ? out : undefined;
}

function shiftParkingAbatementPeriods(
  periods: ParkingAbatementPeriod[] | undefined,
  elapsedMonths: number
): ParkingAbatementPeriod[] | undefined {
  const out = (Array.isArray(periods) ? periods : [])
    .map((period) => ({
      start_month: Math.max(0, Math.floor(Number(period.start_month) || 0)),
      end_month: Math.max(0, Math.floor(Number(period.end_month) || 0)),
    }))
    .filter((period) => period.end_month >= elapsedMonths)
    .map((period) => {
      const start = Math.max(0, period.start_month - elapsedMonths);
      const end = Math.max(start, period.end_month - elapsedMonths);
      return { start_month: start, end_month: end };
    });
  return out.length > 0 ? out : undefined;
}

function shiftOneTimeCosts(
  commencementIso: string,
  costs: OneTimeCost[] | undefined,
  remainingStartDate: string
): OneTimeCost[] | undefined {
  const out = (Array.isArray(costs) ? costs : [])
    .map((cost) => ({
      name: String(cost.name || "").trim() || "One-time cost",
      amount: Number(cost.amount) || 0,
      month: Math.max(0, Math.floor(Number(cost.month) || 0)),
    }))
    .map((cost) => {
      const costDate = addMonthsLocal(commencementIso, cost.month);
      return { ...cost, costDate };
    })
    .filter((cost) => !isIsoBefore(cost.costDate, remainingStartDate))
    .map((cost) => ({
      name: cost.name,
      amount: cost.amount,
      month: Math.max(0, monthDelta(remainingStartDate, cost.costDate)),
    }));
  return out.length > 0 ? out : undefined;
}

function snapshotFromScenario(scenario: ScenarioInput): OriginalExtractedLeaseSnapshot {
  return {
    name: scenario.name,
    commencement: scenario.commencement,
    expiration: scenario.expiration,
    rent_steps: cloneRentSteps(scenario.rent_steps),
    phase_in_steps: clonePhaseInSteps(scenario.phase_in_steps),
    free_rent_months: Math.max(0, Math.floor(Number(scenario.free_rent_months) || 0)),
    free_rent_start_month: scenario.free_rent_start_month,
    free_rent_end_month: scenario.free_rent_end_month,
    free_rent_abatement_type: scenario.free_rent_abatement_type,
    abatement_periods: cloneAbatementPeriods(scenario.abatement_periods),
    parking_abatement_periods: cloneParkingAbatementPeriods(scenario.parking_abatement_periods),
    one_time_costs: cloneOneTimeCosts(scenario.one_time_costs),
    broker_fee: Number(scenario.broker_fee) || 0,
    security_deposit_months: Math.max(0, Math.floor(Number(scenario.security_deposit_months) || 0)),
    ti_allowance_psf: Math.max(0, Number(scenario.ti_allowance_psf) || 0),
    ti_allowance_source_of_truth: scenario.ti_allowance_source_of_truth,
    ti_budget_total: Number(scenario.ti_budget_total) || 0,
    ti_source_of_truth: scenario.ti_source_of_truth,
  };
}

function buildingNameForRemainingLabel(scenario: ScenarioInput): string {
  const explicitBuilding = String(scenario.building_name || "").trim();
  if (explicitBuilding) return explicitBuilding;
  const fromName = String(scenario.name || "").trim();
  if (!fromName) return "Lease";
  return fromName
    .replace(/\s*-\s*option\s+[a-z0-9]+$/i, "")
    .replace(/\s+suite\s+.+$/i, "")
    .trim() || fromName;
}

function shiftedFreeRentFallback(
  snapshot: OriginalExtractedLeaseSnapshot,
  elapsedMonths: number
): AbatementPeriod[] | undefined {
  const fallbackMonths = Math.max(0, Math.floor(Number(snapshot.free_rent_months) || 0));
  if (fallbackMonths <= 0) return undefined;
  const fallbackStart = Math.max(0, Math.floor(Number(snapshot.free_rent_start_month ?? 0) || 0));
  const fallbackEnd = Math.max(
    fallbackStart,
    Math.floor(Number(snapshot.free_rent_end_month ?? (fallbackStart + fallbackMonths - 1)) || (fallbackStart + fallbackMonths - 1))
  );
  if (fallbackEnd < elapsedMonths) return undefined;
  const start = Math.max(0, fallbackStart - elapsedMonths);
  const end = Math.max(start, fallbackEnd - elapsedMonths);
  return [
    {
      start_month: start,
      end_month: end,
      abatement_type: snapshot.free_rent_abatement_type === "gross" ? "gross" : "base",
    },
  ];
}

export function firstDayOfNextMonthLocal(fromDate: Date = new Date()): string {
  const nextMonth = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, 1);
  return toLocalIsoDate(nextMonth);
}

export function hasCommencementBeforeToday(
  commencementDateIso: string,
  now: Date = new Date()
): boolean {
  const commencement = parseIsoAsLocalDate(commencementDateIso);
  if (!commencement) return false;
  const today = localStartOfDay(now);
  return commencement.getTime() < today.getTime();
}

export function applyFullOriginalTermModel<T extends ScenarioInput | ScenarioWithId>(scenario: T): T {
  const snapshot = scenario.original_extracted_lease;
  if (!snapshot) {
    return {
      ...scenario,
      is_remaining_obligation: false,
    } as T;
  }
  return {
    ...scenario,
    name: snapshot.name || scenario.name,
    commencement: snapshot.commencement,
    expiration: snapshot.expiration,
    rent_steps: cloneRentSteps(snapshot.rent_steps),
    phase_in_steps: clonePhaseInSteps(snapshot.phase_in_steps),
    free_rent_months: Math.max(0, Math.floor(Number(snapshot.free_rent_months) || 0)),
    free_rent_start_month: snapshot.free_rent_start_month,
    free_rent_end_month: snapshot.free_rent_end_month,
    free_rent_abatement_type: snapshot.free_rent_abatement_type,
    abatement_periods: cloneAbatementPeriods(snapshot.abatement_periods),
    parking_abatement_periods: cloneParkingAbatementPeriods(snapshot.parking_abatement_periods),
    one_time_costs: cloneOneTimeCosts(snapshot.one_time_costs),
    broker_fee: Number(snapshot.broker_fee) || 0,
    security_deposit_months: Math.max(0, Math.floor(Number(snapshot.security_deposit_months) || 0)),
    ti_allowance_psf: Math.max(0, Number(snapshot.ti_allowance_psf) || 0),
    ti_allowance_source_of_truth: snapshot.ti_allowance_source_of_truth,
    ti_budget_total: Number(snapshot.ti_budget_total) || 0,
    ti_source_of_truth: snapshot.ti_source_of_truth,
    is_remaining_obligation: false,
    original_extracted_lease: snapshot,
  } as T;
}

export function applyRemainingObligationModel<T extends ScenarioInput | ScenarioWithId>(
  scenario: T,
  now: Date = new Date()
): T {
  const snapshot = scenario.original_extracted_lease ?? snapshotFromScenario(scenario);
  const remainingStartDate = scenario.remaining_obligation_start_date || firstDayOfNextMonthLocal(now);
  const elapsedMonths = Math.max(0, monthDelta(snapshot.commencement, remainingStartDate));
  const rolledBaseOpex = rolledBaseOpexForRemaining(scenario, snapshot, remainingStartDate);

  const shiftedRent = shiftRentSteps(cloneRentSteps(snapshot.rent_steps), elapsedMonths);
  const shiftedPhaseIn = shiftPhaseInSteps(clonePhaseInSteps(snapshot.phase_in_steps), elapsedMonths);
  const shiftedAbatements = shiftAbatementPeriods(
    cloneAbatementPeriods(snapshot.abatement_periods),
    elapsedMonths
  ) ?? shiftedFreeRentFallback(snapshot, elapsedMonths);
  const shiftedParkingAbatements = shiftParkingAbatementPeriods(
    cloneParkingAbatementPeriods(snapshot.parking_abatement_periods),
    elapsedMonths
  );
  const shiftedOneTime = shiftOneTimeCosts(
    snapshot.commencement,
    cloneOneTimeCosts(snapshot.one_time_costs),
    remainingStartDate
  );

  const freeRentMonths = (shiftedAbatements ?? []).reduce(
    (sum, period) => sum + Math.max(0, period.end_month - period.start_month + 1),
    0
  );
  const firstAbatement = shiftedAbatements?.[0];
  const buildingLabel = buildingNameForRemainingLabel(scenario);

  return {
    ...scenario,
    name: `${buildingLabel} Remaining Obligation`,
    commencement: remainingStartDate,
    expiration: snapshot.expiration,
    rent_steps: shiftedRent,
    phase_in_steps: shiftedPhaseIn,
    free_rent_months: freeRentMonths,
    free_rent_start_month: firstAbatement?.start_month ?? 0,
    free_rent_end_month: firstAbatement?.end_month ?? 0,
    free_rent_abatement_type: firstAbatement?.abatement_type ?? snapshot.free_rent_abatement_type ?? "base",
    abatement_periods: shiftedAbatements,
    parking_abatement_periods: shiftedParkingAbatements,
    one_time_costs: shiftedOneTime,
    broker_fee: 0,
    security_deposit_months: 0,
    ti_allowance_psf: 0,
    ti_budget_total: 0,
    base_opex_psf_yr: Number(rolledBaseOpex.toFixed(4)),
    is_remaining_obligation: true,
    remaining_obligation_start_date: remainingStartDate,
    original_extracted_lease: snapshot,
  } as T;
}

export function applyLeaseModelChoice<T extends ScenarioInput | ScenarioWithId>(
  scenario: T,
  choice: CommencedLeaseModelChoice,
  now: Date = new Date()
): T {
  if (choice === "remaining_obligation") return applyRemainingObligationModel(scenario, now);
  const snapshot = scenario.original_extracted_lease ?? snapshotFromScenario(scenario);
  return {
    ...applyFullOriginalTermModel({
      ...scenario,
      original_extracted_lease: snapshot,
    } as T),
    original_extracted_lease: snapshot,
  } as T;
}

export function promptForCommencedLeaseModelChoice(
  confirmFn: (message?: string) => boolean
): CommencedLeaseModelChoice {
  const chooseRemaining = confirmFn(
    "This lease has already commenced.\n\n"
    + "Press OK: Remaining obligation only (from the beginning of next full month forward).\n"
    + "Press Cancel: Full original term obligation."
  );
  return chooseRemaining ? "remaining_obligation" : "full_original_term";
}
