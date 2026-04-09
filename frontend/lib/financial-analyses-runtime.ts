import type { EqualizedComparisonResult } from "@/lib/equalized";
import { scenarioToCanonical } from "@/lib/lease-engine/convert-from-api";
import { runMonthlyEngine } from "@/lib/lease-engine/monthly-engine";
import type { ScenarioWithId } from "@/lib/types";

const INVALID_SCENARIO_MESSAGE =
  "This extracted option could not be loaded into analysis. Re-upload the source document so the extractor can rebuild it cleanly.";

export interface ScenarioRuntimeError {
  scenarioId: string;
  name: string;
  error: string;
}

export interface RenderableScenarioCollection {
  validScenarios: ScenarioWithId[];
  errors: ScenarioRuntimeError[];
}

export function validateScenarioForFinancialAnalysis(
  scenario: ScenarioWithId,
  globalDiscountRate: number,
): string | null {
  try {
    const canonical = scenarioToCanonical(scenario);
    const discountRate =
      Number(scenario.discount_rate_annual ?? globalDiscountRate) || globalDiscountRate;
    runMonthlyEngine(canonical, discountRate);
    return null;
  } catch {
    return INVALID_SCENARIO_MESSAGE;
  }
}

export function collectRenderableFinancialAnalysisScenarios(
  scenarios: ScenarioWithId[],
  globalDiscountRate: number,
): RenderableScenarioCollection {
  const validScenarios: ScenarioWithId[] = [];
  const errors: ScenarioRuntimeError[] = [];

  scenarios.forEach((scenario) => {
    const error = validateScenarioForFinancialAnalysis(scenario, globalDiscountRate);
    if (error) {
      errors.push({
        scenarioId: scenario.id,
        name: scenario.name,
        error,
      });
      return;
    }
    validScenarios.push(scenario);
  });

  return { validScenarios, errors };
}

export function createEmptyEqualizedComparisonResult(
  message = "",
): EqualizedComparisonResult {
  return {
    hasOverlap: false,
    needsCustomWindow: false,
    message,
    windowStart: "",
    windowEnd: "",
    windowDays: 0,
    windowMonthCount: 0,
    windowSource: "overlap",
    metricsByScenario: {},
  };
}
