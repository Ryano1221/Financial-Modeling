import type { ClientDocumentType, ClientWorkspaceClient, ClientWorkspaceDeal, ClientWorkspaceDocument } from "@/lib/workspace/types";
import type {
  CrmBuilding,
  CrmClientRelationshipRecord,
  CrmCompany,
  CrmOccupancyRecord,
  CrmProspectingRecord,
  CrmReminder,
  CrmTask,
  CrmTemplate,
  CrmTouchpoint,
} from "@/lib/workspace/crm";

export type BrokerageOsActorType = "user" | "ai" | "system";

export interface BrokerageOsActor {
  type: BrokerageOsActorType;
  id: string;
  name: string;
}

export interface BrokerageOsCompany {
  id: string;
  clientId: string;
  name: string;
}

export interface BrokerageOsContact {
  id: string;
  clientId: string;
  companyId?: string;
  name: string;
  email: string;
  role: string;
}

export interface BrokerageOsRequirement {
  id: string;
  clientId: string;
  dealId: string;
  name: string;
  market: string;
  submarket: string;
  squareFootageMin: number;
  squareFootageMax: number;
  budget: number;
  occupancyGoal: string;
  noticeDeadline: string;
}

export interface BrokerageOsProperty {
  id: string;
  clientId: string;
  name: string;
  address: string;
  market: string;
  submarket: string;
}

export interface BrokerageOsSpace {
  id: string;
  clientId: string;
  propertyId: string;
  floor: string;
  suite: string;
  rsf: number;
}

export interface BrokerageOsSurvey {
  id: string;
  clientId: string;
  dealId?: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceDocumentIds: string[];
}

export interface BrokerageOsSurveyEntry {
  id: string;
  clientId: string;
  surveyId: string;
  propertyId?: string;
  spaceId?: string;
  building: string;
  address: string;
  floor: string;
  suite: string;
  rsf: number;
  baseRentPsfAnnual: number;
  opexPsfAnnual: number;
  leaseType: string;
  occupancyType: string;
  sublessor: string;
  subleaseExpiration: string;
  monthlyOccupancyCost: number;
  sourceDocumentId?: string;
}

export interface BrokerageOsProposal {
  id: string;
  clientId: string;
  dealId?: string;
  propertyId?: string;
  spaceId?: string;
  documentId: string;
  type: "proposal" | "loi" | "counter" | "sublease document";
  annualRatePsf: number;
  termMonths: number;
  summary: string;
}

export interface BrokerageOsFinancialAnalysis {
  id: string;
  clientId: string;
  dealId?: string;
  proposalId?: string;
  sourceDocumentId?: string;
  name: string;
  createdAt: string;
  status: "draft" | "completed";
}

export interface BrokerageOsSubleaseRecovery {
  id: string;
  clientId: string;
  dealId?: string;
  obligationId?: string;
  proposalIds: string[];
  name: string;
  createdAt: string;
  status: "draft" | "completed";
}

export interface BrokerageOsLease {
  id: string;
  clientId: string;
  dealId?: string;
  propertyId?: string;
  spaceId?: string;
  documentId: string;
  tenant: string;
  landlord: string;
  commencement: string;
  expiration: string;
}

export interface BrokerageOsAmendment {
  id: string;
  clientId: string;
  leaseId: string;
  documentId: string;
  effectiveDate: string;
  summary: string;
}

export interface BrokerageOsLeaseAbstract {
  id: string;
  clientId: string;
  leaseId: string;
  amendmentIds: string[];
  documentId?: string;
  name: string;
  createdAt: string;
}

export interface BrokerageOsObligation {
  id: string;
  clientId: string;
  leaseId?: string;
  dealId?: string;
  propertyId?: string;
  spaceId?: string;
  title: string;
  rsf: number;
  annualRentObligation: number;
  totalObligation: number;
  renewalDate: string;
  noticeDate: string;
  expirationDate: string;
  terminationRightDate: string;
  sourceDocumentIds: string[];
}

export interface BrokerageOsTask {
  id: string;
  clientId: string;
  dealId?: string;
  title: string;
  dueDate: string;
  completed: boolean;
  createdAt: string;
}

