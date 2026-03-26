import type { ClientWorkspaceDeal, ClientWorkspaceDocument } from "@/lib/workspace/types";
import { LANDLORD_REP_MODE, type RepresentationMode } from "@/lib/workspace/representation-mode";
import { austinOfficeBuildings } from "@/lib/data/austinOfficeBuildings";
import { getWorkspaceBuildingDeletionKey, normalizeDeletionIds } from "@/lib/workspace/deletions";
import { getRepresentationModeProfile } from "@/lib/workspace/representation-profile";

export const CRM_OS_STORAGE_KEY = "crm_operating_layer_v1";

export type CrmCompanyType =
  | "prospect"
  | "active_client"
  | "former_client"
  | "landlord"
  | "tenant"
  | "ownership_group"
  | "other";

export interface CrmCompany {
  id: string;
  clientId: string;
  name: string;
  type: CrmCompanyType;
  industry: string;
  market: string;
  submarket: string;
  buildingId: string;
  floor: string;
  suite: string;
  squareFootage: number;
  currentLeaseExpiration: string;
  noticeDeadline: string;
  renewalProbability: number;
  prospectStatus: string;
  relationshipOwner: string;
  source: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  linkedDocumentIds: string[];
  linkedDealIds: string[];
  linkedObligationIds: string[];
  linkedSurveyIds: string[];
  linkedAnalysisIds: string[];
  linkedLeaseAbstractIds: string[];
  lastTouchDate: string;
  nextFollowUpDate: string;
  landlordName: string;
  brokerRelationship: string;
}

export interface CrmBuilding {
  id: string;
  clientId: string;
  name: string;
  address: string;
  city?: string;
  state?: string;
  market: string;
  submarket: string;
  ownerName: string;
  propertyType: string;
  totalRSF: number;
  notes: string;
  buildingClass?: string;
  buildingStatus?: string;
  yearBuilt?: number | null;
  yearRenovated?: number | null;
  numberOfStories?: number | null;
  coreFactor?: number | null;
  typicalFloorSize?: number | null;
  parkingRatio?: number | null;
  operatingExpenses?: string;
  amenities?: string;
  propertyId?: string;
  ownerPhone?: string;
  propertyManagerName?: string;
  propertyManagerPhone?: string;
  leasingCompanyName?: string;
  leasingCompanyContact?: string;
  leasingCompanyPhone?: string;
  latitude?: number | null;
  longitude?: number | null;
  source?: string;
  photoOverrideUrl?: string;
  photoOverrideSourceLabel?: string;
  photoOverrideSourceUrl?: string;
  photoOverrideUpdatedAt?: string;
}

export interface CrmOccupancyRecord {
  id: string;
  clientId: string;
  companyId: string;
  buildingId: string;
  floor: string;
  suite: string;
  rsf: number;
  leaseStart: string;
  leaseExpiration: string;
  noticeDeadline: string;
  rentType: string;
  baseRent: number;
  opex: number;
  abatementMonths?: number;
  tiAllowance?: number;
  concessions?: string;
  landlordName: string;
  isCurrent: boolean;
  sourceDocumentIds: string[];
}

export type CrmStackingPlanSource =
  | "space_seed"
  | "manual"
  | "current_lease"
  | "current_sublease"
  | "occupancy_attachment";

export interface CrmStackingPlanEntry {
  id: string;
  clientId: string;
  buildingId: string;
  floor: string;
  suite: string;
  rsf: number;
  companyId: string;
  tenantName: string;
  leaseStart: string;
  leaseExpiration: string;
  noticeDeadline: string;
  rentType: string;
  baseRent: number;
  opex: number;
  abatementMonths: number;
  tiAllowance: number;
  concessions: string;
  landlordName: string;
  source: CrmStackingPlanSource;
  sourceDocumentIds: string[];
  updatedAt: string;
  createdAt: string;
}

