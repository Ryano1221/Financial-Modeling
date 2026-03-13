import type { BackendCanonicalLease, ExtractionSummary } from "@/lib/types";

export type ObligationDocumentKind =
  | "lease"
  | "amendment"
  | "proposal"
  | "counter"
  | "abstract"
  | "survey"
  | "analysis"
  | "sublease"
  | "other";

export interface ObligationCompany {
  id: string;
  name: string;
  createdAtIso: string;
}

export interface ObligationRecord {
  id: string;
  clientId: string;
  companyId: string;
  title: string;
  buildingName: string;
  address: string;
  suite: string;
  floor: string;
  leaseType: string;
  rsf: number;
  commencementDate: string;
  expirationDate: string;
  rentCommencementDate: string;
  noticeDate: string;
  renewalDate: string;
  terminationRightDate: string;
  annualObligation: number;
  totalObligation: number;
  completenessScore: number;
  sourceDocumentIds: string[];
  linkedAnalysisCount: number;
  linkedSurveyCount: number;
  createdAtIso: string;
  updatedAtIso: string;
  notes: string;
}

export interface ObligationDocumentRecord {
  id: string;
  clientId: string;
  sourceDocumentId?: string;
  companyId: string;
  obligationId: string;
  fileName: string;
  kind: ObligationDocumentKind;
  uploadedAtIso: string;
  confidenceScore: number;
  reviewRequired: boolean;
  parseWarnings: string[];
  extractionSummary?: ExtractionSummary;
  canonical?: BackendCanonicalLease;
}

export interface ObligationPortfolioMetrics {
  obligationCount: number;
  documentCount: number;
  totalRsf: number;
  totalAnnualObligation: number;
  expiringWithin12Months: number;
  upcomingNoticeWithin6Months: number;
  upcomingRenewalWithin12Months: number;
  upcomingTerminationWithin12Months: number;
  averageCompleteness: number;
}

export interface ObligationTimelineBucket {
  year: number;
  expiringCount: number;
  noticeCount: number;
  renewalCount: number;
  terminationCount: number;
}

export interface ObligationStorageState {
  clientId: string;
  companies: ObligationCompany[];
  obligations: ObligationRecord[];
  documents: ObligationDocumentRecord[];
  activeCompanyId: string;
  selectedObligationId: string;
}
