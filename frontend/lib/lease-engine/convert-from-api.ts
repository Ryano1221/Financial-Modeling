/**
 * Convert existing API ScenarioInput / ScenarioWithId to canonical LeaseScenarioCanonical.
 */

import type { ScenarioWithId } from "@/lib/types";
import type { LeaseScenarioCanonical } from "./canonical-schema";

function monthDiff(start: string, end: string): number {
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) months -= 1;
  return Math.max(0, months);
}

export function scenarioToCanonical(s: ScenarioWithId): LeaseScenarioCanonical {
  const termMonths = monthDiff(s.commencement, s.expiration);
  const rsf = s.rsf;
  const leaseType = s.opex_mode === "base_year" ? "base_year" : "nnn";
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
  const tiAllowanceTotal = s.ti_allowance_psf * rsf;

  return {
    id: s.id,
    name: s.name,
    discountRateAnnual: s.discount_rate_annual,
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
      annualEscalationPercent: 0,
      abatement:
        s.free_rent_months > 0
          ? {
              startDate: s.commencement,
              startMonth: Math.max(0, Math.floor(Number(s.free_rent_start_month ?? 0) || 0)),
              months: s.free_rent_months,
              type: "full",
              appliesTo: s.free_rent_abatement_type === "gross" ? "gross" : "base",
            }
          : undefined,
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
      annualEscalationPercent: s.opex_growth,
    },
    parkingSchedule: {
      spacesAllotted: parkingSpaces,
      slots:
        parkingSpaces > 0 && parkingCost > 0
          ? [{ type: "unreserved" as const, count: parkingSpaces, costPerSpacePerMonth: parkingCost }]
          : [],
      annualEscalationPercent: 0,
    },
    tiSchedule: {
      budgetTotal: tiAllowanceTotal,
      allowanceFromLandlord: tiAllowanceTotal,
      outOfPocket: 0,
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
