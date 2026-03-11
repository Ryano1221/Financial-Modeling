import type { BackendCanonicalLease, ExtractionReviewTask, ExtractionSummary, NormalizerResponse } from "@/lib/types";

export type SurveyLeaseType = "NNN" | "Gross" | "Modified Gross" | "Base Year" | "Unknown";
export type SurveyOccupancyType = "Direct" | "Sublease" | "Unknown";

export interface SurveyEntry {
  id: string;
  clientId: string;
  sourceDocumentName: string;
  sourceType: "parsed_document" | "manual_image";
  uploadedAtIso: string;
  buildingName: string;
  address: string;
  floor: string;
  suite: string;
  availableSqft: number;
  baseRentPsfAnnual: number;
  opexPsfAnnual: number;
  leaseType: SurveyLeaseType;
  occupancyType: SurveyOccupancyType;
  sublessor: string;
  subleaseExpirationDate: string;
  parkingSpaces: number;
  parkingRateMonthlyPerSpace: number;
  notes: string;
  needsReview: boolean;
  reviewReasons: string[];
  extractionSummary?: ExtractionSummary;
  reviewTasks: ExtractionReviewTask[];
  fieldConfidence: Record<string, number>;
  rawCanonical?: BackendCanonicalLease;
  rawNormalize?: NormalizerResponse;
}

export interface SurveyCostBreakdown {
  baseRentMonthly: number;
  opexMonthly: number;
  parkingMonthly: number;
  totalMonthly: number;
  leaseTypeRule: string;
}

export interface SurveysExportBranding {
  brokerageName?: string | null;
  clientName?: string | null;
  reportDate?: string | null;
  preparedBy?: string | null;
  brokerageLogoDataUrl?: string | null;
  clientLogoDataUrl?: string | null;
}

export interface SurveysSharePayload {
  version: 1;
  generatedAtIso: string;
  branding: {
    brokerageName: string;
    clientName: string;
    reportDate: string;
    preparedBy: string;
  };
  entries: SurveyEntry[];
}