export interface CrmShortlist {
  id: string;
  clientId: string;
  dealId?: string;
  buildingId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type CrmShortlistEntryStatus =
  | "candidate"
  | "shortlisted"
  | "touring"
  | "eliminated"
  | "proposal_requested";

export interface CrmShortlistEntry {
  id: string;
  clientId: string;
  shortlistId: string;
  dealId?: string;
  buildingId: string;
  floor: string;
  suite: string;
  rsf: number;
  companyId?: string;
  source: CrmStackingPlanSource | "shortlist_manual";
  status: CrmShortlistEntryStatus;
  owner: string;
  rank: number;
  notes: string;
  linkedSurveyEntryId?: string;
  createdAt: string;
  updatedAt: string;
}

export type CrmTourStatus = "draft" | "scheduled" | "completed" | "cancelled";
export type CrmWorkflowBoardDateFilter = "all" | "next_7" | "next_14" | "next_30" | "past" | "undated";

export interface CrmTour {
  id: string;
  clientId: string;
  dealId?: string;
  shortlistEntryId?: string;
  buildingId: string;
  floor: string;
  suite: string;
  scheduledAt: string;
  status: CrmTourStatus;
  broker: string;
  assignee: string;
  attendees: string[];
  notes: string;
  followUpActions: string;
  createdAt: string;
  updatedAt: string;
}

export type CrmWorkflowBoardViewScope = "deal" | "team";

export interface CrmWorkflowBoardView {
  id: string;
  clientId: string;
  dealId?: string;
  scope: CrmWorkflowBoardViewScope;
  createdBy: string;
  team: string;
  name: string;
  buildingId: string;
  broker: string;
  dateFilter: CrmWorkflowBoardDateFilter;
  createdAt: string;
  updatedAt: string;
}

export interface CrmProspectingRecord {
  id: string;
  clientId: string;
  companyId: string;
  market: string;
  submarket: string;
  buildingId: string;
  floor: string;
  suite: string;
  prospectStage: string;
  temperature: string;
  leadSource: string;
  lastContactDate: string;
  nextFollowUpDate: string;
  expirationDate: string;
  notes: string;
  assignedBroker: string;
}

export interface CrmClientRelationshipRecord {
  id: string;
  clientId: string;
  companyId: string;
  relationshipStage: string;
  activeDealsCount: number;
  activeLocationsCount: number;
  totalRSF: number;
  nextCriticalDate: string;
  renewalRisk: string;
  churnRisk: string;
  expansionPotential: string;
  notes: string;
}

export interface CrmTask {
  id: string;
  clientId: string;
  companyId?: string;
  dealId?: string;
  obligationId?: string;
  type: string;
  title: string;
  dueDate: string;
  status: string;
  priority: string;
  owner: string;
  templateId?: string;
  aiSuggested: boolean;
}

export interface CrmTemplate {
  id: string;
  name: string;
  representationMode: RepresentationMode | "all";
  templateType: string;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: string[];
  aiAssistEnabled: boolean;
}

export interface CrmReminder {
  id: string;
  clientId: string;
  companyId?: string;
  obligationId?: string;
  dealId?: string;
  reminderType: string;
  triggerDate: string;
  triggerLogic: string;
  status: string;
  severity: "info" | "warn" | "critical";
  message: string;
}

export interface CrmTouchpoint {
  id: string;
  clientId: string;
  companyId: string;
  category: string;
  summary: string;
  createdAt: string;
}

export interface CrmReminderConfig {
  expirationMonths: number[];
  noticeDaysBefore: number[];
  overdueFollowUpDays: number[];
  staleListingDays: number;
  staleProposalDays: number;
}

export interface CrmWorkspaceState {
  companies: CrmCompany[];
  buildings: CrmBuilding[];
  deletedBuildingKeys: string[];
  occupancyRecords: CrmOccupancyRecord[];
  stackingPlanEntries: CrmStackingPlanEntry[];
  shortlists: CrmShortlist[];
  shortlistEntries: CrmShortlistEntry[];
  tours: CrmTour[];
  workflowBoardViews: CrmWorkflowBoardView[];
  prospectingRecords: CrmProspectingRecord[];
  clientRelationshipRecords: CrmClientRelationshipRecord[];
  tasks: CrmTask[];
  templates: CrmTemplate[];
  reminders: CrmReminder[];
  touchpoints: CrmTouchpoint[];
  reminderConfig: CrmReminderConfig;
}

export interface CrmFilters {
  query: string;
  market: string;
  submarket: string;
  buildingId: string;
  floor: string;
  suite: string;
  companyType: string;
  prospectStage: string;
  expirationBucket: string;
  followUpState: string;
}

export interface CrmTimelinePoint {
  label: string;
  count: number;
}

export interface CrmHeatmapCell {
  year: number;
  month: number;
  label: string;
  count: number;
}

export interface CrmLocationLeaf {
  suite: string;
  floor: string;
  companyId: string;
  companyName: string;
  companyType: CrmCompanyType;
  expirationDate: string;
  rsf: number;
}

export interface CrmLocationFloorGroup {
  floor: string;
  suites: CrmLocationLeaf[];
}

export interface CrmLocationBuildingGroup {
  buildingId: string;
  buildingName: string;
  market: string;
  submarket: string;
  floors: CrmLocationFloorGroup[];
}

export interface CrmLocationSubmarketGroup {
  submarket: string;
  buildings: CrmLocationBuildingGroup[];
}

export interface CrmLocationMarketGroup {
  market: string;
  submarkets: CrmLocationSubmarketGroup[];
}

export interface CrmDashboardModel {
  totalProspects: number;
  totalActiveClients: number;
  totalLandlordTenants: number;
  upcomingExpirations: number;
  upcomingNoticeDates: number;
  activeDeals: number;
  highPriorityTasks: number;
  dueReminders: number;
  overdueFollowUps: number;
  noTouchCompanies: number;
  expirationTimeline: CrmTimelinePoint[];
  expirationHeatmap: CrmHeatmapCell[];
  relationshipQueue: CrmCompany[];
  locationHierarchy: CrmLocationMarketGroup[];
  concentrationByMarket: Array<{ label: string; rsf: number; count: number }>;
  concentrationByBuilding: Array<{ label: string; rsf: number; count: number }>;
}

export interface CrmBuildInput {
  clientId: string;
  clientName: string;
  representationMode: RepresentationMode | null | undefined;
  sharedBuildings?: CrmBuilding[];
  documents: ClientWorkspaceDocument[];
  deals: ClientWorkspaceDeal[];
  properties: Array<{ id: string; name: string; address: string; market: string; submarket: string }>;
  spaces: Array<{ id: string; propertyId: string; floor: string; suite: string; rsf: number }>;
  obligations: Array<{ id: string; title: string; rsf: number; annualRentObligation: number; totalObligation: number; renewalDate: string; noticeDate: string; expirationDate: string; terminationRightDate: string; sourceDocumentIds: string[] }>;
  surveys: Array<{ id: string; name: string; sourceDocumentIds: string[] }>;
  surveyEntries: Array<{ id: string; building: string; address: string; floor: string; suite: string; rsf: number; sourceDocumentId?: string }>;
  financialAnalyses: Array<{ id: string; dealId?: string; sourceDocumentId?: string; name: string; createdAt: string; status: string }>;
  leaseAbstracts: Array<{ id: string; name: string; documentId?: string; createdAt: string }>;
  existingState?: Partial<CrmWorkspaceState> | null;
}

function asText(value: unknown): string {
  return String(value || "").trim();
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value: unknown): string {
  return asText(value).toLowerCase();
}

function normalizeBuildingName(value: unknown): string {
  const name = asText(value);
  if (!name) return "";
  if (normalize(name) === "unknown building") return "";
  return name;
}

function hasUsableCoordinates(building: CrmBuilding): boolean {
  return Number.isFinite(building.latitude) && Number.isFinite(building.longitude);
}

function slugify(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseDate(value: string): Date | null {
  const raw = asText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function daysBetween(from: string, to: string): number {
  const left = parseDate(from);
  const right = parseDate(to);
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const diff = right.getTime() - left.getTime();
  return Math.floor(diff / 86400000);
}

function monthsUntil(value: string, base = todayIso()): number {
  const target = parseDate(value);
  const current = parseDate(base);
  if (!target || !current) return Number.POSITIVE_INFINITY;
  const yearDiff = target.getUTCFullYear() - current.getUTCFullYear();
  const monthDiff = target.getUTCMonth() - current.getUTCMonth();
  return yearDiff * 12 + monthDiff;
}

function earliestDate(values: string[]): string {
  return values
    .map((value) => asText(value))
    .filter(Boolean)
    .sort()[0] || "";
}

function latestDate(values: string[]): string {
  const cleaned = values.map((value) => asText(value)).filter(Boolean).sort();
  return cleaned[cleaned.length - 1] || "";
}

function isCurrentDateWindow(start: string, end: string, today = todayIso()): boolean {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  const todayDate = parseDate(today);
  if (!todayDate) return false;
  if (startDate && startDate.getTime() > todayDate.getTime()) return false;
  if (endDate && endDate.getTime() < todayDate.getTime()) return false;
  return Boolean(startDate || endDate);
}

function isStackingDocumentType(documentType: string): boolean {
  return ["leases", "amendments", "abstracts", "sublease documents"].includes(documentType);
}

function stackingSourceFromDocumentType(documentType: string): CrmStackingPlanSource {
  return documentType === "sublease documents" ? "current_sublease" : "current_lease";
}

function noticeDeadlineText(value: unknown): string {
  return asText(value);
}

function mergeString(preferred: string, fallback: string): string {
  return asText(preferred) || asText(fallback);
}

function mergeStringArray(...values: Array<string[] | undefined>): string[] {
  return Array.from(new Set(values.flatMap((value) => value || []).map((item) => asText(item)).filter(Boolean)));
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeNullableNumber(preferred: unknown, fallback: unknown): number | null {
  return asNullableNumber(preferred) ?? asNullableNumber(fallback);
}

function mergeNumber(preferred: unknown, fallback: unknown): number {
  return asNullableNumber(preferred) ?? asNullableNumber(fallback) ?? 0;
}

function defaultReminderConfig(mode: RepresentationMode | null | undefined): CrmReminderConfig {
  const profile = getRepresentationModeProfile(mode);
  return { ...profile.reminders };
}

function buildDefaultTemplates(mode: RepresentationMode | null | undefined): CrmTemplate[] {
  const profile = getRepresentationModeProfile(mode);
  return profile.templates.map((template) => ({
    id: template.id,
    name: template.name,
    representationMode: mode || "all",
    templateType: template.templateType,
    subjectTemplate: template.subjectTemplate,
    bodyTemplate: template.bodyTemplate,
    variables: [...template.variables],
    aiAssistEnabled: template.aiAssistEnabled,
  }));
}

function inferCompanyType(args: {
  name: string;
  workspaceName: string;
  representationMode: RepresentationMode | null | undefined;
  documentType: string;
  hasExpiration: boolean;
}): CrmCompanyType {
  if (normalize(args.name) === normalize(args.workspaceName)) {
    return args.representationMode === LANDLORD_REP_MODE ? "landlord" : "active_client";
  }
  if (args.documentType === "proposals" || args.documentType === "lois" || args.documentType === "counters" || args.documentType === "sublease documents") {
    return "prospect";
  }
  if (args.representationMode === LANDLORD_REP_MODE) {
    return args.hasExpiration ? "tenant" : "prospect";
  }
  return args.hasExpiration ? "active_client" : "prospect";
}

function pickTouchDate(deals: ClientWorkspaceDeal[], documents: ClientWorkspaceDocument[]): string {
  const values = [
    ...deals.map((deal) => asText(deal.updatedAt)),
    ...deals.flatMap((deal) => ensureArray<{ createdAt?: string }>(deal.timeline).map((item) => asText(item.createdAt))),
    ...documents.map((doc) => asText(doc.uploadedAt)),
  ].filter(Boolean);
  return latestDate(values);
}

function pickNextFollowUpDate(lastTouchDate: string, reminderConfig: CrmReminderConfig): string {
  const base = parseDate(lastTouchDate || todayIso());
  if (!base) return "";
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + (reminderConfig.overdueFollowUpDays[0] || 30));
  return next.toISOString().slice(0, 10);
}

function buildReminderId(parts: string[]): string {
  return `crm_reminder_${slugify(parts.join("-"))}`;
}

export function emptyCrmWorkspaceState(mode: RepresentationMode | null | undefined): CrmWorkspaceState {
  return {
    companies: [],
    buildings: [],
    deletedBuildingKeys: [],
    occupancyRecords: [],
    stackingPlanEntries: [],
    shortlists: [],
    shortlistEntries: [],
    tours: [],
    workflowBoardViews: [],
    prospectingRecords: [],
    clientRelationshipRecords: [],
    tasks: [],
    templates: buildDefaultTemplates(mode),
    reminders: [],
    touchpoints: [],
    reminderConfig: defaultReminderConfig(mode),
  };
}

export function buildCrmWorkspaceState(input: CrmBuildInput): CrmWorkspaceState {
  const existing = input.existingState || {};
  const reminderConfig = {
    ...defaultReminderConfig(input.representationMode),
    ...(existing.reminderConfig || {}),
  };
  const existingCompanies = ensureArray<CrmCompany>(existing.companies);
  const existingBuildings = ensureArray<CrmBuilding>(existing.buildings);
  const existingOccupancies = ensureArray<CrmOccupancyRecord>(existing.occupancyRecords);
  const existingStackingEntries = ensureArray<CrmStackingPlanEntry>(existing.stackingPlanEntries);
  const existingTasks = ensureArray<CrmTask>(existing.tasks);
  const existingTouchpoints = ensureArray<CrmTouchpoint>(existing.touchpoints);
  const existingProspecting = ensureArray<CrmProspectingRecord>(existing.prospectingRecords);
  const existingRelationships = ensureArray<CrmClientRelationshipRecord>(existing.clientRelationshipRecords);
  const existingTemplates = ensureArray<CrmTemplate>(existing.templates);
  const existingShortlists = ensureArray<CrmShortlist>(existing.shortlists);
  const existingShortlistEntries = ensureArray<CrmShortlistEntry>(existing.shortlistEntries);
  const existingTours = ensureArray<CrmTour>(existing.tours);
  const existingWorkflowBoardViews = ensureArray<CrmWorkflowBoardView>(existing.workflowBoardViews);
  const deletedBuildingKeys = normalizeDeletionIds(existing.deletedBuildingKeys);
  const deletedBuildingKeySet = new Set(deletedBuildingKeys);
  const deletedExistingBuildingIds = new Set(
    existingBuildings
      .filter((building) => deletedBuildingKeySet.has(getWorkspaceBuildingDeletionKey(building)))
      .map((building) => building.id),
  );
  const today = todayIso();

  const companyByNormalizedName = new Map(existingCompanies.map((company) => [normalize(company.name), company]));
  const buildingById = new Map<string, CrmBuilding>();
  const occupancyRecordMap = new Map<string, CrmOccupancyRecord>();
  const stackingPlanEntryMap = new Map<string, CrmStackingPlanEntry>();
  const occupancyKey = (record: Partial<CrmOccupancyRecord>) => {
    const composite = slugify([
      asText(record.companyId),
      asText(record.buildingId),
      asText(record.floor) || "unassigned",
      asText(record.suite),
    ].join("-"));
    return composite || asText(record.id);
  };
  const upsertOccupancy = (seed: Partial<CrmOccupancyRecord> & { companyId: string; buildingId: string; suite: string }) => {
    const key = occupancyKey(seed);
    if (!key) return;
    const existingRecord = occupancyRecordMap.get(key)
      || existingOccupancies.find((record) => occupancyKey(record) === key || asText(record.id) === asText(seed.id));
    const nextRecord: CrmOccupancyRecord = {
      id: asText(seed.id) || existingRecord?.id || `occupancy_${key}`,
      clientId: input.clientId,
      companyId: mergeString(seed.companyId || "", existingRecord?.companyId || ""),
      buildingId: mergeString(seed.buildingId || "", existingRecord?.buildingId || ""),
      floor: mergeString(seed.floor || "", existingRecord?.floor || ""),
      suite: mergeString(seed.suite || "", existingRecord?.suite || ""),
      rsf: Math.max(mergeNumber(seed.rsf, existingRecord?.rsf), 0),
      leaseStart: mergeString(seed.leaseStart || "", existingRecord?.leaseStart || ""),
      leaseExpiration: mergeString(seed.leaseExpiration || "", existingRecord?.leaseExpiration || ""),
      noticeDeadline: mergeString(seed.noticeDeadline || "", existingRecord?.noticeDeadline || ""),
      rentType: mergeString(seed.rentType || "", existingRecord?.rentType || "Unknown"),
      baseRent: Math.max(mergeNumber(seed.baseRent, existingRecord?.baseRent), 0),
      opex: Math.max(mergeNumber(seed.opex, existingRecord?.opex), 0),
      abatementMonths: Math.max(mergeNumber(seed.abatementMonths, existingRecord?.abatementMonths), 0),
      tiAllowance: Math.max(mergeNumber(seed.tiAllowance, existingRecord?.tiAllowance), 0),
      concessions: mergeString(seed.concessions || "", existingRecord?.concessions || ""),
      landlordName: mergeString(seed.landlordName || "", existingRecord?.landlordName || ""),
      isCurrent: seed.isCurrent ?? existingRecord?.isCurrent ?? true,
      sourceDocumentIds: mergeStringArray(existingRecord?.sourceDocumentIds, seed.sourceDocumentIds),
    };
    occupancyRecordMap.set(key, nextRecord);
  };
  const stackingEntryKey = (entry: Partial<CrmStackingPlanEntry>) => {
    const composite = slugify([
      asText(entry.buildingId),
      asText(entry.floor) || "unassigned",
      asText(entry.suite),
    ].join("-"));
    return composite || asText(entry.id);
  };
  const upsertStackingEntry = (seed: Partial<CrmStackingPlanEntry> & { buildingId: string; suite: string }, options?: { preserveExisting?: boolean }) => {
    const key = stackingEntryKey(seed);
    if (!key) return;
    const existingEntry = stackingPlanEntryMap.get(key)
      || existingStackingEntries.find((entry) => stackingEntryKey(entry) === key || asText(entry.id) === asText(seed.id));
    if (options?.preserveExisting && existingEntry) return;
    const now = new Date().toISOString();
    const nextEntry: CrmStackingPlanEntry = {
      id: asText(seed.id) || existingEntry?.id || `crm_stack_${key}`,
      clientId: input.clientId,
      buildingId: mergeString(seed.buildingId || "", existingEntry?.buildingId || ""),
      floor: mergeString(seed.floor || "", existingEntry?.floor || ""),
      suite: mergeString(seed.suite || "", existingEntry?.suite || ""),
      rsf: Math.max(mergeNumber(seed.rsf, existingEntry?.rsf), 0),
      companyId: mergeString(seed.companyId || "", existingEntry?.companyId || ""),
      tenantName: mergeString(seed.tenantName || "", existingEntry?.tenantName || ""),
      leaseStart: mergeString(seed.leaseStart || "", existingEntry?.leaseStart || ""),
      leaseExpiration: mergeString(seed.leaseExpiration || "", existingEntry?.leaseExpiration || ""),
      noticeDeadline: mergeString(seed.noticeDeadline || "", existingEntry?.noticeDeadline || ""),
      rentType: mergeString(seed.rentType || "", existingEntry?.rentType || ""),
      baseRent: Math.max(mergeNumber(seed.baseRent, existingEntry?.baseRent), 0),
      opex: Math.max(mergeNumber(seed.opex, existingEntry?.opex), 0),
      abatementMonths: Math.max(mergeNumber(seed.abatementMonths, existingEntry?.abatementMonths), 0),
      tiAllowance: Math.max(mergeNumber(seed.tiAllowance, existingEntry?.tiAllowance), 0),
      concessions: mergeString(seed.concessions || "", existingEntry?.concessions || ""),
      landlordName: mergeString(seed.landlordName || "", existingEntry?.landlordName || ""),
      source: (seed.source || existingEntry?.source || "manual") as CrmStackingPlanSource,
      sourceDocumentIds: mergeStringArray(existingEntry?.sourceDocumentIds, seed.sourceDocumentIds),
      createdAt: asText(seed.createdAt) || existingEntry?.createdAt || now,
      updatedAt: now,
    };
    stackingPlanEntryMap.set(key, nextEntry);
  };
  const upsertBuilding = (seed: Partial<CrmBuilding> & { id: string }) => {
    const existingBuilding = buildingById.get(seed.id) || existingBuildings.find((building) => building.id === seed.id);
    const deletionKey = getWorkspaceBuildingDeletionKey({
      id: asText(seed.id) || asText(existingBuilding?.id),
      name: seed.name || existingBuilding?.name,
      address: seed.address || existingBuilding?.address,
    });
    if (deletionKey && deletedBuildingKeySet.has(deletionKey)) return;
    const nextBuilding: CrmBuilding = {
      id: seed.id,
      clientId: input.clientId,
      name: mergeString(seed.name || "", existingBuilding?.name || ""),
      address: mergeString(seed.address || "", existingBuilding?.address || ""),
      city: mergeString(seed.city || "", existingBuilding?.city || ""),
      state: mergeString(seed.state || "", existingBuilding?.state || ""),
      market: mergeString(seed.market || "", existingBuilding?.market || ""),
      submarket: mergeString(seed.submarket || "", existingBuilding?.submarket || ""),
      ownerName: mergeString(seed.ownerName || "", existingBuilding?.ownerName || ""),
      propertyType: mergeString(seed.propertyType || "", existingBuilding?.propertyType || ""),
      totalRSF: Math.max(mergeNumber(seed.totalRSF, existingBuilding?.totalRSF), 0),
      notes: mergeString(seed.notes || "", existingBuilding?.notes || ""),
      buildingClass: mergeString(seed.buildingClass || "", existingBuilding?.buildingClass || ""),
      buildingStatus: mergeString(seed.buildingStatus || "", existingBuilding?.buildingStatus || ""),
      yearBuilt: mergeNullableNumber(seed.yearBuilt, existingBuilding?.yearBuilt),
      yearRenovated: mergeNullableNumber(seed.yearRenovated, existingBuilding?.yearRenovated),
      numberOfStories: mergeNullableNumber(seed.numberOfStories, existingBuilding?.numberOfStories),
      coreFactor: mergeNullableNumber(seed.coreFactor, existingBuilding?.coreFactor),
      typicalFloorSize: mergeNullableNumber(seed.typicalFloorSize, existingBuilding?.typicalFloorSize),
      parkingRatio: mergeNullableNumber(seed.parkingRatio, existingBuilding?.parkingRatio),
      operatingExpenses: mergeString(seed.operatingExpenses || "", existingBuilding?.operatingExpenses || ""),
      amenities: mergeString(seed.amenities || "", existingBuilding?.amenities || ""),
      propertyId: mergeString(seed.propertyId || "", existingBuilding?.propertyId || ""),
      ownerPhone: mergeString(seed.ownerPhone || "", existingBuilding?.ownerPhone || ""),
      propertyManagerName: mergeString(seed.propertyManagerName || "", existingBuilding?.propertyManagerName || ""),
      propertyManagerPhone: mergeString(seed.propertyManagerPhone || "", existingBuilding?.propertyManagerPhone || ""),
      leasingCompanyName: mergeString(seed.leasingCompanyName || "", existingBuilding?.leasingCompanyName || ""),
      leasingCompanyContact: mergeString(seed.leasingCompanyContact || "", existingBuilding?.leasingCompanyContact || ""),
      leasingCompanyPhone: mergeString(seed.leasingCompanyPhone || "", existingBuilding?.leasingCompanyPhone || ""),
      latitude: mergeNullableNumber(seed.latitude, existingBuilding?.latitude),
      longitude: mergeNullableNumber(seed.longitude, existingBuilding?.longitude),
      source: mergeString(seed.source || "", existingBuilding?.source || "workspace"),
      photoOverrideUrl: mergeString(seed.photoOverrideUrl || "", existingBuilding?.photoOverrideUrl || ""),
      photoOverrideSourceLabel: mergeString(seed.photoOverrideSourceLabel || "", existingBuilding?.photoOverrideSourceLabel || ""),
      photoOverrideSourceUrl: mergeString(seed.photoOverrideSourceUrl || "", existingBuilding?.photoOverrideSourceUrl || ""),
      photoOverrideUpdatedAt: mergeString(seed.photoOverrideUpdatedAt || "", existingBuilding?.photoOverrideUpdatedAt || ""),
    };
    buildingById.set(nextBuilding.id, nextBuilding);
  };

  const sharedBuildings = Array.isArray(input.sharedBuildings) && input.sharedBuildings.length > 0
    ? input.sharedBuildings
    : austinOfficeBuildings;

  for (const building of sharedBuildings) {
    upsertBuilding({
      ...building,
      clientId: input.clientId,
    });
  }

  for (const property of input.properties) {
    upsertBuilding({
      id: property.id,
      clientId: input.clientId,
      name: property.name,
      address: property.address,
      market: property.market,
      submarket: property.submarket,
      source: "workspace_property",
    });
  }

  for (const existingBuilding of existingBuildings) {
    upsertBuilding(existingBuilding);
  }

  const buildings = Array.from(buildingById.values()).sort((left, right) =>
    `${left.submarket} ${left.name}`.localeCompare(`${right.submarket} ${right.name}`),
  );
  const buildingIds = new Set(buildings.map((building) => building.id));

  const workspaceCompanyName = asText(input.clientName) || "Workspace Client";
  const workspaceExisting = companyByNormalizedName.get(normalize(workspaceCompanyName));
  const workspaceCompany: CrmCompany = {
    id: workspaceExisting?.id || `crm_company_${slugify(`${input.clientId}-${workspaceCompanyName}`) || input.clientId}`,
    clientId: input.clientId,
    name: workspaceCompanyName,
    type: input.representationMode === LANDLORD_REP_MODE ? "landlord" : "active_client",
    industry: asText(workspaceExisting?.industry),
    market: asText(workspaceExisting?.market),
    submarket: asText(workspaceExisting?.submarket),
    buildingId: asText(workspaceExisting?.buildingId),
    floor: asText(workspaceExisting?.floor),
    suite: asText(workspaceExisting?.suite),
    squareFootage: asNumber(workspaceExisting?.squareFootage),
    currentLeaseExpiration: asText(workspaceExisting?.currentLeaseExpiration),
    noticeDeadline: asText(workspaceExisting?.noticeDeadline),
    renewalProbability: asNumber(workspaceExisting?.renewalProbability),
    prospectStatus: asText(workspaceExisting?.prospectStatus) || "Active relationship",
    relationshipOwner: asText(workspaceExisting?.relationshipOwner) || "Broker Team",
    source: asText(workspaceExisting?.source) || "workspace",
    notes: asText(workspaceExisting?.notes),
    createdAt: asText(workspaceExisting?.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    linkedDocumentIds: mergeStringArray(workspaceExisting?.linkedDocumentIds),
    linkedDealIds: mergeStringArray(workspaceExisting?.linkedDealIds),
    linkedObligationIds: mergeStringArray(workspaceExisting?.linkedObligationIds),
    linkedSurveyIds: mergeStringArray(workspaceExisting?.linkedSurveyIds),
    linkedAnalysisIds: mergeStringArray(workspaceExisting?.linkedAnalysisIds),
    linkedLeaseAbstractIds: mergeStringArray(workspaceExisting?.linkedLeaseAbstractIds),
    lastTouchDate: asText(workspaceExisting?.lastTouchDate),
    nextFollowUpDate: asText(workspaceExisting?.nextFollowUpDate),
    landlordName: asText(workspaceExisting?.landlordName),
    brokerRelationship: asText(workspaceExisting?.brokerRelationship),
  };

  const companyMap = new Map<string, CrmCompany>([[workspaceCompany.id, workspaceCompany]]);
  companyByNormalizedName.set(normalize(workspaceCompany.name), workspaceCompany);

  const documentsById = new Map(input.documents.map((doc) => [doc.id, doc]));
  const propertyByNormalized = new Map<string, CrmBuilding>();
  for (const building of buildings) {
    const nameKey = normalize(building.name);
    const addressKey = normalize(building.address);
    const compositeKey = `${nameKey}::${addressKey}`;
    if (nameKey || addressKey) propertyByNormalized.set(compositeKey, building);
    if (nameKey) propertyByNormalized.set(`${nameKey}::`, building);
    if (addressKey) propertyByNormalized.set(`::${addressKey}`, building);
  }

  const companyToDocuments = new Map<string, string[]>();
  const companyToDeals = new Map<string, string[]>();
  const companyToObligations = new Map<string, string[]>();
  const companyToSurveys = new Map<string, string[]>();
  const companyToAnalyses = new Map<string, string[]>();
  const companyToAbstracts = new Map<string, string[]>();

  const ensureCompany = (seed: Partial<CrmCompany> & { name: string }): CrmCompany => {
    const normalizedName = normalize(seed.name);
    const existingCompany = companyByNormalizedName.get(normalizedName);
    if (existingCompany) {
      const merged: CrmCompany = {
        ...existingCompany,
        type: (seed.type as CrmCompanyType) || existingCompany.type,
        industry: mergeString(seed.industry || "", existingCompany.industry),
        market: mergeString(seed.market || "", existingCompany.market),
        submarket: mergeString(seed.submarket || "", existingCompany.submarket),
        buildingId: mergeString(seed.buildingId || "", existingCompany.buildingId),
        floor: mergeString(seed.floor || "", existingCompany.floor),
        suite: mergeString(seed.suite || "", existingCompany.suite),
        squareFootage: Math.max(asNumber(seed.squareFootage), asNumber(existingCompany.squareFootage)),
        currentLeaseExpiration: earliestDate([existingCompany.currentLeaseExpiration, asText(seed.currentLeaseExpiration)]),
        noticeDeadline: earliestDate([existingCompany.noticeDeadline, asText(seed.noticeDeadline)]),
        renewalProbability: Math.max(asNumber(seed.renewalProbability), asNumber(existingCompany.renewalProbability)),
        prospectStatus: mergeString(seed.prospectStatus || "", existingCompany.prospectStatus),
        relationshipOwner: mergeString(seed.relationshipOwner || "", existingCompany.relationshipOwner),
        source: mergeString(seed.source || "", existingCompany.source),
        notes: mergeString(existingCompany.notes, asText(seed.notes)),
        updatedAt: new Date().toISOString(),
        landlordName: mergeString(seed.landlordName || "", existingCompany.landlordName),
        brokerRelationship: mergeString(seed.brokerRelationship || "", existingCompany.brokerRelationship),
      };
      companyMap.set(merged.id, merged);
      companyByNormalizedName.set(normalizedName, merged);
      return merged;
    }
    const created: CrmCompany = {
      id: asText(seed.id) || `crm_company_${slugify(`${input.clientId}-${seed.name}`) || Date.now().toString(36)}`,
      clientId: input.clientId,
      name: asText(seed.name),
      type: (seed.type as CrmCompanyType) || "prospect",
      industry: asText(seed.industry),
      market: asText(seed.market),
      submarket: asText(seed.submarket),
      buildingId: asText(seed.buildingId),
      floor: asText(seed.floor),
      suite: asText(seed.suite),
      squareFootage: asNumber(seed.squareFootage),
      currentLeaseExpiration: asText(seed.currentLeaseExpiration),
      noticeDeadline: asText(seed.noticeDeadline),
      renewalProbability: asNumber(seed.renewalProbability),
      prospectStatus: asText(seed.prospectStatus),
      relationshipOwner: asText(seed.relationshipOwner) || "Broker Team",
      source: asText(seed.source) || "manual",
      notes: asText(seed.notes),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      linkedDocumentIds: [],
      linkedDealIds: [],
      linkedObligationIds: [],
      linkedSurveyIds: [],
      linkedAnalysisIds: [],
      linkedLeaseAbstractIds: [],
      lastTouchDate: "",
      nextFollowUpDate: "",
      landlordName: asText(seed.landlordName),
      brokerRelationship: asText(seed.brokerRelationship),
    };
    companyMap.set(created.id, created);
    companyByNormalizedName.set(normalizedName, created);
    return created;
  };

  for (const document of input.documents) {
    const canonical = document.normalizeSnapshot?.canonical_lease;
    const companyName = asText(document.companyId)
      ? (companyMap.get(asText(document.companyId))?.name || asText(canonical?.tenant_name) || asText(workspaceCompany.name))
      : (asText(canonical?.tenant_name) || asText(workspaceCompany.name));
    const buildingName = asText(document.building) || asText(canonical?.building_name || canonical?.premises_name);
    const address = asText(document.address) || asText(canonical?.address);
    const property = propertyByNormalized.get(`${normalize(buildingName)}::${normalize(address)}`)
      || propertyByNormalized.get(`${normalize(buildingName)}::`)
      || propertyByNormalized.get(`::${normalize(address)}`);
    const company = ensureCompany({
      id: asText(document.companyId),
      name: companyName,
      type: inferCompanyType({
        name: companyName,
        workspaceName: workspaceCompany.name,
        representationMode: input.representationMode,
        documentType: document.type,
        hasExpiration: Boolean(asText(canonical?.expiration_date)),
      }),
      market: property?.market,
      submarket: property?.submarket,
      buildingId: property?.id,
      floor: asText(canonical?.floor),
      suite: asText(document.suite) || asText(canonical?.suite),
      squareFootage: asNumber(canonical?.rsf),
      currentLeaseExpiration: asText(canonical?.expiration_date),
      noticeDeadline: noticeDeadlineText(canonical?.notice_dates),
      source: document.type,
      landlordName: asText(canonical?.landlord_name),
      brokerRelationship: asText(canonical?.tenant_name) === workspaceCompany.name ? "existing" : "watchlist",
    });
    companyToDocuments.set(company.id, mergeStringArray(companyToDocuments.get(company.id), [document.id]));
  }

  for (const deal of input.deals) {
    const companyName = asText(deal.companyId)
      ? (companyMap.get(asText(deal.companyId))?.name || workspaceCompany.name)
      : workspaceCompany.name;
    const company = ensureCompany({
      id: asText(deal.companyId),
      name: companyName,
      type: normalize(companyName) === normalize(workspaceCompany.name) ? workspaceCompany.type : "prospect",
      market: deal.targetMarket,
      submarket: deal.submarket,
      floor: "",
      suite: deal.selectedSuite,
      source: "deal",
      prospectStatus: deal.stage,
      relationshipOwner: deal.tenantRepBroker || "Broker Team",
    });
    companyToDeals.set(company.id, mergeStringArray(companyToDeals.get(company.id), [deal.id]));
  }

  for (const document of input.documents) {
    const canonical = document.normalizeSnapshot?.canonical_lease;
    if (!canonical) continue;
    const buildingName = asText(document.building) || asText(canonical.building_name || canonical.premises_name);
    const address = asText(document.address) || asText(canonical.address);
    const property = propertyByNormalized.get(`${normalize(buildingName)}::${normalize(address)}`)
      || propertyByNormalized.get(`${normalize(buildingName)}::`)
      || propertyByNormalized.get(`::${normalize(address)}`);
    const companyName = asText(canonical.tenant_name) || workspaceCompany.name;
    const company = ensureCompany({
      id: asText(document.companyId),
      name: companyName,
      type: inferCompanyType({
        name: companyName,
        workspaceName: workspaceCompany.name,
        representationMode: input.representationMode,
        documentType: document.type,
        hasExpiration: Boolean(asText(canonical.expiration_date)),
      }),
      market: property?.market,
      submarket: property?.submarket,
      buildingId: property?.id,
      floor: asText(canonical.floor),
      suite: asText(canonical.suite),
      squareFootage: asNumber(canonical.rsf),
      currentLeaseExpiration: asText(canonical.expiration_date),
      noticeDeadline: noticeDeadlineText(canonical.notice_dates),
      landlordName: asText(canonical.landlord_name),
      source: document.type,
    });
    if (!property) continue;
    if (!isStackingDocumentType(document.type)) continue;
    const leaseStart = asText(canonical.commencement_date);
    const leaseExpiration = asText(canonical.expiration_date);
    if (!isCurrentDateWindow(leaseStart, leaseExpiration, today)) continue;
    const rentStep = ensureArray<{ rent_psf_annual?: number }>(canonical.rent_schedule)[0];
    upsertOccupancy({
      id: `occupancy_${slugify(`${company.id}-${property.id}-${canonical.floor || ""}-${canonical.suite || document.suite || ""}-${document.id}`)}`,
      clientId: input.clientId,
      companyId: company.id,
      buildingId: property.id,
      floor: asText(canonical.floor),
      suite: asText(canonical.suite) || document.suite,
      rsf: asNumber(canonical.rsf),
      leaseStart: asText(canonical.commencement_date),
      leaseExpiration: asText(canonical.expiration_date),
      noticeDeadline: noticeDeadlineText(canonical.notice_dates),
      rentType: asText(canonical.lease_type) || "Unknown",
      baseRent: asNumber(rentStep?.rent_psf_annual),
      opex: asNumber(canonical.opex_psf_year_1),
      abatementMonths: asNumber(canonical.free_rent_months),
      tiAllowance: asNumber(canonical.ti_allowance_psf),
      concessions: "",
      landlordName: asText(canonical.landlord_name),
      isCurrent: true,
      sourceDocumentIds: [document.id],
    });
    const suite = asText(canonical.suite) || document.suite;
    if (suite) {
      upsertStackingEntry({
        id: `stack_${slugify(`${property.id}-${canonical.floor || ""}-${suite}-${document.id}`)}`,
        clientId: input.clientId,
        buildingId: property.id,
        floor: asText(canonical.floor),
        suite,
        rsf: asNumber(canonical.rsf),
        companyId: company.id,
        tenantName: company.name,
        leaseStart,
        leaseExpiration,
        noticeDeadline: noticeDeadlineText(canonical.notice_dates),
        rentType: asText(canonical.lease_type) || "Unknown",
        baseRent: asNumber(rentStep?.rent_psf_annual),
        opex: asNumber(canonical.opex_psf_year_1),
        abatementMonths: asNumber(canonical.free_rent_months),
        tiAllowance: asNumber(canonical.ti_allowance_psf),
        concessions: "",
        landlordName: asText(canonical.landlord_name),
        source: stackingSourceFromDocumentType(document.type),
        sourceDocumentIds: [document.id],
      });
    }
  }

  for (const record of existingOccupancies) {
    if (!asText(record.companyId) || !asText(record.buildingId) || !asText(record.suite)) continue;
    upsertOccupancy(record);
    const company = companyMap.get(record.companyId);
    upsertStackingEntry({
      id: `stack_occ_${slugify(`${record.buildingId}-${record.floor}-${record.suite}-${record.companyId}`)}`,
      clientId: input.clientId,
      buildingId: record.buildingId,
      floor: record.floor,
      suite: record.suite,
      rsf: record.rsf,
      companyId: record.companyId,
      tenantName: company?.name || "",
      leaseStart: record.leaseStart,
      leaseExpiration: record.leaseExpiration,
      noticeDeadline: record.noticeDeadline,
      rentType: record.rentType,
      baseRent: record.baseRent,
      opex: record.opex,
      abatementMonths: record.abatementMonths || 0,
      tiAllowance: record.tiAllowance || 0,
      concessions: record.concessions || "",
      landlordName: record.landlordName,
      source: "occupancy_attachment",
      sourceDocumentIds: record.sourceDocumentIds,
    });
  }
  const occupancyRecords = Array.from(occupancyRecordMap.values())
    .filter((record) => !deletedExistingBuildingIds.has(record.buildingId));

  for (const space of input.spaces) {
    const buildingId = space.propertyId;
    if (!buildings.some((building) => building.id === buildingId || building.propertyId === buildingId)) continue;
    const resolvedBuildingId = buildings.find((building) => building.id === buildingId || building.propertyId === buildingId)?.id || buildingId;
    upsertStackingEntry({
      id: `stack_space_${slugify(`${resolvedBuildingId}-${space.floor}-${space.suite}`)}`,
      clientId: input.clientId,
      buildingId: resolvedBuildingId,
      floor: space.floor,
      suite: space.suite,
      rsf: space.rsf,
      source: "space_seed",
    }, { preserveExisting: true });
  }

  for (const existingEntry of existingStackingEntries.filter((entry) => entry.source === "manual")) {
    if (!asText(existingEntry.buildingId) || !asText(existingEntry.suite)) continue;
    upsertStackingEntry(existingEntry);
  }
  const stackingPlanEntries = Array.from(stackingPlanEntryMap.values()).sort((left, right) =>
    `${left.buildingId}-${left.floor}-${left.suite}`.localeCompare(`${right.buildingId}-${right.floor}-${right.suite}`),
  ).filter((entry) => !deletedExistingBuildingIds.has(entry.buildingId));

  for (const obligation of input.obligations) {
    const sourceDocs = obligation.sourceDocumentIds || [];
    const firstDoc = sourceDocs.map((id) => documentsById.get(id)).find(Boolean);
    const canonical = firstDoc?.normalizeSnapshot?.canonical_lease;
    const buildingName = asText(firstDoc?.building) || asText(canonical?.building_name || canonical?.premises_name);
    const address = asText(firstDoc?.address) || asText(canonical?.address);
    const property = propertyByNormalized.get(`${normalize(buildingName)}::${normalize(address)}`)
      || propertyByNormalized.get(`${normalize(buildingName)}::`)
      || propertyByNormalized.get(`::${normalize(address)}`);
    const companyName = asText(canonical?.tenant_name) || workspaceCompany.name;
    const company = ensureCompany({
      id: asText(firstDoc?.companyId),
      name: companyName,
      type: normalize(companyName) === normalize(workspaceCompany.name) ? workspaceCompany.type : (input.representationMode === LANDLORD_REP_MODE ? "tenant" : "active_client"),
      market: property?.market,
      submarket: property?.submarket,
      buildingId: property?.id,
      floor: asText(canonical?.floor),
      suite: asText(canonical?.suite),
      squareFootage: asNumber(canonical?.rsf) || obligation.rsf,
      currentLeaseExpiration: obligation.expirationDate,
      noticeDeadline: obligation.noticeDate,
      landlordName: asText(canonical?.landlord_name),
      source: "obligation",
    });
    companyToObligations.set(company.id, mergeStringArray(companyToObligations.get(company.id), [obligation.id]));
  }

  for (const survey of input.surveys) {
    for (const sourceDocumentId of survey.sourceDocumentIds || []) {
      const document = documentsById.get(sourceDocumentId);
      const canonical = document?.normalizeSnapshot?.canonical_lease;
      const companyName = asText(canonical?.tenant_name) || workspaceCompany.name;
      const company = ensureCompany({
        id: asText(document?.companyId),
        name: companyName,
        type: normalize(companyName) === normalize(workspaceCompany.name) ? workspaceCompany.type : "prospect",
        source: "survey",
      });
      companyToSurveys.set(company.id, mergeStringArray(companyToSurveys.get(company.id), [survey.id]));
    }
  }

  for (const analysis of input.financialAnalyses) {
    const document = analysis.sourceDocumentId ? documentsById.get(analysis.sourceDocumentId) : undefined;
    const canonical = document?.normalizeSnapshot?.canonical_lease;
    const companyName = asText(canonical?.tenant_name) || workspaceCompany.name;
    const company = ensureCompany({
      id: asText(document?.companyId),
      name: companyName,
      type: normalize(companyName) === normalize(workspaceCompany.name) ? workspaceCompany.type : "prospect",
      source: "analysis",
    });
    companyToAnalyses.set(company.id, mergeStringArray(companyToAnalyses.get(company.id), [analysis.id]));
  }

  for (const abstract of input.leaseAbstracts) {
    const document = abstract.documentId ? documentsById.get(abstract.documentId) : undefined;
    const canonical = document?.normalizeSnapshot?.canonical_lease;
    const companyName = asText(canonical?.tenant_name) || workspaceCompany.name;
    const company = ensureCompany({
      id: asText(document?.companyId),
      name: companyName,
      type: normalize(companyName) === normalize(workspaceCompany.name) ? workspaceCompany.type : (input.representationMode === LANDLORD_REP_MODE ? "tenant" : "active_client"),
      source: "lease-abstract",
    });
    companyToAbstracts.set(company.id, mergeStringArray(companyToAbstracts.get(company.id), [abstract.id]));
  }

  const mergedCompanies = Array.from(companyMap.values()).map((company) => {
    const dealsForCompany = input.deals.filter((deal) => asText(deal.companyId) === company.id || (!asText(deal.companyId) && company.id === workspaceCompany.id));
    const docsForCompany = input.documents.filter((doc) => asText(doc.companyId) === company.id || companyToDocuments.get(company.id)?.includes(doc.id));
    const latestTouch = pickTouchDate(dealsForCompany, docsForCompany);
    const nextFollowUpDate = company.nextFollowUpDate || pickNextFollowUpDate(latestTouch || today, reminderConfig);
    const matchingOccupancies = occupancyRecords.filter((record) => record.companyId === company.id);
    return {
      ...company,
      market: company.market || matchingOccupancies.map((record) => buildingById.get(record.buildingId)?.market || "").find(Boolean) || "",
      submarket: company.submarket || matchingOccupancies.map((record) => buildingById.get(record.buildingId)?.submarket || "").find(Boolean) || "",
      buildingId: company.buildingId || matchingOccupancies[0]?.buildingId || "",
      floor: company.floor || matchingOccupancies[0]?.floor || "",
      suite: company.suite || matchingOccupancies[0]?.suite || "",
      squareFootage: Math.max(company.squareFootage, ...matchingOccupancies.map((record) => record.rsf), 0),
      currentLeaseExpiration: earliestDate([company.currentLeaseExpiration, ...matchingOccupancies.map((record) => record.leaseExpiration)]),
      noticeDeadline: earliestDate([company.noticeDeadline, ...matchingOccupancies.map((record) => record.noticeDeadline)]),
      linkedDocumentIds: mergeStringArray(company.linkedDocumentIds, companyToDocuments.get(company.id), docsForCompany.map((doc) => doc.id)),
      linkedDealIds: mergeStringArray(company.linkedDealIds, companyToDeals.get(company.id), dealsForCompany.map((deal) => deal.id)),
      linkedObligationIds: mergeStringArray(company.linkedObligationIds, companyToObligations.get(company.id)),
      linkedSurveyIds: mergeStringArray(company.linkedSurveyIds, companyToSurveys.get(company.id)),
      linkedAnalysisIds: mergeStringArray(company.linkedAnalysisIds, companyToAnalyses.get(company.id)),
      linkedLeaseAbstractIds: mergeStringArray(company.linkedLeaseAbstractIds, companyToAbstracts.get(company.id)),
      lastTouchDate: latestTouch,
      nextFollowUpDate,
      prospectStatus: company.prospectStatus || dealsForCompany[0]?.stage || (company.type === "prospect" ? "Targeted" : "Managed"),
      relationshipOwner: company.relationshipOwner || dealsForCompany[0]?.tenantRepBroker || "Broker Team",
      updatedAt: new Date().toISOString(),
    };
  });

  const companies = [
    ...mergedCompanies,
    ...existingCompanies.filter((company) => !mergedCompanies.some((item) => item.id === company.id)),
  ].map((company) => (
    company.buildingId && deletedExistingBuildingIds.has(company.buildingId)
      ? { ...company, buildingId: "" }
      : company
  ));

  const shortlists = existingShortlists
    .filter((item) => asText(item.buildingId) && !deletedExistingBuildingIds.has(asText(item.buildingId)))
    .map((item) => ({
      ...item,
      clientId: input.clientId,
    }));
  const shortlistIdSet = new Set(shortlists.map((item) => item.id));
  const shortlistEntries = existingShortlistEntries
    .filter((item) => (
      asText(item.shortlistId)
      && shortlistIdSet.has(asText(item.shortlistId))
      && asText(item.buildingId)
      && !deletedExistingBuildingIds.has(asText(item.buildingId))
      && asText(item.suite)
    ))
    .map((item) => ({
      ...item,
      clientId: input.clientId,
      owner: asText(item.owner),
    }));
  const shortlistEntryIdSet = new Set(shortlistEntries.map((item) => item.id));
  const tours = existingTours
    .filter((item) => (
      asText(item.buildingId)
      && !deletedExistingBuildingIds.has(asText(item.buildingId))
      && asText(item.suite)
      && (!asText(item.shortlistEntryId) || shortlistEntryIdSet.has(asText(item.shortlistEntryId)))
    ))
    .map((item) => ({
      ...item,
      clientId: input.clientId,
      assignee: asText(item.assignee) || asText(item.broker),
      attendees: ensureArray<string>(item.attendees),
    }));
  const workflowBoardViews = existingWorkflowBoardViews
    .filter((item) => {
      if (!asText(item.name)) return false;
      const buildingId = asText(item.buildingId);
      return !buildingId || buildingId === "all" || !deletedExistingBuildingIds.has(buildingId);
    })
    .map((item) => ({
      ...item,
      clientId: input.clientId,
      scope: (asText((item as { scope?: string }).scope) || (asText(item.dealId) ? "deal" : "team")) as CrmWorkflowBoardViewScope,
      createdBy: asText((item as { createdBy?: string }).createdBy),
      team: asText((item as { team?: string }).team),
      buildingId: asText(item.buildingId) || "all",
      broker: asText(item.broker) || "all",
      dateFilter: (asText(item.dateFilter) || "all") as CrmWorkflowBoardDateFilter,
    }));

  const prospectingRecords: CrmProspectingRecord[] = companies.map((company) => {
    const existingRecord = existingProspecting.find((record) => record.companyId === company.id);
    const building = buildingById.get(company.buildingId);
    const primaryOccupancy = occupancyRecords.find((record) => record.companyId === company.id);
    return {
      id: existingRecord?.id || `crm_prospect_${company.id}`,
      clientId: input.clientId,
      companyId: company.id,
      market: mergeString(existingRecord?.market || "", company.market || building?.market || ""),
      submarket: mergeString(existingRecord?.submarket || "", company.submarket || building?.submarket || ""),
      buildingId: mergeString(existingRecord?.buildingId || "", company.buildingId),
      floor: mergeString(existingRecord?.floor || "", company.floor || primaryOccupancy?.floor || ""),
      suite: mergeString(existingRecord?.suite || "", company.suite || primaryOccupancy?.suite || ""),
      prospectStage: mergeString(existingRecord?.prospectStage || "", company.prospectStatus || (company.type === "prospect" ? "Prospecting" : "Managed")),
      temperature: mergeString(existingRecord?.temperature || "", company.type === "prospect" ? "Warm" : "Active"),
      leadSource: mergeString(existingRecord?.leadSource || "", company.source),
      lastContactDate: mergeString(existingRecord?.lastContactDate || "", company.lastTouchDate),
      nextFollowUpDate: mergeString(existingRecord?.nextFollowUpDate || "", company.nextFollowUpDate),
      expirationDate: mergeString(existingRecord?.expirationDate || "", company.currentLeaseExpiration),
      notes: mergeString(existingRecord?.notes || "", company.notes),
      assignedBroker: mergeString(existingRecord?.assignedBroker || "", company.relationshipOwner),
    };
  });

  const clientRelationshipRecords: CrmClientRelationshipRecord[] = companies
    .filter((company) => company.type !== "prospect")
    .map((company) => {
      const existingRecord = existingRelationships.find((record) => record.companyId === company.id);
      const occupancyCount = occupancyRecords.filter((record) => record.companyId === company.id).length;
      const dealCount = company.linkedDealIds.length;
      const nextCriticalDate = earliestDate([
        company.noticeDeadline,
        company.currentLeaseExpiration,
        ...existingTasks.filter((task) => task.companyId === company.id).map((task) => task.dueDate),
      ]);
      return {
        id: existingRecord?.id || `crm_relationship_${company.id}`,
        clientId: input.clientId,
        companyId: company.id,
        relationshipStage: mergeString(existingRecord?.relationshipStage || "", company.type === "former_client" ? "Former Client" : "Active Coverage"),
        activeDealsCount: Math.max(asNumber(existingRecord?.activeDealsCount), dealCount),
        activeLocationsCount: Math.max(asNumber(existingRecord?.activeLocationsCount), occupancyCount),
        totalRSF: Math.max(asNumber(existingRecord?.totalRSF), company.squareFootage),
        nextCriticalDate,
        renewalRisk: mergeString(existingRecord?.renewalRisk || "", monthsUntil(company.currentLeaseExpiration) <= 9 ? "High" : monthsUntil(company.currentLeaseExpiration) <= 18 ? "Moderate" : "Low"),
        churnRisk: mergeString(existingRecord?.churnRisk || "", company.type === "former_client" ? "High" : dealCount > 0 ? "Moderate" : "Low"),
        expansionPotential: mergeString(existingRecord?.expansionPotential || "", company.linkedSurveyIds.length > 0 || company.linkedAnalysisIds.length > 0 ? "High" : "Monitor"),
        notes: mergeString(existingRecord?.notes || "", company.notes),
      };
    });

  const reminders = ensureArray<CrmReminder>(existing.reminders).filter((reminder) => reminder.status !== "dismissed");
  const autoReminders = new Map<string, CrmReminder>();
  for (const company of companies) {
    if (company.currentLeaseExpiration) {
      const monthsAway = monthsUntil(company.currentLeaseExpiration, today);
      for (const threshold of reminderConfig.expirationMonths) {
        if (monthsAway <= threshold && monthsAway >= 0) {
          const id = buildReminderId([company.id, "expiration", String(threshold)]);
          autoReminders.set(id, {
            id,
            clientId: input.clientId,
            companyId: company.id,
            reminderType: "expiration_window",
            triggerDate: company.currentLeaseExpiration,
            triggerLogic: `${threshold} months before expiration`,
            status: "open",
            severity: threshold <= 6 ? "critical" : threshold <= 12 ? "warn" : "info",
            message: `${company.name} is inside the ${threshold}-month expiration window.`,
          });
        }
      }
    }
    if (company.noticeDeadline) {
      const daysAway = daysBetween(today, company.noticeDeadline);
      for (const threshold of reminderConfig.noticeDaysBefore) {
        if (daysAway <= threshold && daysAway >= 0) {
          const id = buildReminderId([company.id, "notice", String(threshold)]);
          autoReminders.set(id, {
            id,
            clientId: input.clientId,
            companyId: company.id,
            reminderType: "notice_deadline",
            triggerDate: company.noticeDeadline,
            triggerLogic: `${threshold} days before notice deadline`,
            status: "open",
            severity: threshold <= 60 ? "critical" : "warn",
            message: `${company.name} has a notice deadline approaching in ${daysAway} days.`,
          });
        }
      }
    }
    const daysSinceTouch = company.lastTouchDate ? Math.max(0, daysBetween(company.lastTouchDate, today)) : Number.POSITIVE_INFINITY;
    for (const threshold of reminderConfig.overdueFollowUpDays) {
      if (daysSinceTouch >= threshold) {
        const id = buildReminderId([company.id, "follow-up", String(threshold)]);
        autoReminders.set(id, {
          id,
          clientId: input.clientId,
          companyId: company.id,
          reminderType: "follow_up_overdue",
          triggerDate: company.nextFollowUpDate || today,
          triggerLogic: `${threshold} days since last touch`,
          status: "open",
          severity: threshold >= 60 ? "critical" : "warn",
          message: `${company.name} has not been touched in ${daysSinceTouch === Number.POSITIVE_INFINITY ? threshold : daysSinceTouch} days.`,
        });
      }
    }
  }

  const templates = [
    ...buildDefaultTemplates(input.representationMode),
    ...existingTemplates.filter((template) => !buildDefaultTemplates(input.representationMode).some((defaultTemplate) => defaultTemplate.id === template.id)),
  ];

  return {
    companies,
    buildings,
    deletedBuildingKeys,
    occupancyRecords,
    stackingPlanEntries,
    shortlists,
    shortlistEntries,
    tours,
    workflowBoardViews,
    prospectingRecords,
    clientRelationshipRecords,
    tasks: existingTasks,
    templates,
    reminders: [...Array.from(autoReminders.values()), ...reminders.filter((reminder) => !autoReminders.has(reminder.id))],
    touchpoints: existingTouchpoints,
    reminderConfig,
  };
}

export function defaultCrmFilters(): CrmFilters {
  return {
    query: "",
    market: "all",
    submarket: "all",
    buildingId: "all",
    floor: "all",
    suite: "all",
    companyType: "all",
    prospectStage: "all",
    expirationBucket: "all",
    followUpState: "all",
  };
}

function matchesFilters(company: CrmCompany, record: CrmProspectingRecord | undefined, filters: CrmFilters): boolean {
  const query = normalize(filters.query);
  if (query) {
    const haystack = [
      company.name,
      company.market,
      company.submarket,
      company.floor,
      company.suite,
      company.notes,
      record?.prospectStage,
      record?.assignedBroker,
    ].join(" ").toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.market !== "all" && normalize(company.market) !== normalize(filters.market)) return false;
  if (filters.submarket !== "all" && normalize(company.submarket) !== normalize(filters.submarket)) return false;
  if (filters.buildingId !== "all" && company.buildingId !== filters.buildingId) return false;
  if (filters.floor !== "all" && normalize(company.floor) !== normalize(filters.floor)) return false;
  if (filters.suite !== "all" && normalize(company.suite) !== normalize(filters.suite)) return false;
  if (filters.companyType !== "all" && company.type !== filters.companyType) return false;
  if (filters.prospectStage !== "all" && normalize(record?.prospectStage) !== normalize(filters.prospectStage)) return false;
  if (filters.expirationBucket !== "all") {
    const monthsAway = monthsUntil(company.currentLeaseExpiration);
    if (filters.expirationBucket === "12m" && !(monthsAway >= 0 && monthsAway <= 12)) return false;
    if (filters.expirationBucket === "18m" && !(monthsAway >= 0 && monthsAway <= 18)) return false;
    if (filters.expirationBucket === "24m" && !(monthsAway >= 0 && monthsAway <= 24)) return false;
    if (filters.expirationBucket === "past_due" && !(monthsAway < 0)) return false;
  }
  if (filters.followUpState !== "all") {
    const nextFollowUp = asText(record?.nextFollowUpDate) || company.nextFollowUpDate;
    const daysAway = daysBetween(todayIso(), nextFollowUp || todayIso());
    if (filters.followUpState === "due_this_week" && !(daysAway >= 0 && daysAway <= 7)) return false;
    if (filters.followUpState === "overdue" && !(daysAway < 0)) return false;
    if (filters.followUpState === "no_touch_45" && !(company.lastTouchDate && daysBetween(company.lastTouchDate, todayIso()) >= 45)) return false;
  }
  return true;
}

export function filterCrmCompanies(state: CrmWorkspaceState, filters: CrmFilters): CrmCompany[] {
  const prospectingByCompanyId = new Map(state.prospectingRecords.map((record) => [record.companyId, record]));
  return state.companies.filter((company) => matchesFilters(company, prospectingByCompanyId.get(company.id), filters));
}

function matchesBuildingFilters(building: CrmBuilding, filters: CrmFilters): boolean {
  const query = normalize(filters.query);
  if (query) {
    const haystack = [
      building.name,
      building.address,
      building.market,
      building.submarket,
      building.ownerName,
      building.buildingClass,
      building.leasingCompanyName,
      building.propertyManagerName,
    ].join(" ").toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.market !== "all" && normalize(building.market) !== normalize(filters.market)) return false;
  if (filters.submarket !== "all" && normalize(building.submarket) !== normalize(filters.submarket)) return false;
  if (filters.buildingId !== "all" && building.id !== filters.buildingId) return false;
  return true;
}

export function filterCrmBuildings(state: CrmWorkspaceState, filters: CrmFilters): CrmBuilding[] {
  return state.buildings.filter((building) => hasUsableCoordinates(building) && matchesBuildingFilters(building, filters));
}

export function buildCrmDashboard(state: CrmWorkspaceState, filters: CrmFilters): CrmDashboardModel {
  const companies = filterCrmCompanies(state, filters);
  const companyIds = new Set(companies.map((company) => company.id));
  const buildings = filterCrmBuildings(state, filters);
  const buildingIds = new Set(buildings.map((building) => building.id));
  const reminders = state.reminders.filter((reminder) => !reminder.companyId || companyIds.has(reminder.companyId));
  const occupancies = state.occupancyRecords.filter((record) => companyIds.has(record.companyId) || buildingIds.has(record.buildingId));
  const now = todayIso();
  const monthLabels: CrmTimelinePoint[] = [];
  const expirationCounts = new Map<string, number>();
  const heatmap = new Map<string, CrmHeatmapCell>();

  for (const company of companies) {
    const expiration = asText(company.currentLeaseExpiration);
    if (!expiration) continue;
    const parsed = parseDate(expiration);
    if (!parsed) continue;
    const label = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
    expirationCounts.set(label, (expirationCounts.get(label) || 0) + 1);
    const heatmapKey = `${parsed.getUTCFullYear()}-${parsed.getUTCMonth()}`;
    heatmap.set(heatmapKey, {
      year: parsed.getUTCFullYear(),
      month: parsed.getUTCMonth() + 1,
      label,
      count: (heatmap.get(heatmapKey)?.count || 0) + 1,
    });
  }

  Array.from(expirationCounts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([label, count]) => monthLabels.push({ label, count }));

  const buildingById = new Map(state.buildings.map((building) => [building.id, building]));
  const marketMap = new Map<string, Map<string, Map<string, Map<string, CrmLocationLeaf[]>>>>();
  for (const building of buildings) {
    const market = asText(building.market || "Unknown market");
    const submarket = asText(building.submarket || "Unknown submarket");
    if (!marketMap.has(market)) marketMap.set(market, new Map());
    const submarketMap = marketMap.get(market)!;
    if (!submarketMap.has(submarket)) submarketMap.set(submarket, new Map());
    const buildingMap = submarketMap.get(submarket)!;
    if (!buildingMap.has(building.id)) buildingMap.set(building.id, new Map());
  }
  for (const occupancy of occupancies) {
    const company = companies.find((item) => item.id === occupancy.companyId);
    if (!company || !buildingIds.has(occupancy.buildingId)) continue;
    const building = buildingById.get(occupancy.buildingId);
    const market = asText(building?.market || company.market || "Unknown market");
    const submarket = asText(building?.submarket || company.submarket || "Unknown submarket");
    const buildingId = occupancy.buildingId;
    const buildingName = normalizeBuildingName(building?.name);
    if (!buildingName) continue;
    const floor = asText(occupancy.floor || company.floor || "Unknown floor");
    if (!marketMap.has(market)) marketMap.set(market, new Map());
    const submarketMap = marketMap.get(market)!;
    if (!submarketMap.has(submarket)) submarketMap.set(submarket, new Map());
    const buildingMap = submarketMap.get(submarket)!;
    if (!buildingMap.has(buildingId)) buildingMap.set(buildingId, new Map());
    const floorMap = buildingMap.get(buildingId)!;
    const floorKey = `${floor}::${buildingName}`;
    if (!floorMap.has(floorKey)) floorMap.set(floorKey, []);
    floorMap.get(floorKey)!.push({
      suite: occupancy.suite || company.suite || "Unknown suite",
      floor,
      companyId: company.id,
      companyName: company.name,
      companyType: company.type,
      expirationDate: company.currentLeaseExpiration,
      rsf: occupancy.rsf,
    });
  }

  const locationHierarchy: CrmLocationMarketGroup[] = Array.from(marketMap.entries()).map(([market, submarkets]) => ({
    market,
    submarkets: Array.from(submarkets.entries()).map(([submarket, buildings]) => ({
      submarket,
      buildings: Array.from(buildings.entries())
        .map(([buildingId, floors]) => ({
          buildingId,
          buildingName: normalizeBuildingName(buildingById.get(buildingId)?.name),
          market,
          submarket,
          floors: Array.from(floors.entries()).map(([floorKey, suites]) => ({
            floor: floorKey.split("::")[0] || "Unknown floor",
            suites: suites.sort((left, right) => left.suite.localeCompare(right.suite)),
          })),
        }))
        .filter((building) => building.buildingName),
    }))
      .filter((group) => group.buildings.length > 0),
  })).filter((group) => group.submarkets.length > 0);

  const concentrationByMarket = Array.from(
    buildings.reduce((map, building) => {
      const label = building.market || "Unassigned";
      const current = map.get(label) || { label, rsf: 0, count: 0 };
      current.rsf += building.totalRSF;
      current.count += 1;
      map.set(label, current);
      return map;
    }, new Map<string, { label: string; rsf: number; count: number }>()).values(),
  ).sort((left, right) => right.rsf - left.rsf);

  const concentrationByBuilding = Array.from(
    buildings.reduce((map, building) => {
      const label = normalizeBuildingName(building?.name);
      if (!label) return map;
      const current = map.get(label) || { label, rsf: 0, count: 0 };
      current.rsf += building.totalRSF;
      current.count += 1;
      map.set(label, current);
      return map;
    }, new Map<string, { label: string; rsf: number; count: number }>()).values(),
  ).sort((left, right) => right.rsf - left.rsf);

  const relationshipQueue = [...companies].sort((left, right) => {
    const leftCritical = earliestDate([left.noticeDeadline, left.currentLeaseExpiration, left.nextFollowUpDate]);
    const rightCritical = earliestDate([right.noticeDeadline, right.currentLeaseExpiration, right.nextFollowUpDate]);
    return leftCritical.localeCompare(rightCritical);
  }).slice(0, 12);

  return {
    totalProspects: companies.filter((company) => company.type === "prospect").length,
    totalActiveClients: companies.filter((company) => company.type === "active_client").length,
    totalLandlordTenants: companies.filter((company) => company.type === "tenant" || company.type === "landlord").length,
    upcomingExpirations: companies.filter((company) => {
      const monthsAway = monthsUntil(company.currentLeaseExpiration, now);
      return monthsAway >= 0 && monthsAway <= 18;
    }).length,
    upcomingNoticeDates: companies.filter((company) => {
      const daysAway = daysBetween(now, company.noticeDeadline);
      return daysAway >= 0 && daysAway <= 180;
    }).length,
    activeDeals: companies.reduce((sum, company) => sum + company.linkedDealIds.length, 0),
    highPriorityTasks: state.tasks.filter((task) => normalize(task.priority) === "critical" || normalize(task.priority) === "high").length,
    dueReminders: reminders.filter((reminder) => reminder.status === "open").length,
    overdueFollowUps: companies.filter((company) => company.nextFollowUpDate && daysBetween(now, company.nextFollowUpDate) < 0).length,
    noTouchCompanies: companies.filter((company) => company.lastTouchDate && daysBetween(company.lastTouchDate, now) >= 45).length,
    expirationTimeline: monthLabels,
    expirationHeatmap: Array.from(heatmap.values()).sort((left, right) => left.label.localeCompare(right.label)),
    relationshipQueue,
    locationHierarchy,
    concentrationByMarket,
    concentrationByBuilding,
  };
}

function variableMap(input: {
  company?: CrmCompany | null;
  building?: CrmBuilding | null;
  occupancy?: CrmOccupancyRecord | null;
  brokerName?: string;
}): Record<string, string> {
  const company = input.company;
  const building = input.building;
  const occupancy = input.occupancy;
  return {
    client_name: asText(company?.name),
    prospect_name: asText(company?.name),
    company_name: asText(company?.name),
    building_name: asText(building?.name),
    suite: asText(occupancy?.suite || company?.suite),
    floor: asText(occupancy?.floor || company?.floor),
    market: asText(company?.market || building?.market),
    submarket: asText(company?.submarket || building?.submarket),
    lease_expiration: asText(company?.currentLeaseExpiration),
    notice_deadline: asText(company?.noticeDeadline),
    last_touch_date: asText(company?.lastTouchDate),
    broker_name: asText(input.brokerName) || "Broker Team",
  };
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, token) => values[token] || "");
}

export function generateCrmOutreachDraft(input: {
  template: CrmTemplate;
  company?: CrmCompany | null;
  building?: CrmBuilding | null;
  occupancy?: CrmOccupancyRecord | null;
  brokerName?: string;
  representationMode: RepresentationMode | null | undefined;
}): { subject: string; body: string; recommendation: string } {
  const values = variableMap(input);
  const subject = fillTemplate(input.template.subjectTemplate, values).trim();
  let body = fillTemplate(input.template.bodyTemplate, values).trim();
  const monthsAway = monthsUntil(values.lease_expiration);
  const modeLead = input.representationMode === LANDLORD_REP_MODE
    ? "Landlord-side recommendation"
    : "Tenant-side recommendation";
  const recommendation = input.template.aiAssistEnabled
    ? `${modeLead}: ${values.company_name || "This relationship"} should receive ${monthsAway <= 9 ? "urgent" : "timely"} follow up focused on ${input.template.templateType.replace(/_/g, " ")}.`
    : `${modeLead}: Use the selected template as-is.`;
  if (input.template.aiAssistEnabled) {
    const aiLine = input.representationMode === LANDLORD_REP_MODE
      ? `\n\nAI note: emphasize building activity, timing, and the next decision needed to protect occupancy momentum.`
      : `\n\nAI note: emphasize expiration timing, leverage, and the most useful next strategic conversation.`;
    body = `${body}${aiLine}`.trim();
  }
  return { subject, body, recommendation };
}
