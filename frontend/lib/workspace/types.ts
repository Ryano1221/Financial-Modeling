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
  logoDataUrl?: string;
  logoFileName?: string;
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
  dealId?: string;
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
  logoDataUrl?: string;
  logoFileName?: string;
}

export interface UpdateClientInput {
  name?: string;
  companyType?: string;
  industry?: string;
  contactName?: string;
  contactEmail?: string;
  brokerage?: string;
  notes?: string;
  logoDataUrl?: string;
  logoFileName?: string;
}

export interface RegisterClientDocumentInput {
  clientId?: string;
  dealId?: string;
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

export interface UpdateClientDocumentInput {
  dealId?: string;
  name?: string;
  type?: ClientDocumentType;
  building?: string;
  address?: string;
  suite?: string;
}

export type DealPriority = "low" | "medium" | "high" | "critical";
export type DealStatus = "open" | "won" | "lost" | "on_hold";

export interface DealActivityItem {
  id: string;
  clientId: string;
  dealId: string;
  label: string;
  description: string;
  createdAt: string;
}

export interface DealTaskItem {
  id: string;
  clientId: string;
  dealId: string;
  title: string;
  dueDate: string;
  completed: boolean;
  createdAt: string;
}

export interface ClientWorkspaceDeal {
  id: string;
  clientId: string;
  dealName: string;
  requirementName: string;
  dealType: string;
  stage: string;
  status: DealStatus;
  priority: DealPriority;
  targetMarket: string;
  submarket: string;
  city: string;
  squareFootageMin: number;
  squareFootageMax: number;
  budget: number;
  occupancyDateGoal: string;
  expirationDate: string;
  selectedProperty: string;
  selectedSuite: string;
  selectedLandlord: string;
  tenantRepBroker: string;
  notes: string;
  linkedSurveyIds: string[];
  linkedAnalysisIds: string[];
  linkedDocumentIds: string[];
  linkedObligationIds: string[];
  linkedLeaseAbstractIds: string[];
  timeline: DealActivityItem[];
  tasks: DealTaskItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDealInput {
  clientId?: string;
  dealName: string;
  requirementName?: string;
  dealType?: string;
  stage?: string;
  status?: DealStatus;
  priority?: DealPriority;
  targetMarket?: string;
  submarket?: string;
  city?: string;
  squareFootageMin?: number;
  squareFootageMax?: number;
  budget?: number;
  occupancyDateGoal?: string;
  expirationDate?: string;
  selectedProperty?: string;
  selectedSuite?: string;
  selectedLandlord?: string;
  tenantRepBroker?: string;
  notes?: string;
  linkedSurveyIds?: string[];
  linkedAnalysisIds?: string[];
  linkedDocumentIds?: string[];
  linkedObligationIds?: string[];
  linkedLeaseAbstractIds?: string[];
}

export interface UpdateDealInput {
  dealName?: string;
  requirementName?: string;
  dealType?: string;
  stage?: string;
  status?: DealStatus;
  priority?: DealPriority;
  targetMarket?: string;
  submarket?: string;
  city?: string;
  squareFootageMin?: number;
  squareFootageMax?: number;
  budget?: number;
  occupancyDateGoal?: string;
  expirationDate?: string;
  selectedProperty?: string;
  selectedSuite?: string;
  selectedLandlord?: string;
  tenantRepBroker?: string;
  notes?: string;
  linkedSurveyIds?: string[];
  linkedAnalysisIds?: string[];
  linkedDocumentIds?: string[];
  linkedObligationIds?: string[];
  linkedLeaseAbstractIds?: string[];
  timeline?: DealActivityItem[];
  tasks?: DealTaskItem[];
}

export const DEFAULT_DEAL_STAGES: readonly string[] = [
  "New Lead",
  "Qualified",
  "Requirement Gathering",
  "Market Survey",
  "Touring",
  "Shortlist",
  "Proposal Requested",
  "Proposal Received",
  "Financial Analysis",
  "Negotiation",
  "Finalist",
  "Lease Drafting",
  "Lease Review",
  "Executed",
  "Lost",
  "On Hold",
] as const;

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
