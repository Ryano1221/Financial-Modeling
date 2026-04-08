"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { computeSurveyMonthlyOccupancyCost } from "@/lib/surveys/engine";
import type { SurveyEntry } from "@/lib/surveys/types";
import type { ObligationStorageState } from "@/lib/obligations/types";
import type { CompletedLeaseDocumentRecord } from "@/lib/completed-leases/types";
import type { SubleaseScenario } from "@/lib/sublease-recovery/types";
import type { CrmWorkspaceState } from "@/lib/workspace/crm";
import { buildCrmWorkspaceState, CRM_OS_STORAGE_KEY, emptyCrmWorkspaceState } from "@/lib/workspace/crm";
import {
  buildWorkflowTransitionLabel,
  getWorkflowStagesForMode,
  getWorkflowTransitionDecision,
  inferWorkflowStageFromDocumentType,
} from "@/lib/workspace/workflow-engine";
import { classifyDocument, extractEntitiesFromCanonical } from "@/lib/workspace/document-intelligence";
import { getRepresentationModeProfile } from "@/lib/workspace/representation-profile";
import {
  runAiCommandPlan,
  suggestToolPlan,
  type AiToolExecutionContext,
} from "@/lib/workspace/ai-orchestrator";
import type {
  BrokerageOsActivity,
  BrokerageOsAiExecutionResult,
  BrokerageOsAmendment,
  BrokerageOsArtifactsState,
  BrokerageOsAuditEvent,
  BrokerageOsChangeEvent,
  BrokerageOsCompany,
  BrokerageOsContact,
  BrokerageOsEntityGraph,
  BrokerageOsExport,
  BrokerageOsFinancialAnalysis,
  BrokerageOsLease,
  BrokerageOsLeaseAbstract,
  BrokerageOsObligation,
  BrokerageOsProposal,
  BrokerageOsProperty,
  BrokerageOsRequirement,
  BrokerageOsShareLink,
  BrokerageOsSpace,
  BrokerageOsSubleaseRecovery,
  BrokerageOsSurvey,
  BrokerageOsSurveyEntry,
  BrokerageOsTask,
  BrokerageOsToolName,
  BrokerageOsToolResult,
} from "@/lib/workspace/os-types";
import type { ClientWorkspaceDeal, ClientWorkspaceDocument } from "@/lib/workspace/types";
import { fetchWorkspaceCloudSection, saveWorkspaceCloudSection } from "@/lib/workspace/cloud";
import { preferLocalWhenRemoteEmpty } from "@/lib/workspace/account-sync";
import { fetchSharedMarketInventory, type SharedMarketInventoryResponse } from "@/lib/workspace/market-inventory";
import { makeClientScopedStorageKey } from "@/lib/workspace/storage";
import { LANDLORD_REP_MODE } from "@/lib/workspace/representation-mode";

const SURVEYS_STORAGE_KEY = "surveys_module_entries_v1";
const OBLIGATIONS_STORAGE_KEY = "obligations_module_v1";
const COMPLETED_LEASES_STORAGE_KEY = "completed_leases_module_v1";
const SUBLEASE_RECOVERY_STORAGE_KEY = "sublease_recovery_analysis_scenarios_v2";
const BROKER_OS_ARTIFACTS_KEY = "brokerage_os_artifacts_v1";

interface ModuleSnapshots {
  surveys: SurveyEntry[];
  obligations: ObligationStorageState | null;
  completedLeaseDocuments: CompletedLeaseDocumentRecord[];
  subleaseScenarios: SubleaseScenario[];
  crmState: CrmWorkspaceState | null;
}

function emptySnapshots(): ModuleSnapshots {
  return {
    surveys: [],
    obligations: null,
    completedLeaseDocuments: [],
    subleaseScenarios: [],
    crmState: null,
  };
}

function defaultArtifactsState(): BrokerageOsArtifactsState {
  return {
    activityLog: [],
    changeLog: [],
    auditTrail: [],
    exports: [],
    shareLinks: [],
  };
}

function asText(value: unknown): string {
  return String(value || "").trim();
}

function normalize(value: unknown): string {
  return asText(value).toLowerCase();
}

function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseModuleSnapshotValue(key: string, value: unknown): ModuleSnapshots[keyof ModuleSnapshots] {
  if (key === "surveys") {
    if (!value || typeof value !== "object") return [];
    const entries = Array.isArray((value as { entries?: unknown[] }).entries)
      ? ((value as { entries?: SurveyEntry[] }).entries || [])
      : [];
    return entries;
  }
  if (key === "obligations") {
    if (!value || typeof value !== "object") return null;
    return value as ObligationStorageState;
  }
  if (key === "completedLeaseDocuments") {
    if (!value || typeof value !== "object") return [];
    const docs = Array.isArray((value as { documents?: unknown[] }).documents)
      ? ((value as { documents?: CompletedLeaseDocumentRecord[] }).documents || [])
      : [];
    return docs;
  }
  if (key === "subleaseScenarios") {
    if (!value || typeof value !== "object") return [];
    const scenarios = Array.isArray((value as { scenarios?: unknown[] }).scenarios)
      ? ((value as { scenarios?: SubleaseScenario[] }).scenarios || [])
      : [];
    return scenarios;
  }
  if (key === "crmState") {
    if (!value || typeof value !== "object") return null;
    return value as CrmWorkspaceState;
  }
  return [];
}

function localStorageKey(baseKey: string, clientId: string): string {
  return makeClientScopedStorageKey(baseKey, clientId);
}

function collectRequirements(deals: ClientWorkspaceDeal[]): BrokerageOsRequirement[] {
  return deals.map((deal) => ({
    id: `requirement_${deal.id}`,
    clientId: deal.clientId,
    dealId: deal.id,
    name: asText(deal.requirementName) || `${deal.dealName} Requirement`,
    market: asText(deal.targetMarket),
    submarket: asText(deal.submarket),
    squareFootageMin: Number(deal.squareFootageMin) || 0,
    squareFootageMax: Number(deal.squareFootageMax) || 0,
    budget: Number(deal.budget) || 0,
    occupancyGoal: asText(deal.occupancyDateGoal),
    noticeDeadline: asText(deal.expirationDate),
  }));
}

