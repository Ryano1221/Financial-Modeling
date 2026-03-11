import type { SharedExportBranding } from "@/lib/export-design";
import {
  buildPlatformShareLink,
  parsePlatformShareData,
  type PlatformShareEnvelope,
} from "@/lib/platform-share";

export interface FinancialAnalysesShareScenarioRow {
  id: string;
  scenarioName: string;
  documentType: string;
  buildingName: string;
  suiteFloor: string;
  address: string;
  leaseType: string;
  rsf: number;
  commencementDate: string;
  expirationDate: string;
  termMonths: number;
  totalObligation: number;
  npvCost: number;
  avgCostPsfYear: number;
  equalizedAvgCostPsfYear: number;
}

export interface FinancialAnalysesSharePayload {
  scenarios: FinancialAnalysesShareScenarioRow[];
  equalizedWindow: {
    start: string;
    end: string;
    source: "overlap" | "custom";
  } | null;
}

export type FinancialAnalysesShareEnvelope = PlatformShareEnvelope<FinancialAnalysesSharePayload>;

export function buildFinancialAnalysesShareLink(
  payload: FinancialAnalysesSharePayload,
  branding?: SharedExportBranding | null,
): string {
  return buildPlatformShareLink(
    "/financial-analyses/share",
    "financial-analyses",
    payload,
    branding,
  );
}

export function parseFinancialAnalysesShareData(
  encoded: string | null | undefined,
): FinancialAnalysesShareEnvelope | null {
  const parsed = parsePlatformShareData<FinancialAnalysesSharePayload>(
    encoded,
    "financial-analyses",
  );
  if (!parsed || !Array.isArray(parsed.payload.scenarios)) return null;
  return parsed;
}
