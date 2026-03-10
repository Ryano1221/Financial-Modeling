import type { BackendCanonicalLease, ExtractionReviewTask, ExtractionSummary, NormalizerResponse } from "@/lib/types";
import type { PlatformModuleId } from "@/lib/platform/module-registry";

export interface ClientWorkspaceClient {
  id: string;
  name: string;
  companyType: string;
  industry: string;
  contactName: string;
  contactEmail: string;
  brokerage: string;
  notes: string;
  createdAt: string;
}

export type ClientDocumentType =
  | "proposals"
  | "lois"
  | "counters"
  | "leases"
  | "amendments"
  | "redlines"
  | "surveys"
  | "flyers"
  | "floorplans"
  | "abstracts"
  | "financial analyses"
  | "sublease documents"
  | "other";

export type ClientDocumentSourceModule =
  | "document-center"
  | "sublease-recovery"
  | "upload"
  | PlatformModuleId;

export interface DocumentNormalizeSnapshot {
  canonical_lease: BackendCanonicalLease;
  extraction_summary?: ExtractionSummary;
  review_tasks?: ExtractionReviewTask[];
  field_confidence?: Record<string, number>;
  warnings?: string[];
  confidence_score?: number;
  option_variants?: BackendCanonicalLease[];
}

export interface ClientWorkspaceDocument {
  id: string;
  clientId: string;
  name: string;
  type: ClientDocumentType;
  building: string;
  address: string;
  suite: string;
  parsed: boolean;
  uploadedBy: string;
  uploadedAt: string;
  sourceModule: ClientDocumentSourceModule;
  previewDataUrl?: string;
  normalizeSnapshot?: DocumentNormalizeSnapshot;
}

export interface CreateClientInput {
  name: string;
  companyType?: string;
  industry?: string;
  contactName?: string;
  contactEmail?: string;
  brokerage?: string;
  notes?: string;
}

export interface RegisterClientDocumentInput {
  clientId?: string;
  name: string;
  file?: File | null;
  type?: ClientDocumentType;
  building?: string;
  address?: string;
  suite?: string;
  parsed?: boolean;
  uploadedBy?: string;
  sourceModule: ClientDocumentSourceModule;
  normalize?: NormalizerResponse | DocumentNormalizeSnapshot | null;
}

export const CLIENT_DOCUMENT_TYPES: readonly ClientDocumentType[] = [
  "proposals",
  "lois",
  "counters",
  "leases",
  "amendments",
  "redlines",
  "surveys",
  "flyers",
  "floorplans",
  "abstracts",
  "financial analyses",
  "sublease documents",
  "other",
] as const;