function buildBasePropertiesAndSpaces(input: {
  clientId: string;
  documents: ClientWorkspaceDocument[];
  surveys: SurveyEntry[];
  deals: ClientWorkspaceDeal[];
}): { properties: BrokerageOsProperty[]; spaces: BrokerageOsSpace[] } {
  const propertyByKey = new Map<string, BrokerageOsProperty>();
  const spaceByKey = new Map<string, BrokerageOsSpace>();
  const ensureProperty = (name: string, address: string, market = "", submarket = ""): BrokerageOsProperty => {
    const key = `${normalize(name)}::${normalize(address)}`;
    const existing = propertyByKey.get(key);
    if (existing) return existing;
    const created: BrokerageOsProperty = {
      id: nextId("property"),
      clientId: input.clientId,
      name: asText(name) || "Unknown Property",
      address: asText(address),
      market: asText(market),
      submarket: asText(submarket),
    };
    propertyByKey.set(key, created);
    return created;
  };
  const ensureSpace = (propertyId: string, floor: string, suite: string, rsf: number): BrokerageOsSpace => {
    const key = `${propertyId}::${normalize(floor)}::${normalize(suite)}`;
    const existing = spaceByKey.get(key);
    if (existing) return existing;
    const created: BrokerageOsSpace = {
      id: nextId("space"),
      clientId: input.clientId,
      propertyId,
      floor: asText(floor),
      suite: asText(suite),
      rsf: Number(rsf) || 0,
    };
    spaceByKey.set(key, created);
    return created;
  };

  for (const doc of input.documents) {
    const property = ensureProperty(doc.building, doc.address);
    ensureSpace(property.id, "", doc.suite, 0);
  }
  for (const entry of input.surveys) {
    const property = ensureProperty(entry.buildingName, entry.address);
    ensureSpace(property.id, entry.floor, entry.suite, entry.availableSqft);
  }
  for (const deal of input.deals) {
    const property = ensureProperty(deal.selectedProperty, "", deal.targetMarket, deal.submarket);
    ensureSpace(property.id, "", deal.selectedSuite, Math.max(0, Number(deal.squareFootageMax) || 0));
  }

  return { properties: Array.from(propertyByKey.values()), spaces: Array.from(spaceByKey.values()) };
}

function buildProposals(documents: ClientWorkspaceDocument[]): BrokerageOsProposal[] {
  return documents
    .filter((doc) => doc.type === "proposals" || doc.type === "lois" || doc.type === "counters" || doc.type === "sublease documents")
    .map((doc) => {
      const canonical = doc.normalizeSnapshot?.canonical_lease;
      const firstRate = Number(canonical?.rent_schedule?.[0]?.rent_psf_annual) || 0;
      const termMonths = Number(canonical?.term_months) || 0;
      const type =
        doc.type === "lois" ? "loi" :
          doc.type === "counters" ? "counter" :
            doc.type === "sublease documents" ? "sublease document" : "proposal";
      const extractionSummary = doc.normalizeSnapshot?.extraction_summary;
      const summaryText =
        asText(extractionSummary?.document_type_detected)
        || asText(extractionSummary?.key_terms_found?.slice(0, 2).join(", "))
        || "";
      return {
        id: `proposal_${doc.id}`,
        clientId: doc.clientId,
        dealId: doc.dealId,
        documentId: doc.id,
        type,
        annualRatePsf: firstRate,
        termMonths,
        summary: summaryText,
      } satisfies BrokerageOsProposal;
    });
}

function buildSurveys(clientId: string, entries: SurveyEntry[]): { surveys: BrokerageOsSurvey[]; surveyEntries: BrokerageOsSurveyEntry[] } {
  const surveyId = entries.length > 0 ? `survey_${clientId}` : "";
  const surveys: BrokerageOsSurvey[] = entries.length > 0
    ? [{
      id: surveyId,
      clientId,
      name: "Client Survey Workspace",
      createdAt: entries[entries.length - 1]?.uploadedAtIso || new Date().toISOString(),
      updatedAt: entries[0]?.uploadedAtIso || new Date().toISOString(),
      sourceDocumentIds: Array.from(new Set(entries.map((entry) => asText(entry.sourceDocumentName)).filter(Boolean))),
    }]
    : [];
  const surveyEntries: BrokerageOsSurveyEntry[] = entries.map((entry) => ({
    id: entry.id,
    clientId,
    surveyId: surveyId || `survey_${clientId}`,
    building: asText(entry.buildingName),
    address: asText(entry.address),
    floor: asText(entry.floor),
    suite: asText(entry.suite),
    rsf: Number(entry.availableSqft) || 0,
    baseRentPsfAnnual: Number(entry.baseRentPsfAnnual) || 0,
    opexPsfAnnual: Number(entry.opexPsfAnnual) || 0,
    leaseType: asText(entry.leaseType),
    occupancyType: asText(entry.occupancyType),
    sublessor: asText(entry.sublessor),
    subleaseExpiration: asText(entry.subleaseExpirationDate),
    monthlyOccupancyCost: computeSurveyMonthlyOccupancyCost(entry).totalMonthly,
    sourceDocumentId: asText(entry.sourceDocumentName) || undefined,
  }));
  return { surveys, surveyEntries };
}

function buildLeasesAndAmendments(documents: ClientWorkspaceDocument[]): {
  leases: BrokerageOsLease[];
  amendments: BrokerageOsAmendment[];
  leaseAbstracts: BrokerageOsLeaseAbstract[];
} {
  const leases: BrokerageOsLease[] = [];
  const leaseByDocId = new Map<string, BrokerageOsLease>();
  const amendments: BrokerageOsAmendment[] = [];
  const leaseAbstracts: BrokerageOsLeaseAbstract[] = [];

  for (const doc of documents) {
    const canonical = doc.normalizeSnapshot?.canonical_lease;
    if (doc.type === "leases") {
      const lease: BrokerageOsLease = {
        id: `lease_${doc.id}`,
        clientId: doc.clientId,
        dealId: doc.dealId,
        documentId: doc.id,
        tenant: asText(canonical?.tenant_name),
        landlord: asText(canonical?.landlord_name),
        commencement: asText(canonical?.commencement_date),
        expiration: asText(canonical?.expiration_date),
      };
      leases.push(lease);
      leaseByDocId.set(doc.id, lease);
      continue;
    }
    if (doc.type === "amendments") {
      const fallbackLease = leases[leases.length - 1];
      const summary =
        asText(doc.normalizeSnapshot?.extraction_summary?.document_type_detected)
        || asText(doc.normalizeSnapshot?.warnings?.[0] || "")
        || "Amendment";
      amendments.push({
        id: `amendment_${doc.id}`,
        clientId: doc.clientId,
        leaseId: fallbackLease?.id || "lease_unknown",
        documentId: doc.id,
        effectiveDate: asText(canonical?.commencement_date),
        summary,
      });
      continue;
    }
    if (doc.type === "abstracts") {
      const fallbackLease = leases[leases.length - 1];
      leaseAbstracts.push({
        id: `abstract_${doc.id}`,
        clientId: doc.clientId,
        leaseId: fallbackLease?.id || "lease_unknown",
        amendmentIds: [],
        documentId: doc.id,
        name: doc.name,
        createdAt: doc.uploadedAt,
      });
    }
  }

  return { leases, amendments, leaseAbstracts };
}

