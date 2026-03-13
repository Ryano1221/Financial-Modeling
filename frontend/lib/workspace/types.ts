import type { BackendCanonicalLease, ExtractionReviewTask, ExtractionSummary, NormalizerResponse } from "@/lib/types";
import type { PlatformModuleId } from "@/lib/platform/module-registry";
import {
  DEFAULT_REPRESENTATION_MODE,
  LANDLORD_REP_MODE,
  TENANT_REP_MODE,
  type RepresentationMode,
} from "@/lib/workspace/representation-mode";

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

export { DEFAULT_REPRESENTATION_MODE, LANDLORD_REP_MODE, TENANT_REP_MODE, type RepresentationMode };

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

export type DealsViewMode = "board" | "table" | "timeline" | "client_grouped";

export interface ClientCrmSettings {
  autoStageFromDocuments: boolean;
  defaultDealsView: DealsViewMode;
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

export const TENANT_REP_DEAL_STAGES: readonly string[] = [
  "New Lead",
  "Qualified",
  "Requirement Gathering",
  "Survey",
  "Touring",
  "Proposal Requested",
  "Proposal Received",
  "Financial Analysis",
  "Negotiation",
  "LOI",
  "Lease Drafting",
  "Lease Review",
  "Executed",
  "Lost",
  "On Hold",
] as const;

export const LANDLORD_REP_DEAL_STAGES: readonly string[] = [
  "New Inquiry",
  "Qualified Prospect",
  "Tour Scheduled",
  "Toured",
  "Proposal Out",
  "Proposal Received / Countering",
  "Negotiation",
  "LOI",
  "Lease Drafting",
  "Lease Review",
  "Executed",
  "Lost",
  "On Hold",
] as const;

export const DEFAULT_DEAL_STAGES: readonly string[] = TENANT_REP_DEAL_STAGES;

export const DEFAULT_CRM_SETTINGS: Readonly<ClientCrmSettings> = {
  autoStageFromDocuments: true,
  defaultDealsView: "board",
};

export function getDefaultDealStagesForMode(
  mode: RepresentationMode | null | undefined,
): readonly string[] {
  if (mode === LANDLORD_REP_MODE) return LANDLORD_REP_DEAL_STAGES;
  if (mode === TENANT_REP_MODE) return TENANT_REP_DEAL_STAGES;
  return DEFAULT_REPRESENTATION_MODE === LANDLORD_REP_MODE ? LANDLORD_REP_DEAL_STAGES : TENANT_REP_DEAL_STAGES;
}

export function normalizeDealsViewMode(value: unknown): DealsViewMode {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "table" || normalized === "timeline" || normalized === "client_grouped") return normalized;
  return "board";
}

export function getDefaultCrmSettingsForMode(
  _mode: RepresentationMode | null | undefined,
): ClientCrmSettings {
  return { ...DEFAULT_CRM_SETTINGS };
}

export function normalizeCrmSettings(
  value: unknown,
  mode: RepresentationMode | null | undefined,
): ClientCrmSettings {
  const defaults = getDefaultCrmSettingsForMode(mode);
  if (!value || typeof value !== "object") return defaults;
  const obj = value as Partial<ClientCrmSettings>;
  return {
    autoStageFromDocuments:
      typeof obj.autoStageFromDocuments === "boolean"
        ? obj.autoStageFromDocuments
        : defaults.autoStageFromDocuments,
    defaultDealsView: normalizeDealsViewMode(obj.defaultDealsView),
  };
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
