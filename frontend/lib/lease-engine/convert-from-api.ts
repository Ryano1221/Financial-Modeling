/**
 * Convert existing API ScenarioInput / ScenarioWithId to canonical LeaseScenarioCanonical.
 */

import type { ScenarioWithId } from "@/lib/types";
import type { LeaseScenarioCanonical } from "./canonical-schema";
import {
  effectiveTiAllowancePsf,
  effectiveTiBudgetTotal,
  round0,
} from "@/lib/ti";
import { inferRentEscalationPercentFromSteps } from "@/lib/rent-escalation";

function monthDiff(start: string, endInclusive: string): number {
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = endInclusive.split("-").map(Number);
  if (![y1, m1, d1, y2, m2, d2].every(Number.isFinite)) return 0;

  // Lease expiration is stored as an inclusive date; convert to an exclusive
  // boundary so end-of-month expirations keep their full final month.
  const endExclusive = new Date(Date.UTC(y2, m2 - 1, d2 + 1));
  let months = (endExclusive.getUTCFullYear() - y1) * 12 + (endExclusive.getUTCMonth() + 1 - m1);
  if (endExclusive.getUTCDate() < d1) months -= 1;
  return Math.max(0, months);
}

function normalizeCommissionRateDecimal(value: unknown, fallback = 0.06): number {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  const asDecimal = parsed > 1 ? parsed / 100 : parsed;
  return Math.min(1, Math.max(0, asDecimal));
}

function normalizeDecimalRate(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  const asDecimal = parsed > 1 ? parsed / 100 : parsed;
  return Math.max(0, asDecimal);
}

export function scenarioToCanonical(s: ScenarioWithId): LeaseScenarioCanonical {
  const termMonths = monthDiff(s.commencement, s.expiration);
  const rsf = s.rsf;
  const leaseType =
    s.opex_mode === "base_year"
      ? "base_year"
      : s.opex_mode === "full_service"
        ? "full_service"
        : "nnn";
  const buildingName = (s.building_name ?? "").trim();
  const suite = (s.suite ?? "").trim();
  const floor = (s.floor ?? "").trim();
  const suiteName = suite || (floor ? `Floor ${floor}` : "");
  const premisesName = buildingName && suite
    ? `${buildingName} Suite ${suite}`
    : buildingName && floor
      ? `${buildingName} Floor ${floor}`
      : (buildingName || suiteName || s.name);
  const parkingSpaces = s.parking_spaces ?? 0;
  const parkingCost = s.parking_cost_monthly_per_space ?? 0;
  const parkingSalesTax = normalizeDecimalRate(s.parking_sales_tax_rate, 0.0825);
  const tiBudgetTotal = effectiveTiBudgetTotal(s);
  const tiAllowancePsf = effectiveTiAllowancePsf(s);
  const tiAllowanceTotal = rsf > 0 ? round0(tiAllowancePsf * rsf) : tiBudgetTotal;
  const tiNetImpact = tiBudgetTotal - tiAllowanceTotal;
  const normalizedAbatements = (s.abatement_periods ?? [])
    .map((period) => {
      const start = Math.max(0, Math.floor(Number(period.start_month) || 0));
      const end = Math.max(start, Math.floor(Number(period.end_month) || start));
      return {
        startMonth: start,
        endMonth: end,
        months: end - start + 1,
        startDate: s.commencement,
        type: "full" as const,
        appliesTo: period.abatement_type === "gross" ? "gross" as const : "base" as const,
      };
    })
    .filter((period) => period.months > 0);
  const fallbackAbatement =
    s.free_rent_months > 0
      ? {
          startDate: s.commencement,
          startMonth: Math.max(0, Math.floor(Number(s.free_rent_start_month ?? 0) || 0)),
          months: s.free_rent_months,
          type: "full" as const,
          appliesTo: s.free_rent_abatement_type === "gross" ? "gross" as const : "base" as const,
        }
      : undefined;
  const effectiveAbatements = normalizedAbatements.length > 0 ? normalizedAbatements : (fallbackAbatement ? [fallbackAbatement] : []);
  const normalizedParkingAbatements = (s.parking_abatement_periods ?? [])
    .map((period) => {
      const start = Math.max(0, Math.floor(Number(period.start_month) || 0));
      const end = Math.max(start, Math.floor(Number(period.end_month) || start));
      return {
        startMonth: start,
        endMonth: end,
        months: end - start + 1,
        startDate: s.commencement,
        type: "full" as const,
      };
    })
    .filter((period) => period.months > 0);

  return {
    id: s.id,
    name: s.name,
    isRemainingObligation: Boolean(s.is_remaining_obligation),
    documentTypeDetected: (s.document_type_detected ?? "").trim() || undefined,
    discountRateAnnual: normalizeDecimalRate(s.discount_rate_annual, 0.08),
    commissionRate: normalizeCommissionRateDecimal(s.commission_rate, 0.06),
    commissionAppliesTo: s.commission_applies_to === "base_rent" ? "base_rent" : "gross_obligation",
    partyAndPremises: {
      premisesName,
      premisesLabel: buildingName,
      floorsOrSuite: suiteName,
      rentableSqFt: rsf,
      leaseType,
    },
    datesAndTerm: {
      leaseTermMonths: termMonths,
      commencementDate: s.commencement,
      expirationDate: s.expiration,
    },
    rentSchedule: {
      steps: s.rent_steps.map((step) => ({
        startMonth: step.start,
        endMonth: step.end,
        ratePsfYr: step.rate_psf_yr,
      })),
      annualEscalationPercent: inferRentEscalationPercentFromSteps(s.rent_steps),
      abatement: effectiveAbatements[0],
      abatements: effectiveAbatements.length > 0 ? effectiveAbatements : undefined,
    },
    phaseInSchedule: (s.phase_in_steps ?? []).map((step) => ({
      startMonth: step.start_month,
      endMonth: step.end_month,
      rsf: step.rsf,
    })),
    expenseSchedule: {
      leaseType,
      baseOpexPsfYr: s.base_opex_psf_yr,
      baseYearOpexPsfYr: s.base_year_opex_psf_yr,
      opexByCalendarYear: s.opex_by_calendar_year,
      annualEscalationPercent: normalizeDecimalRate(s.opex_growth, 0),
    },
    parkingSchedule: {
      spacesAllotted: parkingSpaces,
      salesTaxPercent: parkingSalesTax,
      slots:
        parkingSpaces > 0 && parkingCost > 0
          ? [{ type: "unreserved" as const, count: parkingSpaces, costPerSpacePerMonth: parkingCost }]
          : [],
      annualEscalationPercent: 0,
      parkingAbatements: normalizedParkingAbatements.length > 0 ? normalizedParkingAbatements : undefined,
    },
    tiSchedule: {
      budgetTotal: tiBudgetTotal,
      allowanceFromLandlord: tiAllowanceTotal,
      outOfPocket: Math.max(0, tiNetImpact),
      grossOutOfPocket: Math.max(0, tiNetImpact),
      amortizeOop: false,
    },
    otherCashFlows: {
      oneTimeCosts: s.one_time_costs ?? [],
      brokerFee: s.broker_fee ?? 0,
      securityDepositMonths: s.security_deposit_months ?? 0,
    },
    notes: s.notes ?? "",
  };
}