function buildObligationsFromSnapshots(input: {
  clientId: string;
  obligationsSnapshot: ObligationStorageState | null;
  leases: BrokerageOsLease[];
}): BrokerageOsObligation[] {
  const obligations = input.obligationsSnapshot?.obligations || [];
  if (obligations.length > 0) {
    return obligations.map((item) => ({
      id: item.id,
      clientId: input.clientId,
      title: asText(item.title),
      rsf: Number(item.rsf) || 0,
      annualRentObligation: Number(item.annualObligation) || 0,
      totalObligation: Number(item.totalObligation) || 0,
      renewalDate: asText(item.renewalDate),
      noticeDate: asText(item.noticeDate),
      expirationDate: asText(item.expirationDate),
      terminationRightDate: asText(item.terminationRightDate),
      sourceDocumentIds: Array.isArray(item.sourceDocumentIds) ? item.sourceDocumentIds : [],
    }));
  }
  return input.leases.map((lease) => ({
    id: `obligation_${lease.id}`,
    clientId: input.clientId,
    leaseId: lease.id,
    title: `${lease.tenant || "Tenant"} Lease Obligation`,
    rsf: 0,
    annualRentObligation: 0,
    totalObligation: 0,
    renewalDate: "",
    noticeDate: "",
    expirationDate: lease.expiration,
    terminationRightDate: "",
    sourceDocumentIds: [lease.documentId],
  }));
}

function mapDealTasks(deals: ClientWorkspaceDeal[]): BrokerageOsTask[] {
  const tasks: BrokerageOsTask[] = [];
  for (const deal of deals) {
    for (const task of deal.tasks || []) {
      tasks.push({
        id: task.id,
        clientId: task.clientId,
        dealId: task.dealId,
        title: task.title,
        dueDate: task.dueDate,
        completed: Boolean(task.completed),
        createdAt: task.createdAt,
      });
    }
  }
  return tasks;
}

interface BrokerOsContextValue {
  graph: BrokerageOsEntityGraph;
  workflowStages: readonly string[];
  artifacts: BrokerageOsArtifactsState;
  runAiCommand: (command: string) => Promise<BrokerageOsAiExecutionResult>;
  executeTool: (tool: BrokerageOsToolName, input: Record<string, unknown>) => Promise<BrokerageOsToolResult>;
  transitionDealStage: (dealId: string, nextStage: string, source: "user" | "ai" | "automation", reason?: string) => BrokerageOsToolResult;
  createTaskForDeal: (dealId: string, title: string, dueDate?: string) => BrokerageOsToolResult;
  recordExport: (input: Omit<BrokerageOsExport, "id" | "createdAt">) => void;
  recordShareLink: (input: Omit<BrokerageOsShareLink, "id" | "createdAt">) => void;
  suggestPlan: (command: string) => { resolvedIntent: string; toolCalls: { tool: BrokerageOsToolName; input: Record<string, unknown> }[] };
}

const BrokerOsContext = createContext<BrokerOsContextValue | null>(null);

