import type { BackendCanonicalLease, ExtractionReviewTask, ExtractionSummary, NormalizerResponse } from "@/lib/types";

export type CompletedLeaseDocumentKind = "lease" | "amendment";

export interface CompletedLeaseExportBranding {
  brokerageName?: string | null;
  clientName?: string | null;
  reportDate?: string | null;
  preparedBy?: string | null;
  brokerageLogoDataUrl?: string | null;
  clientLogoDataUrl?: string | null;
}

export interface CompletedLeaseDocumentRecord {
  id: string;
  clientId: string;
  fileName: string;
  uploadedAtIso: string;
  kind: CompletedLeaseDocumentKind;
  linkedLeaseId?: string;
  canonical: BackendCanonicalLease;
  fieldConfidence: Record<string, number>;
  warnings: string[];
  extractionSummary?: ExtractionSummary;
  reviewTasks: ExtractionReviewTask[];
  source: NormalizerResponse;
}

export interface CompletedLeaseAbstractView {
  controllingCanonical: BackendCanonicalLease;
  controllingDocumentId: string;
  sourceDocuments: CompletedLeaseDocumentRecord[];
  overrideNotes: string[];
}

export interface CompletedLeaseShareField {
  label: string;
  value: string;
}

export interface CompletedLeaseShareSourceDocument {
  kind: CompletedLeaseDocumentKind;
  fileName: string;
  uploadedAtIso: string;
  controllingStatus: "controlling" | "reference";
}

export interface CompletedLeaseSharePayload {
  title: string;
  fields: CompletedLeaseShareField[];
  sourceDocuments: CompletedLeaseShareSourceDocument[];
  overrideNotes: string[];
}
