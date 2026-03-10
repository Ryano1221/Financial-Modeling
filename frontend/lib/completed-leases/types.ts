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

