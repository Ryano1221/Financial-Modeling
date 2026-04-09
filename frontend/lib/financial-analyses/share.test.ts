import { describe, expect, it } from "vitest";
import type { EqualizedComparisonResult } from "@/lib/equalized";
import type { EngineResult, OptionMetrics } from "@/lib/lease-engine/monthly-engine";
import {
  buildFinancialAnalysesSharePayload,
  buildFinancialAnalysesShareLink,
  materializeFinancialAnalysesSharePayload,
  parseFinancialAnalysesShareData,
} from "@/lib/financial-analyses/share";

function makeMetrics(overrides: Partial<OptionMetrics> = {}): OptionMetrics {
  return {
    buildingName: "One Tower",
    suiteName: "Suite 500",
    premisesName: "One Tower / Suite 500",
    rsf: 12000,
    leaseType: "NNN",
    termMonths: 60,
    commencementDate: "2026-01-01",
    expirationDate: "2030-12-31",
    baseRentPsfYr: 42,
    escalationPercent: 0.03,
    abatementAmount: 10000,
    abatementType: "Base rent",
    abatementAppliedWhen: "M1-M3",
    opexPsfYr: 15,
    opexEscalationPercent: 0.03,
    parkingCostPerSpotMonthlyPreTax: 150,
    parkingCostPerSpotMonthly: 162,
    parkingSalesTaxPercent: 0.08,
    parkingSpaces: 20,
    parkingCostMonthly: 3240,
    parkingCostAnnual: 38880,
    tiBudget: 45,
    tiAllowance: 25,
    tiOutOfPocket: 240000,
    grossTiOutOfPocket: 300000,
    avgGrossRentPerMonth: 42000,
    avgGrossRentPerYear: 504000,
    avgAllInCostPerMonth: 53000,
    avgAllInCostPerYear: 636000,
    avgCostPsfYr: 53,
    npvAtDiscount: 2100000,
    commissionPercent: 0.04,
    commissionBasis: "Base rent",
    commissionAmount: 85000,
    netEffectiveRatePsfYr: 49,
    discountRateUsed: 0.08,
    totalObligation: 3180000,
    equalizedAvgCostPsfYr: 52,
    notes: "Parking: total 20 spaces at 1.67/1,000 RSF",
    ...overrides,
  };
}

function makeResult(id: string, scenarioName: string, overrides: Partial<OptionMetrics> = {}): EngineResult {
  return {
    scenarioId: id,
    scenarioName,
    termMonths: 60,
    monthly: [
      {
        monthIndex: 0,
        periodStart: "2026-01-01",
        periodEnd: "2026-02-01",
        baseRent: 0,
        opex: 0,
        parking: 0,
        tiAmortization: 120000,
        misc: -25000,
        total: 95000,
        effectivePsfYr: 0,
        cumulativeCost: 95000,
        discountedValue: 95000,
      },
      {
        monthIndex: 1,
        periodStart: "2026-02-01",
        periodEnd: "2026-03-01",
        baseRent: 40000,
        opex: 12000,
        parking: 3000,
        tiAmortization: 0,
        misc: 1000,
        total: 56000,
        effectivePsfYr: 56,
        cumulativeCost: 151000,
        discountedValue: 55000,
      },
    ],
    annual: [],
    metrics: makeMetrics(overrides),
    discountRateUsed: 0.08,
  };
}

