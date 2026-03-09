import { describe, expect, it } from "vitest";
import {
  buildSensitivity,
  defaultSubleaseScenarios,
  runSubleaseRecoveryScenario,
} from "@/lib/sublease-recovery/engine";
import type { ExistingObligation, SubleaseScenario } from "@/lib/sublease-recovery/types";

function baseExisting(): ExistingObligation {
  return {
    premises: "Test Tower Suite 100",
    rsf: 1000,
    commencementDate: "2026-01-01",
    expirationDate: "2026-12-31",
    leaseType: "nnn",
    baseRentSchedule: [{ startMonth: 0, endMonth: 11, annualRatePsf: 120 }],
    baseOperatingExpense: 0,
    annualOperatingExpenseEscalation: 0,
    parkingRatio: 0,
    allottedParkingSpaces: 0,
    reservedPaidSpaces: 0,
    unreservedPaidSpaces: 0,
    parkingCostPerSpace: 0,
    annualParkingEscalation: 0,
    parkingSalesTax: 0,
    abatements: [],
    phaseInEvents: [],
  };
}

function baseScenario(): SubleaseScenario {
  return {
    id: "realistic",
    name: "Realistic Case",
    subtenantName: "",
    subtenantLegalEntity: "",
    dbaName: "",
    guarantor: "",
    brokerName: "",
    industry: "",
    subtenantNotes: "",
    sourceType: "manual",
    sourceDocumentName: "",
    sourceProposalName: "",
    proposalDate: "",
    proposalExpirationDate: "",
    propertyName: "Test Tower Suite 100",
    importedProposalMeta: undefined,
    downtimeMonths: 0,
    subleaseCommencementDate: "2026-01-01",
    subleaseTermMonths: 12,
    subleaseExpirationDate: "2026-12-31",
    rsf: 1000,
    leaseType: "nnn",
    baseRent: 120,
    rentInputType: "annual_psf",
    annualBaseRentEscalation: 0,
    rentEscalationType: "percent",
    baseOperatingExpense: 0,
    annualOperatingExpenseEscalation: 0,
    rentAbatementStartDate: "2026-01-01",
    rentAbatementMonths: 0,
    rentAbatementType: "base",
    customAbatementMonthlyAmount: 0,
    commissionPercent: 0,
    constructionBudget: 0,
    tiAllowanceToSubtenant: 0,
    legalMiscFees: 0,
    otherOneTimeCosts: 0,
    parkingRatio: 0,
    allottedParkingSpaces: 0,
    reservedPaidSpaces: 0,
    unreservedPaidSpaces: 0,
    parkingCostPerSpace: 0,
    annualParkingEscalation: 0,
    phaseInEvents: [],
    explicitBaseRentSchedule: [],
    discountRate: 0.08,
  };
}

describe("sublease recovery engine", () => {
  it("fully offsets obligation when sublease rent mirrors existing obligation", () => {
    const existing = baseExisting();
    const scenario = baseScenario();

    const result = runSubleaseRecoveryScenario(existing, scenario);

    expect(result.monthly).toHaveLength(12);
    expect(result.summary.totalRemainingObligation).toBe(120000);
    expect(result.summary.totalSubleaseRecovery).toBe(120000);
    expect(result.summary.totalSubleaseCosts).toBe(0);
    expect(result.summary.netObligation).toBe(0);
    expect(result.summary.recoveryPercent).toBeCloseTo(1, 6);
  });

  it("captures downtime impact on net obligation", () => {
    const existing = baseExisting();
    const scenario: SubleaseScenario = {
      ...baseScenario(),
      downtimeMonths: 6,
      subleaseCommencementDate: "2026-07-01",
      subleaseTermMonths: 6,
      subleaseExpirationDate: "2026-12-31",
    };

    const result = runSubleaseRecoveryScenario(existing, scenario);

    expect(result.summary.totalRemainingObligation).toBe(120000);
    expect(result.summary.totalSubleaseRecovery).toBe(60000);
    expect(result.summary.netObligation).toBe(60000);
    expect(result.summary.recoveryPercent).toBeCloseTo(0.5, 6);
  });

  it("applies custom monthly abatement against sublease recovery", () => {
    const existing = baseExisting();
    const scenario: SubleaseScenario = {
      ...baseScenario(),
      rentAbatementType: "custom",
      customAbatementMonthlyAmount: 2000,
      rentAbatementMonths: 3,
      rentAbatementStartDate: "2026-01-01",
    };

    const result = runSubleaseRecoveryScenario(existing, scenario);

    // 3 months x $2,000 custom abatement = $6,000 less recovery.
    expect(result.summary.totalSubleaseRecovery).toBe(114000);
    expect(result.summary.netObligation).toBe(6000);
  });

  it("builds default best/realistic/worst scenario templates", () => {
    const defaults = defaultSubleaseScenarios(baseExisting());
    expect(defaults.map((scenario) => scenario.name)).toEqual([
      "Best Case",
      "Realistic Case",
      "Worst Case",
    ]);
    expect(defaults).toHaveLength(3);
  });

  it("uses explicit proposal rent schedule when provided", () => {
    const existing = baseExisting();
    const scenario: SubleaseScenario = {
      ...baseScenario(),
      explicitBaseRentSchedule: [
        { startMonth: 0, endMonth: 5, annualRatePsf: 120 },
        { startMonth: 6, endMonth: 11, annualRatePsf: 60 },
      ],
      annualBaseRentEscalation: 0.25,
    };

    const result = runSubleaseRecoveryScenario(existing, scenario);

    expect(result.summary.totalSubleaseRecovery).toBe(90000);
    expect(result.summary.netObligation).toBe(30000);
  });

  it("produces sensitivity outputs for required levers", () => {
    const sensitivity = buildSensitivity(baseExisting(), baseScenario());
    expect(sensitivity.matrix.length).toBeGreaterThan(0);
    expect(sensitivity.termSensitivity).toHaveLength(3);
    expect(sensitivity.commissionSensitivity).toHaveLength(3);
    expect(sensitivity.tiLegalSensitivity).toHaveLength(3);
    expect(sensitivity.opexSensitivity).toHaveLength(3);
  });
});