export function BrokerOsProvider({ children }: { children: ReactNode }) {
  const {
    clients,
    activeClientId,
    representationMode,
    allDeals,
    allDocuments,
    isAuthenticated,
    createDeal,
    updateDeal,
  } = useClientWorkspace();
  const [moduleSnapshots, setModuleSnapshots] = useState<ModuleSnapshots>(emptySnapshots);
  const [artifacts, setArtifacts] = useState<BrokerageOsArtifactsState>(defaultArtifactsState);
  const [sharedMarketInventory, setSharedMarketInventory] = useState<SharedMarketInventoryResponse | null>(null);

  const activeClientDeals = useMemo(
    () => allDeals.filter((deal) => deal.clientId === activeClientId),
    [allDeals, activeClientId],
  );
  const activeClientDocuments = useMemo(
    () => allDocuments.filter((doc) => doc.clientId === activeClientId),
    [allDocuments, activeClientId],
  );
  const workflowStages = useMemo(
    () => [...getWorkflowStagesForMode(representationMode)],
    [representationMode],
  );

  const appendActivity = useCallback((entry: Omit<BrokerageOsActivity, "id" | "createdAt">) => {
    setArtifacts((prev) => ({
      ...prev,
      activityLog: [{
        ...entry,
        id: nextId("activity"),
        createdAt: new Date().toISOString(),
      }, ...prev.activityLog].slice(0, 500),
    }));
  }, []);

  const appendChange = useCallback((entry: Omit<BrokerageOsChangeEvent, "id" | "createdAt">) => {
    setArtifacts((prev) => ({
      ...prev,
      changeLog: [{
        ...entry,
        id: nextId("change"),
        createdAt: new Date().toISOString(),
      }, ...prev.changeLog].slice(0, 500),
    }));
  }, []);

  const appendAudit = useCallback((entry: Omit<BrokerageOsAuditEvent, "id" | "createdAt">) => {
    setArtifacts((prev) => ({
      ...prev,
      auditTrail: [{
        ...entry,
        id: nextId("audit"),
        createdAt: new Date().toISOString(),
      }, ...prev.auditTrail].slice(0, 1000),
    }));
  }, []);

  const activeActor = useMemo(
    () => ({
      type: "user" as const,
      id: "workspace-user",
      name: "Workspace User",
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadSharedInventory() {
      try {
        const payload = await fetchSharedMarketInventory();
        if (!cancelled) setSharedMarketInventory(payload);
      } catch {
        if (!cancelled) setSharedMarketInventory(null);
      }
    }
    void loadSharedInventory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const clientId = asText(activeClientId);
    if (!clientId || typeof window === "undefined") {
      setModuleSnapshots(emptySnapshots());
      setArtifacts(defaultArtifactsState());
      return;
    }
    let cancelled = false;

    async function loadArtifacts() {
      const key = localStorageKey(BROKER_OS_ARTIFACTS_KEY, clientId);
      const localArtifacts = parseJson<BrokerageOsArtifactsState>(window.localStorage.getItem(key), defaultArtifactsState());
      if (!isAuthenticated) {
        if (!cancelled) setArtifacts(localArtifacts);
        return;
      }
      try {
        const remote = await fetchWorkspaceCloudSection(key);
        const parsed = preferLocalWhenRemoteEmpty(
          remote?.value && typeof remote.value === "object"
            ? (remote.value as BrokerageOsArtifactsState)
            : null,
          localArtifacts,
          (value) =>
            value.activityLog.length > 0
            || value.changeLog.length > 0
            || value.auditTrail.length > 0
            || value.exports.length > 0
            || value.shareLinks.length > 0,
        ) || localArtifacts;
        if (!cancelled) setArtifacts({
          activityLog: Array.isArray(parsed.activityLog) ? parsed.activityLog : [],
          changeLog: Array.isArray(parsed.changeLog) ? parsed.changeLog : [],
          auditTrail: Array.isArray(parsed.auditTrail) ? parsed.auditTrail : [],
          exports: Array.isArray(parsed.exports) ? parsed.exports : [],
          shareLinks: Array.isArray(parsed.shareLinks) ? parsed.shareLinks : [],
        });
      } catch {
        if (!cancelled) setArtifacts(localArtifacts);
      }
    }

    async function loadModuleSnapshots() {
      const surveysKey = localStorageKey(SURVEYS_STORAGE_KEY, clientId);
      const obligationsKey = localStorageKey(OBLIGATIONS_STORAGE_KEY, clientId);
      const completedKey = localStorageKey(COMPLETED_LEASES_STORAGE_KEY, clientId);
      const subleaseKey = localStorageKey(SUBLEASE_RECOVERY_STORAGE_KEY, clientId);
      const crmKey = localStorageKey(CRM_OS_STORAGE_KEY, clientId);

      const localSurveysRaw = parseJson<Record<string, unknown> | null>(window.localStorage.getItem(surveysKey), null);
      const localObligationsRaw = parseJson<Record<string, unknown> | null>(window.localStorage.getItem(obligationsKey), null);
      const localCompletedRaw = parseJson<Record<string, unknown> | null>(window.localStorage.getItem(completedKey), null);
      const localSubleaseRaw = parseJson<Record<string, unknown> | null>(window.localStorage.getItem(subleaseKey), null);
      const localCrmRaw = parseJson<Record<string, unknown> | null>(window.localStorage.getItem(crmKey), null);

      if (!isAuthenticated) {
        if (cancelled) return;
        setModuleSnapshots({
          surveys: parseModuleSnapshotValue("surveys", localSurveysRaw) as SurveyEntry[],
          obligations: parseModuleSnapshotValue("obligations", localObligationsRaw) as ObligationStorageState | null,
          completedLeaseDocuments: parseModuleSnapshotValue("completedLeaseDocuments", localCompletedRaw) as CompletedLeaseDocumentRecord[],
          subleaseScenarios: parseModuleSnapshotValue("subleaseScenarios", localSubleaseRaw) as SubleaseScenario[],
          crmState: parseModuleSnapshotValue("crmState", localCrmRaw) as CrmWorkspaceState | null,
        });
        return;
      }

      const loadRemoteSection = async (sectionKey: string, localValue: Record<string, unknown> | null) => {
        try {
          const remote = await fetchWorkspaceCloudSection(sectionKey);
          if (remote && typeof remote.value === "object") {
            return preferLocalWhenRemoteEmpty(
              remote.value as Record<string, unknown>,
              localValue,
              (value) =>
                Object.values(value).some((entry) => {
                  if (Array.isArray(entry)) return entry.length > 0;
                  if (entry && typeof entry === "object") return Object.keys(entry as Record<string, unknown>).length > 0;
                  return Boolean(String(entry || "").trim());
                }),
            );
          }
        } catch {
          // ignore and use local fallback
        }
        return localValue;
      };

      const [surveysRaw, obligationsRaw, completedRaw, subleaseRaw, crmRaw] = await Promise.all([
        loadRemoteSection(surveysKey, localSurveysRaw),
        loadRemoteSection(obligationsKey, localObligationsRaw),
        loadRemoteSection(completedKey, localCompletedRaw),
        loadRemoteSection(subleaseKey, localSubleaseRaw),
        loadRemoteSection(crmKey, localCrmRaw),
      ]);

      if (cancelled) return;
      setModuleSnapshots({
        surveys: parseModuleSnapshotValue("surveys", surveysRaw) as SurveyEntry[],
        obligations: parseModuleSnapshotValue("obligations", obligationsRaw) as ObligationStorageState | null,
        completedLeaseDocuments: parseModuleSnapshotValue("completedLeaseDocuments", completedRaw) as CompletedLeaseDocumentRecord[],
        subleaseScenarios: parseModuleSnapshotValue("subleaseScenarios", subleaseRaw) as SubleaseScenario[],
        crmState: parseModuleSnapshotValue("crmState", crmRaw) as CrmWorkspaceState | null,
      });
    }

    void loadArtifacts();
    void loadModuleSnapshots();
    return () => {
      cancelled = true;
    };
  }, [activeClientId, isAuthenticated]);

  useEffect(() => {
    if (!activeClientId || typeof window === "undefined") return;
    const clientId = activeClientId;
    const key = localStorageKey(BROKER_OS_ARTIFACTS_KEY, clientId);
    window.localStorage.setItem(key, JSON.stringify(artifacts));
    if (!isAuthenticated) return;
    void saveWorkspaceCloudSection(key, artifacts).catch(() => {
      // local fallback already saved
    });
  }, [activeClientId, artifacts, isAuthenticated]);

  const graph = useMemo<BrokerageOsEntityGraph>(() => {
    const activeClient = clients.find((client) => client.id === activeClientId);
    if (!activeClientId || !activeClient) {
      return {
        clients: [],
        deals: [],
        documents: [],
        companies: [],
        contacts: [],
        requirements: [],
        properties: [],
        spaces: [],
        surveys: [],
        surveyEntries: [],
        proposals: [],
        financialAnalyses: [],
        subleaseRecoveries: [],
        leases: [],
        amendments: [],
        leaseAbstracts: [],
        obligations: [],
        tasks: [],
        crmCompanies: [],
        crmBuildings: [],
        occupancyRecords: [],
        prospectingRecords: [],
        clientRelationshipRecords: [],
        crmTasks: [],
        crmTemplates: [],
        crmReminders: [],
        crmTouchpoints: [],
      };
    }

    const company: BrokerageOsCompany = {
      id: `company_${activeClient.id}`,
      clientId: activeClient.id,
      name: asText(activeClient.brokerage) || asText(activeClient.name) || "Client Company",
    };
    const contacts: BrokerageOsContact[] = [
      {
        id: `contact_${activeClient.id}`,
        clientId: activeClient.id,
        companyId: company.id,
        name: asText(activeClient.contactName) || `${activeClient.name} Contact`,
        email: asText(activeClient.contactEmail),
        role: "Client Contact",
      },
    ];
    const requirements = collectRequirements(activeClientDeals);
    const { properties, spaces } = buildBasePropertiesAndSpaces({
      clientId: activeClientId,
      documents: activeClientDocuments,
      surveys: moduleSnapshots.surveys,
      deals: activeClientDeals,
    });
    const proposals = buildProposals(activeClientDocuments);
    const { surveys, surveyEntries } = buildSurveys(activeClientId, moduleSnapshots.surveys);
    const { leases, amendments, leaseAbstracts } = buildLeasesAndAmendments(activeClientDocuments);
    const obligations = buildObligationsFromSnapshots({
      clientId: activeClientId,
      obligationsSnapshot: moduleSnapshots.obligations,
      leases,
    });
    const tasks = mapDealTasks(activeClientDeals);

    const financialAnalyses: BrokerageOsFinancialAnalysis[] = activeClientDocuments
      .filter((doc) => doc.type === "financial analyses")
      .map((doc) => ({
        id: `analysis_${doc.id}`,
        clientId: activeClientId,
        dealId: doc.dealId,
        sourceDocumentId: doc.id,
        name: doc.name,
        createdAt: doc.uploadedAt,
        status: "completed",
      }));

    const subleaseRecoveries: BrokerageOsSubleaseRecovery[] = moduleSnapshots.subleaseScenarios.map((scenario) => ({
      id: scenario.id,
      clientId: activeClientId,
      obligationId: scenario.clientId ? undefined : undefined,
      proposalIds: [],
      name: scenario.name,
      createdAt: new Date().toISOString(),
      status: "draft",
    }));
    const crmState = buildCrmWorkspaceState({
      clientId: activeClientId,
      clientName: activeClient.name,
      representationMode,
      sharedBuildings: sharedMarketInventory?.records,
      documents: activeClientDocuments,
      deals: activeClientDeals,
      properties,
      spaces,
      obligations,
      surveys,
      surveyEntries,
      financialAnalyses,
      leaseAbstracts: [
        ...leaseAbstracts,
        ...moduleSnapshots.completedLeaseDocuments.map((record) => ({
          id: `abstract_record_${record.id}`,
          name: `${record.fileName} Abstract`,
          documentId: undefined,
          createdAt: record.uploadedAtIso,
        })),
      ],
      existingState: moduleSnapshots.crmState || emptyCrmWorkspaceState(representationMode),
    });

    const documents = activeClientDocuments.map((doc) => {
      const cls = classifyDocument({
        fileName: doc.name,
        sourceModule: doc.sourceModule,
        snapshot: doc.normalizeSnapshot,
      });
      const extracted = extractEntitiesFromCanonical(doc.normalizeSnapshot?.canonical_lease);
      const linkedEntityIds: string[] = [];
      for (const deal of activeClientDeals) {
        if (deal.linkedDocumentIds.includes(doc.id) || doc.dealId === deal.id) linkedEntityIds.push(deal.id);
      }
      return {
        ...doc,
        classification: cls.classification,
        parsedData: doc.normalizeSnapshot?.canonical_lease
          ? (doc.normalizeSnapshot.canonical_lease as unknown as Record<string, unknown>)
          : undefined,
        extractedEntities: extracted as unknown as Record<string, unknown>,
        linkedEntityIds,
      };
    });

    for (const doc of documents) {
      if (!doc.classification) continue;
      const suggestedStage = inferWorkflowStageFromDocumentType(doc.type);
      if (!suggestedStage) continue;
      for (const deal of activeClientDeals) {
        if (!deal.linkedDocumentIds.includes(doc.id) && doc.dealId !== deal.id) continue;
      }
    }

    return {
      clients: [activeClient],
      deals: activeClientDeals,
      documents,
      companies: [company],
      contacts,
      requirements,
      properties,
      spaces,
      surveys,
      surveyEntries,
      proposals,
      financialAnalyses,
      subleaseRecoveries,
      leases,
      amendments,
      leaseAbstracts: [
        ...leaseAbstracts,
        ...moduleSnapshots.completedLeaseDocuments.map((record) => ({
          id: `abstract_record_${record.id}`,
          clientId: activeClientId,
          leaseId: `lease_${record.linkedLeaseId || "unknown"}`,
          amendmentIds: [],
          documentId: undefined,
          name: `${record.fileName} Abstract`,
          createdAt: record.uploadedAtIso,
        })),
      ],
      obligations,
      tasks,
      crmCompanies: crmState.companies,
      crmBuildings: crmState.buildings,
      occupancyRecords: crmState.occupancyRecords,
      prospectingRecords: crmState.prospectingRecords,
      clientRelationshipRecords: crmState.clientRelationshipRecords,
      crmTasks: crmState.tasks,
      crmTemplates: crmState.templates,
      crmReminders: crmState.reminders,
      crmTouchpoints: crmState.touchpoints,
    };
  }, [clients, activeClientId, activeClientDeals, activeClientDocuments, moduleSnapshots, representationMode, sharedMarketInventory?.records]);

  const transitionDealStage = useCallback((dealId: string, nextStage: string, source: "user" | "ai" | "automation", reason = ""): BrokerageOsToolResult => {
    const targetDeal = activeClientDeals.find((deal) => deal.id === dealId);
    if (!targetDeal) {
      return { tool: "updateDealStage", ok: false, message: "Deal not found." };
    }
    const decision = getWorkflowTransitionDecision({
      currentStage: targetDeal.stage,
      targetStage: nextStage,
      allowReverse: source === "ai",
      workflowStages,
    });
    if (!decision.allowed) {
      return { tool: "updateDealStage", ok: false, message: decision.reason };
    }
    const nowIso = new Date().toISOString();
    updateDeal(targetDeal.id, {
      stage: decision.toStage,
      status: decision.autoStatus || targetDeal.status,
      timeline: [
        {
          id: nextId("deal_activity"),
          clientId: targetDeal.clientId,
          dealId: targetDeal.id,
          label: "Workflow transition",
          description: buildWorkflowTransitionLabel({
            dealId: targetDeal.id,
            clientId: targetDeal.clientId,
            fromStage: targetDeal.stage,
            toStage: decision.toStage,
            actor: source === "ai" ? { type: "ai", id: "broker-ai", name: "Broker AI" } : activeActor,
            source,
            createdAt: nowIso,
            reason: reason || decision.reason,
          }),
          createdAt: nowIso,
        },
        ...targetDeal.timeline,
      ].slice(0, 100),
    });
    appendActivity({
      clientId: targetDeal.clientId,
      dealId: targetDeal.id,
      category: "workflow",
      label: "Deal stage updated",
      description: `${targetDeal.stage} -> ${decision.toStage}${reason ? ` (${reason})` : ""}`,
      actor: source === "ai" ? { type: "ai", id: "broker-ai", name: "Broker AI" } : activeActor,
    });
    appendChange({
      clientId: targetDeal.clientId,
      entityType: "deal",
      entityId: targetDeal.id,
      field: "stage",
      before: targetDeal.stage,
      after: decision.toStage,
      actor: source === "ai" ? { type: "ai", id: "broker-ai", name: "Broker AI" } : activeActor,
    });
    appendAudit({
      clientId: targetDeal.clientId,
      action: "deal.stage.transition",
      actor: source === "ai" ? { type: "ai", id: "broker-ai", name: "Broker AI" } : activeActor,
      payload: {
        dealId: targetDeal.id,
        from: targetDeal.stage,
        to: decision.toStage,
        reason: reason || decision.reason,
      },
    });
    return {
      tool: "updateDealStage",
      ok: true,
      message: `Moved ${targetDeal.dealName} to ${decision.toStage}.`,
      data: { dealId: targetDeal.id, stage: decision.toStage },
    };
  }, [activeClientDeals, workflowStages, updateDeal, appendActivity, appendChange, appendAudit, activeActor]);

  const createTaskForDeal = useCallback((dealId: string, title: string, dueDate = ""): BrokerageOsToolResult => {
    const target = activeClientDeals.find((deal) => deal.id === dealId);
    const taskTitle = asText(title);
    if (!target) return { tool: "createTask", ok: false, message: "Deal not found." };
    if (!taskTitle) return { tool: "createTask", ok: false, message: "Task title is required." };
    const nowIso = new Date().toISOString();
    const task = {
      id: nextId("deal_task"),
      clientId: target.clientId,
      dealId: target.id,
      title: taskTitle,
      dueDate: asText(dueDate),
      completed: false,
      createdAt: nowIso,
    };
    updateDeal(target.id, {
      tasks: [task, ...target.tasks].slice(0, 100),
      timeline: [{
        id: nextId("deal_activity"),
        clientId: target.clientId,
        dealId: target.id,
        label: "Task added",
        description: taskTitle,
        createdAt: nowIso,
      }, ...target.timeline].slice(0, 100),
    });
    appendActivity({
      clientId: target.clientId,
      dealId: target.id,
      category: "task",
      label: "Task created",
      description: taskTitle,
      actor: activeActor,
    });
    appendAudit({
      clientId: target.clientId,
      action: "task.create",
      actor: activeActor,
      payload: { dealId: target.id, title: taskTitle, dueDate: asText(dueDate) },
    });
    return { tool: "createTask", ok: true, message: `Task added to ${target.dealName}.`, data: { taskId: task.id } };
  }, [activeClientDeals, updateDeal, appendActivity, appendAudit, activeActor]);

  const recordExport = useCallback((input: Omit<BrokerageOsExport, "id" | "createdAt">) => {
    const record: BrokerageOsExport = {
      ...input,
      id: nextId("export"),
      createdAt: new Date().toISOString(),
    };
    setArtifacts((prev) => ({
      ...prev,
      exports: [record, ...prev.exports].slice(0, 300),
    }));
    appendActivity({
      clientId: input.clientId,
      dealId: input.dealId,
      category: "export",
      label: `${input.format.toUpperCase()} export`,
      description: input.label,
      actor: activeActor,
    });
  }, [appendActivity, activeActor]);

  const recordShareLink = useCallback((input: Omit<BrokerageOsShareLink, "id" | "createdAt">) => {
    const record: BrokerageOsShareLink = {
      ...input,
      id: nextId("share"),
      createdAt: new Date().toISOString(),
    };
    setArtifacts((prev) => ({
      ...prev,
      shareLinks: [record, ...prev.shareLinks].slice(0, 300),
    }));
    appendActivity({
      clientId: input.clientId,
      dealId: input.dealId,
      category: "share",
      label: "Share link created",
      description: input.label,
      actor: activeActor,
    });
  }, [appendActivity, activeActor]);

  const executeTool = useCallback(async (tool: BrokerageOsToolName, input: Record<string, unknown>): Promise<BrokerageOsToolResult> => {
    const clientId = asText(activeClientId);
    if (!clientId) return { tool, ok: false, message: "Active client is required." };

    if (tool === "createDeal") {
      const fallbackName = `Deal ${new Date().toLocaleDateString()}`;
      const fromCommand = asText(input.command);
      const parsedName = (() => {
        const quoted = fromCommand.match(/"([^"]+)"/);
        if (quoted && quoted[1]) return quoted[1].trim();
        const named = fromCommand.match(/deal\s+(?:named|for)\s+(.+)$/i);
        if (named && named[1]) return named[1].trim();
        return "";
      })();
      const created = createDeal({
        clientId,
        dealName: parsedName || fallbackName,
        stage: workflowStages[0],
        status: "open",
      });
      if (!created) return { tool, ok: false, message: "Unable to create deal." };
      appendActivity({
        clientId,
        dealId: created.id,
        category: "ai",
        label: "AI created deal",
        description: created.dealName,
        actor: { type: "ai", id: "broker-ai", name: "Broker AI" },
      });
      appendAudit({
        clientId,
        action: "ai.createDeal",
        actor: { type: "ai", id: "broker-ai", name: "Broker AI" },
        payload: { dealId: created.id, dealName: created.dealName },
      });
      return { tool, ok: true, message: `Created deal ${created.dealName}.`, data: { dealId: created.id } };
    }

    if (tool === "updateDealStage") {
      const command = normalize(input.command);
      const targetStage = workflowStages.find((stage) => command.includes(normalize(stage)));
      if (!targetStage) return { tool, ok: false, message: "No target stage detected in command." };
      const deal = activeClientDeals[0];
      if (!deal) return { tool, ok: false, message: "No deals found for active client." };
      return transitionDealStage(deal.id, targetStage, "ai", "AI command");
    }

    if (tool === "createTask") {
      const deal = activeClientDeals[0];
      if (!deal) return { tool, ok: false, message: "No deal found to attach task." };
      const command = asText(input.command);
      const taskTitle = command.replace(/^.*task/i, "").trim() || "Follow up";
      return createTaskForDeal(deal.id, taskTitle);
    }

    if (tool === "compareProposals") {
      const proposals = graph.proposals;
      if (proposals.length === 0) return { tool, ok: false, message: "No proposal documents found." };
      const ranked = [...proposals].sort((a, b) => (a.annualRatePsf || Number.MAX_SAFE_INTEGER) - (b.annualRatePsf || Number.MAX_SAFE_INTEGER));
      const best = ranked[0];
      const message = best
        ? `Best proposal by annual rate is ${best.documentId} at ${best.annualRatePsf.toFixed(2)} $/SF/YR.`
        : "No comparable proposal rates found.";
      appendActivity({
        clientId,
        category: "ai",
        label: "AI compared proposals",
        description: message,
        actor: { type: "ai", id: "broker-ai", name: "Broker AI" },
      });
      return {
        tool,
        ok: true,
        message,
        data: {
          rankedProposalIds: ranked.map((item) => item.id),
        },
      };
    }

    if (tool === "classifyDocument") {
      const first = activeClientDocuments[0];
      if (!first) return { tool, ok: false, message: "No documents available for classification." };
      const cls = classifyDocument({
        fileName: first.name,
        sourceModule: first.sourceModule,
        snapshot: first.normalizeSnapshot,
      });
      return { tool, ok: true, message: `Classified ${first.name} as ${cls.type}.`, data: { documentId: first.id, type: cls.type } };
    }

    if (tool === "extractTermsFromDocument") {
      const first = activeClientDocuments.find((doc) => doc.normalizeSnapshot?.canonical_lease);
      if (!first) return { tool, ok: false, message: "No parsed document available." };
      const extracted = extractEntitiesFromCanonical(first.normalizeSnapshot?.canonical_lease);
      return { tool, ok: true, message: "Extracted terms from document.", data: extracted as unknown as Record<string, unknown> };
    }

    if (tool === "generateClientSummary") {
      const openDeals = graph.deals.filter((deal) => normalize(deal.status) === "open").length;
      const executedDeals = graph.deals.filter((deal) => normalize(deal.stage) === "executed").length;
      const focus = normalize(input.focus);
      const isLandlordMode = representationMode === LANDLORD_REP_MODE;
      const representationProfile = getRepresentationModeProfile(representationMode);
      const proposalCount = graph.proposals.length;
      const tourCount = graph.deals.filter((deal) => normalize(deal.stage).includes("tour")).length;
      const summary = isLandlordMode
        ? (
          focus.includes("availability") || focus.includes("listing")
            ? `Portfolio has ${graph.properties.length} propert${graph.properties.length === 1 ? "y" : "ies"}, ${graph.spaces.length} tracked space${graph.spaces.length === 1 ? "" : "s"}, ${proposalCount} proposal record${proposalCount === 1 ? "" : "s"}, and ${graph.documents.length} listing document${graph.documents.length === 1 ? "" : "s"}.`
            : `Portfolio has ${graph.deals.length} inquiry record${graph.deals.length === 1 ? "" : "s"}, ${tourCount} active tour stage item${tourCount === 1 ? "" : "s"}, ${proposalCount} proposal item${proposalCount === 1 ? "" : "s"}, and ${executedDeals} executed deal${executedDeals === 1 ? "" : "s"}.`
        )
        : `Client has ${graph.deals.length} deal(s), ${openDeals} open, ${executedDeals} executed, ${graph.documents.length} document(s), ${graph.obligations.length} obligation(s), and ${graph.surveyEntries.length} survey option(s).`;
      const framedSummary = `${representationProfile.summary} ${summary}`;
      return { tool, ok: true, message: framedSummary, data: { summary: framedSummary } };
    }

    if (tool === "exportPdf") {
      recordExport({
        clientId,
        module: "financial-analyses",
        format: "pdf",
        label: asText(input.command) || "AI PDF Export",
      });
      return { tool, ok: true, message: "Recorded PDF export request." };
    }

    if (tool === "exportExcel") {
      recordExport({
        clientId,
        module: "financial-analyses",
        format: "excel",
        label: asText(input.command) || "AI Excel Export",
      });
      return { tool, ok: true, message: "Recorded Excel export request." };
    }

    if (tool === "createShareLink") {
      const url = `${typeof window !== "undefined" ? window.location.origin : "https://thecremodel.com"}/?module=financial-analyses`;
      recordShareLink({
        clientId,
        module: "financial-analyses",
        label: asText(input.command) || "AI generated share link",
        url,
      });
      return { tool, ok: true, message: "Share link recorded.", data: { url } };
    }

    if (tool === "createSurvey") {
      appendActivity({
        clientId,
        category: "survey",
        label: "AI created survey workspace",
        description: "Survey workspace initialized from AI command.",
        actor: { type: "ai", id: "broker-ai", name: "Broker AI" },
      });
      return { tool, ok: true, message: "Survey workflow initialized." };
    }

    if (tool === "addSurveyEntriesFromDocuments") {
      const docs = activeClientDocuments.filter((doc) => doc.type === "surveys" || doc.type === "flyers" || doc.type === "floorplans");
      if (docs.length === 0) return { tool, ok: false, message: "No survey source documents found." };
      const seedEntries: SurveyEntry[] = docs.map((doc) => {
        const canonical = doc.normalizeSnapshot?.canonical_lease;
        return {
          id: nextId("survey_entry"),
          clientId,
          sourceDocumentName: doc.name,
          sourceType: "parsed_document",
          uploadedAtIso: new Date().toISOString(),
          buildingName: asText(canonical?.building_name || doc.building),
          address: asText(canonical?.address || doc.address),
          floor: asText(canonical?.floor),
          suite: asText(canonical?.suite || doc.suite),
          availableSqft: Number(canonical?.rsf) || 0,
          baseRentPsfAnnual: Number(canonical?.rent_schedule?.[0]?.rent_psf_annual) || 0,
          opexPsfAnnual: Number(canonical?.opex_base_year_psf) || 0,
          leaseType: "Unknown",
          occupancyType: "Unknown",
          sublessor: "",
          subleaseExpirationDate: "",
          parkingSpaces: Number(canonical?.parking_count) || 0,
          parkingRateMonthlyPerSpace: Number(canonical?.parking_rate_monthly_per_space) || 0,
          notes: "Generated by AI orchestration.",
          needsReview: true,
          reviewReasons: ["Verify extracted survey terms."],
          reviewTasks: [],
          fieldConfidence: {},
          rawCanonical: canonical,
          rawNormalize: undefined,
        };
      });
      const surveysSectionKey = localStorageKey(SURVEYS_STORAGE_KEY, clientId);
      const existing = typeof window !== "undefined"
        ? parseJson<{ entries?: SurveyEntry[]; selectedId?: string }>(window.localStorage.getItem(surveysSectionKey), { entries: [] })
        : { entries: [] as SurveyEntry[] };
      const merged = [...seedEntries, ...(existing.entries || [])];
      const payload = { entries: merged, selectedId: merged[0]?.id || "" };
      if (typeof window !== "undefined") window.localStorage.setItem(surveysSectionKey, JSON.stringify(payload));
      if (isAuthenticated) {
        void saveWorkspaceCloudSection(surveysSectionKey, payload).catch(() => {
          // local fallback already saved
        });
      }
      setModuleSnapshots((prev) => ({ ...prev, surveys: merged }));
      return { tool, ok: true, message: `Added ${seedEntries.length} survey entr${seedEntries.length === 1 ? "y" : "ies"} from documents.` };
    }

    if (tool === "createFinancialAnalysis") {
      appendActivity({
        clientId,
        category: "analysis",
        label: "AI created financial analysis",
        description: asText(input.command) || "Financial analysis initialized.",
        actor: { type: "ai", id: "broker-ai", name: "Broker AI" },
      });
      return { tool, ok: true, message: "Financial analysis workflow initialized." };
    }

    if (tool === "createSubleaseRecovery") {
      appendActivity({
        clientId,
        category: "analysis",
        label: "AI created sublease recovery",
        description: asText(input.command) || "Sublease recovery initialized.",
        actor: { type: "ai", id: "broker-ai", name: "Broker AI" },
      });
      return { tool, ok: true, message: "Sublease recovery workflow initialized." };
    }

    if (tool === "createLeaseAbstract") {
      const leaseDoc = activeClientDocuments.find((doc) => doc.type === "leases");
      if (!leaseDoc) return { tool, ok: false, message: "No lease document available." };
      appendActivity({
        clientId,
        category: "lease",
        label: "AI created lease abstract",
        description: `Created abstract from ${leaseDoc.name}.`,
        actor: { type: "ai", id: "broker-ai", name: "Broker AI" },
      });
      return { tool, ok: true, message: `Lease abstract created from ${leaseDoc.name}.` };
    }

    if (tool === "updateObligationFromLease") {
      const leaseDoc = activeClientDocuments.find((doc) => doc.type === "leases" || doc.type === "amendments");
      if (!leaseDoc) return { tool, ok: false, message: "No lease/amendment document found." };
      appendActivity({
        clientId,
        category: "obligation",
        label: "AI updated obligations",
        description: `Updated obligations from ${leaseDoc.name}.`,
        actor: { type: "ai", id: "broker-ai", name: "Broker AI" },
      });
      return { tool, ok: true, message: `Obligation update queued from ${leaseDoc.name}.` };
    }

    if (tool === "summarizeAmendmentChanges") {
      const amendmentDoc = activeClientDocuments.find((doc) => doc.type === "amendments");
      if (!amendmentDoc) return { tool, ok: false, message: "No amendment document found." };
      const summary =
        asText(amendmentDoc.normalizeSnapshot?.extraction_summary?.document_type_detected)
        || asText(amendmentDoc.normalizeSnapshot?.warnings?.[0] || "")
        || "Amendment summary unavailable.";
      return { tool, ok: true, message: summary, data: { documentId: amendmentDoc.id } };
    }

    if (tool === "linkDocumentToEntities") {
      const firstDoc = activeClientDocuments[0];
      const firstDeal = activeClientDeals[0];
      if (!firstDoc || !firstDeal) return { tool, ok: false, message: "Need at least one deal and one document." };
      if (!firstDeal.linkedDocumentIds.includes(firstDoc.id)) {
        updateDeal(firstDeal.id, {
          linkedDocumentIds: Array.from(new Set([firstDoc.id, ...firstDeal.linkedDocumentIds])),
        });
      }
      return { tool, ok: true, message: `Linked ${firstDoc.name} to deal ${firstDeal.dealName}.` };
    }

    return { tool, ok: true, message: `${tool} executed.` };
  }, [
    activeClientId,
    activeClientDeals,
    activeClientDocuments,
    workflowStages,
    representationMode,
    appendActivity,
    appendAudit,
    createDeal,
    createTaskForDeal,
    graph,
    isAuthenticated,
    recordExport,
    recordShareLink,
    transitionDealStage,
    updateDeal,
  ]);

  const runAiCommand = useCallback(async (command: string): Promise<BrokerageOsAiExecutionResult> => {
    const result = await runAiCommandPlan({
      command,
      graph,
      representationMode,
      executeTool: async (
        tool: BrokerageOsToolName,
        input: Record<string, unknown>,
        _context: AiToolExecutionContext,
      ) => executeTool(tool, input),
    });
    const clientId = asText(activeClientId);
    if (clientId) {
      appendActivity({
        clientId,
        category: "ai",
        label: "AI command executed",
        description: result.command,
        actor: { type: "ai", id: "broker-ai", name: "Broker AI" },
      });
      appendAudit({
        clientId,
        action: "ai.command.run",
        actor: { type: "ai", id: "broker-ai", name: "Broker AI" },
        payload: {
          command: result.command,
          resolvedIntent: result.resolvedIntent,
          toolCalls: result.toolCalls,
          results: result.results,
        },
      });
    }
    return result;
  }, [graph, executeTool, activeClientId, appendActivity, appendAudit, representationMode]);

  const value = useMemo<BrokerOsContextValue>(() => ({
    graph,
    workflowStages,
    artifacts,
    runAiCommand,
    executeTool,
    transitionDealStage,
    createTaskForDeal,
    recordExport,
    recordShareLink,
    suggestPlan: (command) => suggestToolPlan(command, { representationMode }),
  }), [
    graph,
    workflowStages,
    artifacts,
    runAiCommand,
    executeTool,
    transitionDealStage,
    createTaskForDeal,
    recordExport,
    recordShareLink,
    representationMode,
  ]);

  return <BrokerOsContext.Provider value={value}>{children}</BrokerOsContext.Provider>;
}

export function useBrokerOs() {
  const context = useContext(BrokerOsContext);
  if (!context) throw new Error("useBrokerOs must be used within BrokerOsProvider");
  return context;
}