describe("financial analyses share payload", () => {
  it("preserves richer summary, charts, and annual cash flow data", () => {
    const results = [
      makeResult("s1", "Option A"),
      makeResult("s2", "Option B", { avgCostPsfYr: 57, totalObligation: 3420000, npvAtDiscount: 2300000 }),
    ];
    const equalized: EqualizedComparisonResult = {
      hasOverlap: true,
      needsCustomWindow: false,
      message: "",
      windowStart: "2026-01-01",
      windowEnd: "2030-12-31",
      windowDays: 1826,
      windowMonthCount: 60,
      windowSource: "overlap",
      metricsByScenario: {
        s1: {
          scenarioId: "s1",
          averageGrossRentPsfYear: 41,
          averageGrossRentMonth: 41000,
          averageCostPsfYear: 52,
          averageCostYear: 624000,
          averageCostMonth: 52000,
          totalCost: 3120000,
          npvCost: 2100000,
        },
        s2: {
          scenarioId: "s2",
          averageGrossRentPsfYear: 44,
          averageGrossRentMonth: 44000,
          averageCostPsfYear: 55,
          averageCostYear: 660000,
          averageCostMonth: 55000,
          totalCost: 3300000,
          npvCost: 2250000,
        },
      },
    };

    const payload = buildFinancialAnalysesSharePayload({
      scenarioRows: [
        {
          id: "s1",
          scenarioName: "Option A",
          documentType: "proposal",
          buildingName: "One Tower",
          suiteFloor: "Suite 500",
          address: "100 Main St",
          leaseType: "NNN",
          rsf: 12000,
          commencementDate: "2026-01-01",
          expirationDate: "2030-12-31",
          termMonths: 60,
          totalObligation: 3180000,
          npvCost: 2100000,
          avgCostPsfYear: 53,
          equalizedAvgCostPsfYear: 52,
        },
      ],
      results,
      equalized,
      customCharts: [
        {
          title: "Avg Cost vs NPV",
          bar_metric_key: "avgCostPsfYr",
          bar_metric_label: "Avg Cost/SF/YR",
          line_metric_key: "npvAtDiscount",
          line_metric_label: "NPV @ Discount Rate",
          sort_direction: "desc",
          points: [],
        },
      ],
    });

    const view = materializeFinancialAnalysesSharePayload(payload);

    expect(view.results).toHaveLength(2);
    expect(view.results[0]?.metrics.buildingName).toBe("One Tower");
    expect(view.equalized?.metricsByScenario.s1?.averageCostPsfYear).toBe(52);
    expect(view.charts[0]?.barMetricKey).toBe("avgCostPsfYr");
    expect(view.annualByScenario.s1?.[0]?.[0]).toBe(0);
    expect(view.annualByScenario.s1?.[1]?.[5]).toBe(56000);
  });

  it("preserves richer data through share-link encoding and parsing", () => {
    const originalWindow = globalThis.window;
    const fakeWindow = {
      btoa: (value: string) => Buffer.from(value, "utf8").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("utf8"),
      location: { origin: "https://thecremodel.com" },
    } as unknown as Window & typeof globalThis;
    globalThis.window = fakeWindow;

    try {
      const payload = buildFinancialAnalysesSharePayload({
        scenarioRows: [
          {
            id: "s1",
            scenarioName: "Option A",
            documentType: "proposal",
            buildingName: "One Tower",
            suiteFloor: "Suite 500",
            address: "100 Main St",
            leaseType: "NNN",
            rsf: 12000,
            commencementDate: "2026-01-01",
            expirationDate: "2030-12-31",
            termMonths: 60,
            totalObligation: 3180000,
            npvCost: 2100000,
            avgCostPsfYear: 53,
            equalizedAvgCostPsfYear: 52,
          },
        ],
        results: [makeResult("s1", "Option A")],
        equalized: {
          hasOverlap: true,
          needsCustomWindow: false,
          message: "",
          windowStart: "2026-01-01",
          windowEnd: "2030-12-31",
          windowDays: 1826,
          windowMonthCount: 60,
          windowSource: "overlap",
          metricsByScenario: {
            s1: {
              scenarioId: "s1",
              averageGrossRentPsfYear: 41,
              averageGrossRentMonth: 41000,
              averageCostPsfYear: 52,
              averageCostYear: 624000,
              averageCostMonth: 52000,
              totalCost: 3120000,
              npvCost: 2100000,
            },
          },
        },
        customCharts: [
          {
            title: "Avg Cost vs NPV",
            bar_metric_key: "avgCostPsfYr",
            bar_metric_label: "Avg Cost/SF/YR",
            line_metric_key: "npvAtDiscount",
            line_metric_label: "NPV @ Discount Rate",
            sort_direction: "desc",
            points: [],
          },
        ],
      });

      const link = buildFinancialAnalysesShareLink(payload, {
        brokerageName: "The CRE Model",
        clientName: "Thermon",
      });
      const encoded = new URL(link).searchParams.get("data");
      const parsed = parseFinancialAnalysesShareData(encoded);

      expect(parsed).not.toBeNull();
      const view = materializeFinancialAnalysesSharePayload(parsed!.payload);
      expect(view.results).toHaveLength(1);
      expect(view.charts[0]?.barMetricKey).toBe("avgCostPsfYr");
      expect(view.equalized?.metricsByScenario.s1?.averageCostPsfYear).toBe(52);
      expect(view.annualByScenario.s1?.[1]?.[5]).toBe(56000);
    } finally {
      globalThis.window = originalWindow;
    }
  });
});