export interface BrokerageOsActivity {
  id: string;
  clientId: string;
  dealId?: string;
  category: "workflow" | "document" | "analysis" | "survey" | "lease" | "obligation" | "task" | "ai" | "export" | "share";
  label: string;
  description: string;
  actor: BrokerageOsActor;
  createdAt: string;
}

export interface BrokerageOsChangeEvent {
  id: string;
  clientId: string;
  entityType: string;
  entityId: string;
  field: string;
  before: string;
  after: string;
  actor: BrokerageOsActor;
  createdAt: string;
}

export interface BrokerageOsAuditEvent {
  id: string;
  clientId: string;
  action: string;
  actor: BrokerageOsActor;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface BrokerageOsExport {
  id: string;
  clientId: string;
  dealId?: string;
  module: "financial-analyses" | "sublease-recovery" | "completed-leases" | "surveys" | "obligations" | "deals";
  format: "pdf" | "excel";
  label: string;
  createdAt: string;
}

export interface BrokerageOsShareLink {
  id: string;
  clientId: string;
  dealId?: string;
  module: "financial-analyses" | "sublease-recovery" | "completed-leases" | "surveys" | "obligations" | "deals";
  label: string;
  url: string;
  createdAt: string;
}

export interface BrokerageOsDocument extends ClientWorkspaceDocument {
  propertyId?: string;
  spaceId?: string;
  leaseId?: string;
  obligationId?: string;
  classification?: string;
  parsedData?: Record<string, unknown>;
  extractedEntities?: Record<string, unknown>;
  linkedEntityIds?: string[];
}

export interface BrokerageOsEntityGraph {
  clients: ClientWorkspaceClient[];
  deals: ClientWorkspaceDeal[];
  documents: BrokerageOsDocument[];
  companies: BrokerageOsCompany[];
  contacts: BrokerageOsContact[];
  requirements: BrokerageOsRequirement[];
  properties: BrokerageOsProperty[];
  spaces: BrokerageOsSpace[];
  surveys: BrokerageOsSurvey[];
  surveyEntries: BrokerageOsSurveyEntry[];
  proposals: BrokerageOsProposal[];
  financialAnalyses: BrokerageOsFinancialAnalysis[];
  subleaseRecoveries: BrokerageOsSubleaseRecovery[];
  leases: BrokerageOsLease[];
  amendments: BrokerageOsAmendment[];
  leaseAbstracts: BrokerageOsLeaseAbstract[];
  obligations: BrokerageOsObligation[];
  tasks: BrokerageOsTask[];
  crmCompanies: CrmCompany[];
  crmBuildings: CrmBuilding[];
  occupancyRecords: CrmOccupancyRecord[];
  prospectingRecords: CrmProspectingRecord[];
  clientRelationshipRecords: CrmClientRelationshipRecord[];
  crmTasks: CrmTask[];
  crmTemplates: CrmTemplate[];
  crmReminders: CrmReminder[];
  crmTouchpoints: CrmTouchpoint[];
}

export interface BrokerageOsArtifactsState {
  activityLog: BrokerageOsActivity[];
  changeLog: BrokerageOsChangeEvent[];
  auditTrail: BrokerageOsAuditEvent[];
  exports: BrokerageOsExport[];
  shareLinks: BrokerageOsShareLink[];
}

export type BrokerageOsToolName =
  | "createDeal"
  | "updateDealStage"
  | "createSurvey"
  | "addSurveyEntriesFromDocuments"
  | "createFinancialAnalysis"
  | "createSubleaseRecovery"
  | "compareProposals"
  | "createLeaseAbstract"
  | "updateObligationFromLease"
  | "summarizeAmendmentChanges"
  | "classifyDocument"
  | "extractTermsFromDocument"
  | "linkDocumentToEntities"
  | "createTask"
  | "generateClientSummary"
  | "exportPdf"
  | "exportExcel"
  | "createShareLink";

export interface BrokerageOsToolCall {
  tool: BrokerageOsToolName;
  input: Record<string, unknown>;
}

export interface BrokerageOsToolResult {
  tool: BrokerageOsToolName;
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export interface BrokerageOsAiExecutionResult {
  command: string;
  resolvedIntent: string;
  toolCalls: BrokerageOsToolCall[];
  results: BrokerageOsToolResult[];
}

export const BROKERAGE_OS_DOCUMENT_TYPES: readonly ClientDocumentType[] = [
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
