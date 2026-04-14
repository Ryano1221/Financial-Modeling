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
  website: string;
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
  canonical_extraction?: Record<string, unknown>;
}

export interface ClientWorkspaceDocument {
  id: string;
  clientId: string;
  companyId?: string;
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
  fileMimeType?: string;
  previewDataUrl?: string;
  normalizeSnapshot?: DocumentNormalizeSnapshot;
}

export interface CreateClientInput {
  name: string;
  companyType?: string;
  industry?: string;
  contactName?: string;
  contactEmail?: string;
  website?: string;
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
  website?: string;
  brokerage?: string;
  notes?: string;
  logoDataUrl?: string;
  logoFileName?: string;
}

export interface RegisterClientDocumentInput {
  clientId?: string;
  companyId?: string;
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
  companyId?: string;
  dealId?: string;
  name?: string;
  type?: ClientDocumentType;
  building?: string;
  address?: string;
  suite?: string;
  parsed?: boolean;
  fileMimeType?: string;
  previewDataUrl?: string;
  normalizeSnapshot?: DocumentNormalizeSnapshot;
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
  companyId?: string;
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
  dealRoom?: ClientWorkspaceDealRoom;
  createdAt: string;
  updatedAt: string;
}

export type ClientWorkspaceDealMemberAudience = "internal" | "client";

export interface ClientWorkspaceDealMember {
  id: string;
  name: string;
  email: string;
  role: string;
  audience: ClientWorkspaceDealMemberAudience;
}

export type ClientWorkspaceNegotiationStatus =
  | "watching"
  | "requested"
  | "in_review"
  | "countered"
  | "aligned"
  | "closed";

export interface ClientWorkspaceNegotiationItem {
  id: string;
  label: string;
  counterparty: string;
  status: ClientWorkspaceNegotiationStatus;
  targetValue: string;
  latestValue: string;
  notes: string;
  updatedAt: string;
}

export interface ClientWorkspaceDealRoom {
  projectedCloseDate: string;
  source: string;
  moveReason: string;
  estimatedCommission: number;
  dealioId: string;
  clientAccessEnabled: boolean;
  clientViewEnabled: boolean;
  currentLocationAddress: string;
  currentLocationSize: number;
  currentLeaseExpiration: string;
  renewalNoticeDate: string;
  expansionNoticeDate: string;
  internalSummary: string;
  clientSummary: string;
  members: ClientWorkspaceDealMember[];
  negotiations: ClientWorkspaceNegotiationItem[];
}

export type DealsViewMode = "board" | "table" | "timeline" | "client_grouped" | "stacking_plan";

export interface ClientCrmSettings {
  autoStageFromDocuments: boolean;
  defaultDealsView: DealsViewMode;
}

export interface CreateDealInput {
  clientId?: string;
  companyId?: string;
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
  dealRoom?: Partial<ClientWorkspaceDealRoom>;
}

export interface UpdateDealInput {
  companyId?: string;
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
  dealRoom?: ClientWorkspaceDealRoom;
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
  if (
    normalized === "table"
    || normalized === "timeline"
    || normalized === "client_grouped"
    || normalized === "stacking_plan"
  ) return normalized;
  return "board";
}

function asText(value: unknown): string {
  return String(value || "").trim();
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDealRoomMembers(value: unknown): ClientWorkspaceDealMember[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Partial<ClientWorkspaceDealMember>;
      const name = asText(obj.name);
      if (!name) return null;
      return {
        id: asText(obj.id) || `deal_member_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        name,
        email: asText(obj.email),
        role: asText(obj.role),
        audience: asText(obj.audience) === "client" ? "client" : "internal",
      } satisfies ClientWorkspaceDealMember;
    })
    .filter((item): item is ClientWorkspaceDealMember => Boolean(item));
}

function normalizeNegotiations(value: unknown): ClientWorkspaceNegotiationItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Partial<ClientWorkspaceNegotiationItem>;
      const label = asText(obj.label);
      if (!label) return null;
      const normalizedStatus = asText(obj.status);
      return {
        id: asText(obj.id) || `deal_negotiation_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        label,
        counterparty: asText(obj.counterparty),
        status:
          normalizedStatus === "requested"
          || normalizedStatus === "in_review"
          || normalizedStatus === "countered"
          || normalizedStatus === "aligned"
          || normalizedStatus === "closed"
            ? normalizedStatus
            : "watching",
        targetValue: asText(obj.targetValue),
        latestValue: asText(obj.latestValue),
        notes: asText(obj.notes),
        updatedAt: asText(obj.updatedAt),
      } satisfies ClientWorkspaceNegotiationItem;
    })
    .filter((item): item is ClientWorkspaceNegotiationItem => Boolean(item));
}

export function normalizeDealRoom(value: unknown): ClientWorkspaceDealRoom {
  if (!value || typeof value !== "object") {
    return {
      projectedCloseDate: "",
      source: "",
      moveReason: "",
      estimatedCommission: 0,
      dealioId: "",
      clientAccessEnabled: false,
      clientViewEnabled: false,
      currentLocationAddress: "",
      currentLocationSize: 0,
      currentLeaseExpiration: "",
      renewalNoticeDate: "",
      expansionNoticeDate: "",
      internalSummary: "",
      clientSummary: "",
      members: [],
      negotiations: [],
    };
  }
  const obj = value as Partial<ClientWorkspaceDealRoom>;
  return {
    projectedCloseDate: asText(obj.projectedCloseDate),
    source: asText(obj.source),
    moveReason: asText(obj.moveReason),
    estimatedCommission: asNumber(obj.estimatedCommission),
    dealioId: asText(obj.dealioId),
    clientAccessEnabled: Boolean(obj.clientAccessEnabled),
    clientViewEnabled: Boolean(obj.clientViewEnabled),
    currentLocationAddress: asText(obj.currentLocationAddress),
    currentLocationSize: asNumber(obj.currentLocationSize),
    currentLeaseExpiration: asText(obj.currentLeaseExpiration),
    renewalNoticeDate: asText(obj.renewalNoticeDate),
    expansionNoticeDate: asText(obj.expansionNoticeDate),
    internalSummary: asText(obj.internalSummary),
    clientSummary: asText(obj.clientSummary),
    members: normalizeDealRoomMembers(obj.members),
    negotiations: normalizeNegotiations(obj.negotiations),
  };
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
