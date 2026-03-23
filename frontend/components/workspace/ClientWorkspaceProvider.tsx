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
import {
  getSession,
  getSessionFromStorage,
  signOut,
  subscribeAuthSession,
  type SupabaseAuthSession,
} from "@/lib/supabase";
import type { BackendCanonicalLease, NormalizerResponse } from "@/lib/types";
import {
  ACTIVE_CLIENT_STORAGE_KEY,
  CLIENTS_STORAGE_KEY,
  CRM_SETTINGS_STORAGE_KEY,
  DEAL_LIBRARY_STORAGE_KEY,
  DEAL_STAGE_CONFIG_STORAGE_KEY,
  DOCUMENT_LIBRARY_STORAGE_KEY,
  REPRESENTATION_MODE_STORAGE_KEY,
} from "@/lib/workspace/storage";
import { buildWorkspaceEntityGraph, type WorkspaceEntityGraph } from "@/lib/workspace/entities";
import { inferWorkspaceDocumentType } from "@/lib/workspace/document-type";
import { getDealDocumentStageTransition } from "@/lib/workspace/deal-stage-automation";
import { fetchWorkspaceCloudState, saveWorkspaceCloudState } from "@/lib/workspace/cloud";
import { normalizeRepresentationMode, type RepresentationMode } from "@/lib/workspace/representation-mode";
import {
  CLIENT_DOCUMENT_TYPES,
  DEFAULT_DEAL_STAGES,
  getDefaultDealStagesForMode,
  normalizeCrmSettings,
  type ClientCrmSettings,
} from "@/lib/workspace/types";
import type {
  ClientWorkspaceDeal,
  ClientDocumentSourceModule,
  ClientDocumentType,
  ClientWorkspaceClient,
  ClientWorkspaceDocument,
  CreateDealInput,
  CreateClientInput,
  DocumentNormalizeSnapshot,
  RegisterClientDocumentInput,
  UpdateDealInput,
  UpdateClientInput,
  UpdateClientDocumentInput,
} from "@/lib/workspace/types";

type CloudSyncStatus = "local" | "idle" | "saving" | "synced" | "error";

interface ClientWorkspaceContextValue {
  ready: boolean;
  session: SupabaseAuthSession | null;
  isAuthenticated: boolean;
  cloudSyncStatus: CloudSyncStatus;
  cloudSyncMessage: string;
  cloudLastSyncedAt: string | null;
  representationMode: RepresentationMode | null;
  clients: ClientWorkspaceClient[];
  activeClientId: string | null;
  activeClient: ClientWorkspaceClient | null;
  allDeals: ClientWorkspaceDeal[];
  deals: ClientWorkspaceDeal[];
  dealStages: string[];
  crmSettings: ClientCrmSettings;
  documents: ClientWorkspaceDocument[];
  allDocuments: ClientWorkspaceDocument[];
  entityGraph: WorkspaceEntityGraph;
  setActiveClient: (clientId: string) => void;
  setRepresentationMode: (mode: RepresentationMode) => void;
  createClient: (input: CreateClientInput) => ClientWorkspaceClient | null;
  updateClient: (clientId: string, input: UpdateClientInput) => void;
  createDeal: (input: CreateDealInput) => ClientWorkspaceDeal | null;
  updateDeal: (dealId: string, input: UpdateDealInput) => void;
  removeDeal: (dealId: string) => void;
  setDealStages: (stages: string[], clientId?: string | null) => void;
  getDealsForClient: (clientId?: string | null) => ClientWorkspaceDeal[];
  getDealStagesForClient: (clientId?: string | null) => string[];
  setCrmSettings: (settings: Partial<ClientCrmSettings>, clientId?: string | null) => void;
  getCrmSettingsForClient: (clientId?: string | null) => ClientCrmSettings;
  registerDocument: (input: RegisterClientDocumentInput) => Promise<ClientWorkspaceDocument | null>;
  updateDocument: (documentId: string, input: UpdateClientDocumentInput) => void;
  removeDocument: (documentId: string) => void;
  getDocumentsForClient: (clientId?: string | null) => ClientWorkspaceDocument[];
}

const ClientWorkspaceContext = createContext<ClientWorkspaceContextValue | null>(null);

function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function asText(value: unknown): string {
  return String(value || "").trim();
}

function hasOwnKey<T extends object, K extends PropertyKey>(obj: T, key: K): obj is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function asCanonical(normalize: unknown): BackendCanonicalLease | null {
  if (!normalize || typeof normalize !== "object") return null;
  const maybe = (normalize as { canonical_lease?: unknown }).canonical_lease;
  if (!maybe || typeof maybe !== "object") return null;
  return maybe as BackendCanonicalLease;
}

function sameSession(a: SupabaseAuthSession | null, b: SupabaseAuthSession | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.access_token === b.access_token && a.user.id === b.user.id;
}

function toNormalizeSnapshot(
  normalize: NormalizerResponse | DocumentNormalizeSnapshot | null | undefined,
): DocumentNormalizeSnapshot | undefined {
  if (!normalize || typeof normalize !== "object") return undefined;

  if ("canonical_lease" in normalize && normalize.canonical_lease) {
    return {
      canonical_lease: normalize.canonical_lease,
      extraction_summary: "extraction_summary" in normalize ? normalize.extraction_summary : undefined,
      review_tasks: "review_tasks" in normalize ? normalize.review_tasks : undefined,
      field_confidence: "field_confidence" in normalize ? normalize.field_confidence : undefined,
      warnings: "warnings" in normalize ? normalize.warnings : undefined,
      confidence_score: "confidence_score" in normalize ? normalize.confidence_score : undefined,
      option_variants: "option_variants" in normalize ? normalize.option_variants : undefined,
    };
  }

  return undefined;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to generate preview"));
    reader.readAsDataURL(file);
  });
}

async function maybeBuildPreview(file?: File | null): Promise<string | undefined> {
  if (!file) return undefined;
  const fileName = asText(file.name).toLowerCase();
  const canPreview = file.type.startsWith("image/") || file.type === "application/pdf" || fileName.endsWith(".pdf");
  if (!canPreview) return undefined;
  const previewSizeLimit = file.type === "application/pdf" || fileName.endsWith(".pdf") ? 12_000_000 : 2_500_000;
  if (file.size > previewSizeLimit) return undefined;
  try {
    return await readDataUrl(file);
  } catch {
    return undefined;
  }
}

function parseStoredClients(raw: string | null): ClientWorkspaceClient[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ClientWorkspaceClient[] = [];
    for (const item of parsed) {
      const obj = item as Partial<ClientWorkspaceClient>;
      const name = asText(obj.name);
      const id = asText(obj.id);
      if (!name || !id) continue;
      out.push({
        id,
        name,
        companyType: asText(obj.companyType),
        industry: asText(obj.industry),
        contactName: asText(obj.contactName),
        contactEmail: asText(obj.contactEmail),
        brokerage: asText(obj.brokerage),
        notes: asText(obj.notes),
        createdAt: asText(obj.createdAt) || new Date().toISOString(),
        logoDataUrl: asText(obj.logoDataUrl) || undefined,
        logoFileName: asText(obj.logoFileName) || undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function parseStoredDocuments(raw: string | null): ClientWorkspaceDocument[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ClientWorkspaceDocument[] = [];
    for (const item of parsed) {
      const obj = item as Partial<ClientWorkspaceDocument>;
      const id = asText(obj.id);
      const clientId = asText(obj.clientId);
      const name = asText(obj.name);
      if (!id || !clientId || !name) continue;
      const previewDataUrl = asText(obj.previewDataUrl);
      const normalizeSnapshot = toNormalizeSnapshot(obj.normalizeSnapshot);
      const sourceModule = (asText(obj.sourceModule) as ClientDocumentSourceModule) || "document-center";
      const inferredType = inferWorkspaceDocumentType(name, sourceModule, normalizeSnapshot);
      const storedType = asText(obj.type) as ClientDocumentType;
      const normalizedType: ClientDocumentType =
        storedType === "sublease documents" && inferredType === "proposals"
          ? "proposals"
          : (storedType || inferredType || "other");
      const nextDoc: ClientWorkspaceDocument = {
        id,
        clientId,
        companyId: asText(obj.companyId) || undefined,
        dealId: asText(obj.dealId) || undefined,
        name,
        type: normalizedType,
        building: asText(obj.building),
        address: asText(obj.address),
        suite: asText(obj.suite),
        parsed: Boolean(obj.parsed),
        uploadedBy: asText(obj.uploadedBy) || "User",
        uploadedAt: asText(obj.uploadedAt) || new Date().toISOString(),
        sourceModule,
        ...(previewDataUrl ? { previewDataUrl } : {}),
        ...(normalizeSnapshot ? { normalizeSnapshot } : {}),
      };
      out.push(nextDoc);
    }
    return out;
  } catch {
    return [];
  }
}

function parseStoredDeals(raw: string | null): ClientWorkspaceDeal[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): ClientWorkspaceDeal | null => {
        const obj = item as Partial<ClientWorkspaceDeal>;
        const id = asText(obj.id);
        const clientId = asText(obj.clientId);
        const dealName = asText(obj.dealName);
        if (!id || !clientId || !dealName) return null;
        const nowIso = new Date().toISOString();
        return {
          id,
          clientId,
          companyId: asText(obj.companyId) || undefined,
          dealName,
          requirementName: asText(obj.requirementName),
          dealType: asText(obj.dealType),
          stage: asText(obj.stage) || DEFAULT_DEAL_STAGES[0],
          status: (asText(obj.status) as ClientWorkspaceDeal["status"]) || "open",
          priority: (asText(obj.priority) as ClientWorkspaceDeal["priority"]) || "medium",
          targetMarket: asText(obj.targetMarket),
          submarket: asText(obj.submarket),
          city: asText(obj.city),
          squareFootageMin: Number(obj.squareFootageMin) || 0,
          squareFootageMax: Number(obj.squareFootageMax) || 0,
          budget: Number(obj.budget) || 0,
          occupancyDateGoal: asText(obj.occupancyDateGoal),
          expirationDate: asText(obj.expirationDate),
          selectedProperty: asText(obj.selectedProperty),
          selectedSuite: asText(obj.selectedSuite),
          selectedLandlord: asText(obj.selectedLandlord),
          tenantRepBroker: asText(obj.tenantRepBroker),
          notes: asText(obj.notes),
          linkedSurveyIds: Array.isArray(obj.linkedSurveyIds) ? obj.linkedSurveyIds.map((id) => asText(id)).filter(Boolean) : [],
          linkedAnalysisIds: Array.isArray(obj.linkedAnalysisIds) ? obj.linkedAnalysisIds.map((id) => asText(id)).filter(Boolean) : [],
          linkedDocumentIds: Array.isArray(obj.linkedDocumentIds) ? obj.linkedDocumentIds.map((id) => asText(id)).filter(Boolean) : [],
          linkedObligationIds: Array.isArray(obj.linkedObligationIds) ? obj.linkedObligationIds.map((id) => asText(id)).filter(Boolean) : [],
          linkedLeaseAbstractIds: Array.isArray(obj.linkedLeaseAbstractIds) ? obj.linkedLeaseAbstractIds.map((id) => asText(id)).filter(Boolean) : [],
          timeline: Array.isArray(obj.timeline) ? obj.timeline : [],
          tasks: Array.isArray(obj.tasks) ? obj.tasks : [],
          createdAt: asText(obj.createdAt) || nowIso,
          updatedAt: asText(obj.updatedAt) || nowIso,
        } satisfies ClientWorkspaceDeal;
      })
      .filter((item): item is ClientWorkspaceDeal => !!item);
  } catch {
    return [];
  }
}

function normalizeDealStages(
  rawStages: unknown,
  mode: RepresentationMode | null | undefined = null,
): string[] {
  const normalized = (Array.isArray(rawStages) ? rawStages : [])
    .map((item) => asText(item))
    .filter(Boolean);
  const deduped = Array.from(new Set(normalized));
  if (deduped.length > 0) return deduped;
  return [...getDefaultDealStagesForMode(mode)];
}

function parseStoredDealStageMap(
  raw: string | null,
  mode: RepresentationMode | null | undefined = null,
): Record<string, string[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string[]> = {};
    for (const [clientId, stageList] of Object.entries(parsed as Record<string, unknown>)) {
      const key = asText(clientId);
      if (!key) continue;
      out[key] = normalizeDealStages(stageList, mode);
    }
    return out;
  } catch {
    return {};
  }
}

function parseStoredCrmSettingsMap(
  raw: string | null,
  mode: RepresentationMode | null | undefined = null,
): Record<string, ClientCrmSettings> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, ClientCrmSettings> = {};
    for (const [clientId, settings] of Object.entries(parsed as Record<string, unknown>)) {
      const key = asText(clientId);
      if (!key) continue;
      out[key] = normalizeCrmSettings(settings, mode);
    }
    return out;
  } catch {
    return {};
  }
}

function isSameStageSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => asText(value).toLowerCase() === asText(b[index]).toLowerCase());
}

function isDefaultStageSet(stages: readonly string[]): boolean {
  return isSameStageSet(stages, getDefaultDealStagesForMode("tenant_rep"))
    || isSameStageSet(stages, getDefaultDealStagesForMode("landlord_rep"));
}

function seedDealStagesForClients(
  clients: ClientWorkspaceClient[],
  existingMap: Record<string, string[]>,
  mode: RepresentationMode | null | undefined,
): Record<string, string[]> {
  const defaults = [...getDefaultDealStagesForMode(mode)];
  const next: Record<string, string[]> = { ...existingMap };
  for (const client of clients) {
    const current = Array.isArray(next[client.id]) ? normalizeDealStages(next[client.id], mode) : [];
    if (current.length === 0 || isDefaultStageSet(current)) {
      next[client.id] = [...defaults];
      continue;
    }
    next[client.id] = current;
  }
  return next;
}

function seedCrmSettingsForClients(
  clients: ClientWorkspaceClient[],
  existingMap: Record<string, ClientCrmSettings>,
  mode: RepresentationMode | null | undefined,
): Record<string, ClientCrmSettings> {
  const next: Record<string, ClientCrmSettings> = { ...existingMap };
  for (const client of clients) {
    next[client.id] = normalizeCrmSettings(next[client.id], mode);
  }
  return next;
}

function serializeWorkspaceStateForCloud(
  representationMode: RepresentationMode | null,
  clients: ClientWorkspaceClient[],
  deals: ClientWorkspaceDeal[],
  dealStageMap: Record<string, string[]>,
  crmSettingsMap: Record<string, ClientCrmSettings>,
  documents: ClientWorkspaceDocument[],
  activeClientId: string | null,
  options?: { includeSnapshots?: boolean },
): Record<string, unknown> {
  const includeSnapshots = options?.includeSnapshots !== false;
  const serializedDocuments = documents.map((doc) => {
    const baseDocument = {
      id: doc.id,
      clientId: doc.clientId,
      dealId: doc.dealId || undefined,
      name: doc.name,
      type: doc.type,
      building: doc.building,
      address: doc.address,
      suite: doc.suite,
      parsed: doc.parsed,
      uploadedBy: doc.uploadedBy,
      uploadedAt: doc.uploadedAt,
      sourceModule: doc.sourceModule,
    } satisfies Omit<ClientWorkspaceDocument, "previewDataUrl" | "normalizeSnapshot">;
    if (includeSnapshots && doc.normalizeSnapshot) {
      return {
        ...baseDocument,
        normalizeSnapshot: doc.normalizeSnapshot,
      };
    }
    return baseDocument;
  });
  return {
    representationMode,
    clients,
    deals,
    dealStageMap,
    crmSettingsMap,
    documents: serializedDocuments,
    activeClientId: activeClientId || null,
  };
}

function isWorkspacePayloadTooLargeError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error || "").toLowerCase();
  if (!message) return false;
  return message.includes("exceeds size limit") || message.includes("workspace payload") || message.includes("413");
}

function appendDealTimelineActivity(
  deal: ClientWorkspaceDeal,
  label: string,
  description: string,
  createdAt: string,
): ClientWorkspaceDeal["timeline"] {
  const next = [
    {
      id: nextId("deal_activity"),
      clientId: deal.clientId,
      dealId: deal.id,
      label,
      description,
      createdAt,
    },
    ...deal.timeline,
  ];
  return next.slice(0, 100);
}

function applyDocumentStageAutomation(input: {
  deal: ClientWorkspaceDeal;
  documentType: ClientDocumentType;
  stageOptions: string[];
  nowIso: string;
  activityDescription: string;
}): ClientWorkspaceDeal {
  const transition = getDealDocumentStageTransition({
    stages: input.stageOptions,
    currentStage: input.deal.stage,
    documentType: input.documentType,
  });
  if (!transition) return input.deal;
  const nextStatus: ClientWorkspaceDeal["status"] = transition.shouldMarkWon
    ? "won"
    : input.deal.status;
  return {
    ...input.deal,
    stage: transition.nextStage,
    status: nextStatus,
    timeline: appendDealTimelineActivity(
      input.deal,
      "AI stage update",
      `${transition.reason}. Moved to ${transition.nextStage}. ${input.activityDescription}`,
      input.nowIso,
    ),
    updatedAt: input.nowIso,
  };
}

export function ClientWorkspaceProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SupabaseAuthSession | null>(() => getSessionFromStorage());
  const [authResolved, setAuthResolved] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return Boolean(getSessionFromStorage());
  });
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>("idle");
  const [cloudSyncMessage, setCloudSyncMessage] = useState("Cloud sync ready.");
  const [cloudLastSyncedAt, setCloudLastSyncedAt] = useState<string | null>(null);
  const [cloudLocalFallback, setCloudLocalFallback] = useState(false);
  const [representationMode, setRepresentationModeState] = useState<RepresentationMode | null>(null);
  const [clients, setClients] = useState<ClientWorkspaceClient[]>([]);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [allDeals, setAllDeals] = useState<ClientWorkspaceDeal[]>([]);
  const [dealStageMap, setDealStageMap] = useState<Record<string, string[]>>({});
  const [crmSettingsMap, setCrmSettingsMap] = useState<Record<string, ClientCrmSettings>>({});
  const [allDocuments, setAllDocuments] = useState<ClientWorkspaceDocument[]>([]);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((next) => {
        if (!cancelled) {
          setSession((prev) => (sameSession(prev, next) ? prev : next));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession((prev) => (sameSession(prev, null) ? prev : null));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthResolved(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeAuthSession((next) => {
      setSession((prev) => (sameSession(prev, next) ? prev : next));
      setAuthResolved(true);
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authResolved) return;
    let cancelled = false;

    const applyWorkspaceState = (state: Record<string, unknown> | null | undefined) => {
      const loadedRepresentationMode = normalizeRepresentationMode(state?.representationMode);
      const clientsRaw = Array.isArray(state?.clients) ? state?.clients : [];
      const dealsRaw = Array.isArray(state?.deals) ? state?.deals : [];
      const dealStagesRaw = state?.dealStageMap;
      const crmSettingsRaw = state?.crmSettingsMap;
      const documentsRaw = Array.isArray(state?.documents) ? state?.documents : [];
      const activeRaw = asText(state?.activeClientId);
      const loadedClients = parseStoredClients(JSON.stringify(clientsRaw));
      const loadedDeals = parseStoredDeals(JSON.stringify(dealsRaw));
      const loadedDealStages = seedDealStagesForClients(
        loadedClients,
        parseStoredDealStageMap(JSON.stringify(dealStagesRaw || {}), loadedRepresentationMode),
        loadedRepresentationMode,
      );
      const loadedCrmSettings = seedCrmSettingsForClients(
        loadedClients,
        parseStoredCrmSettingsMap(JSON.stringify(crmSettingsRaw || {}), loadedRepresentationMode),
        loadedRepresentationMode,
      );
      const loadedDocuments = parseStoredDocuments(JSON.stringify(documentsRaw));
      const resolvedActive =
        activeRaw && loadedClients.some((client) => client.id === activeRaw)
          ? activeRaw
          : (loadedClients[0]?.id || null);
      setRepresentationModeState(loadedRepresentationMode);
      setClients(loadedClients);
      setAllDeals(loadedDeals);
      setDealStageMap(loadedDealStages);
      setCrmSettingsMap(loadedCrmSettings);
      setAllDocuments(loadedDocuments);
      setActiveClientId(resolvedActive);
    };

    const applyLocalFallback = () => {
      const loadedRepresentationMode = normalizeRepresentationMode(
        window.localStorage.getItem(REPRESENTATION_MODE_STORAGE_KEY),
      );
      const loadedClients = parseStoredClients(window.localStorage.getItem(CLIENTS_STORAGE_KEY));
      const loadedDeals = parseStoredDeals(window.localStorage.getItem(DEAL_LIBRARY_STORAGE_KEY));
      const loadedDealStages = seedDealStagesForClients(
        loadedClients,
        parseStoredDealStageMap(window.localStorage.getItem(DEAL_STAGE_CONFIG_STORAGE_KEY), loadedRepresentationMode),
        loadedRepresentationMode,
      );
      const loadedCrmSettings = seedCrmSettingsForClients(
        loadedClients,
        parseStoredCrmSettingsMap(window.localStorage.getItem(CRM_SETTINGS_STORAGE_KEY), loadedRepresentationMode),
        loadedRepresentationMode,
      );
      const loadedDocuments = parseStoredDocuments(window.localStorage.getItem(DOCUMENT_LIBRARY_STORAGE_KEY));
      const storedActiveId = asText(window.localStorage.getItem(ACTIVE_CLIENT_STORAGE_KEY));
      setRepresentationModeState(loadedRepresentationMode);
      setClients(loadedClients);
      setAllDeals(loadedDeals);
      setDealStageMap(loadedDealStages);
      setCrmSettingsMap(loadedCrmSettings);
      setAllDocuments(loadedDocuments);
      if (storedActiveId && loadedClients.some((client) => client.id === storedActiveId)) {
        setActiveClientId(storedActiveId);
      } else {
        setActiveClientId(loadedClients[0]?.id || null);
      }
    };

    async function hydrate() {
      setReady(false);
      if (session) {
        setCloudLocalFallback(false);
        setCloudSyncStatus("idle");
        setCloudSyncMessage("Loading cloud workspace...");
        try {
          const remote = await fetchWorkspaceCloudState();
          if (cancelled) return;
          const workspaceState =
            remote.workspace_state && typeof remote.workspace_state === "object"
              ? remote.workspace_state
              : {};
          applyWorkspaceState(workspaceState);
          setCloudLocalFallback(false);
          setCloudSyncStatus("synced");
          setCloudSyncMessage("Cloud workspace loaded.");
          setCloudLastSyncedAt(asText(remote.updated_at) || null);
          try {
            // Signed-in mode should not rely on device-local storage.
            window.localStorage.removeItem(CLIENTS_STORAGE_KEY);
            window.localStorage.removeItem(DEAL_LIBRARY_STORAGE_KEY);
            window.localStorage.removeItem(DEAL_STAGE_CONFIG_STORAGE_KEY);
            window.localStorage.removeItem(CRM_SETTINGS_STORAGE_KEY);
            window.localStorage.removeItem(DOCUMENT_LIBRARY_STORAGE_KEY);
            window.localStorage.removeItem(ACTIVE_CLIENT_STORAGE_KEY);
            window.localStorage.removeItem(REPRESENTATION_MODE_STORAGE_KEY);
          } catch {
            // ignore localStorage errors
          }
          setReady(true);
          return;
        } catch (error) {
          console.warn("workspace_cloud_load_failed", error);
          if (cancelled) return;
          const message = String(error instanceof Error ? error.message : error || "").trim();
          if (message.toLowerCase().includes("session expired")) {
            void signOut();
            return;
          }
          setCloudLocalFallback(true);
          applyLocalFallback();
          setCloudSyncStatus("local");
          setCloudSyncMessage(message || "Cloud unavailable. Using local device workspace.");
          setCloudLastSyncedAt(null);
          setReady(true);
          return;
        }
      }
      setCloudLocalFallback(false);
      applyLocalFallback();
      setCloudSyncStatus("local");
      setCloudSyncMessage("Local device only (sign in for cloud sync).");
      setCloudLastSyncedAt(null);
      setReady(true);
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [session, authResolved]);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    if (session && !cloudLocalFallback) {
      window.localStorage.removeItem(CLIENTS_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(clients));
  }, [ready, clients, session, cloudLocalFallback]);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    if (session && !cloudLocalFallback) {
      window.localStorage.removeItem(DEAL_LIBRARY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(DEAL_LIBRARY_STORAGE_KEY, JSON.stringify(allDeals));
  }, [ready, allDeals, session, cloudLocalFallback]);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    if (session && !cloudLocalFallback) {
      window.localStorage.removeItem(DEAL_STAGE_CONFIG_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(DEAL_STAGE_CONFIG_STORAGE_KEY, JSON.stringify(dealStageMap));
  }, [ready, dealStageMap, session, cloudLocalFallback]);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    if (session && !cloudLocalFallback) {
      window.localStorage.removeItem(CRM_SETTINGS_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(CRM_SETTINGS_STORAGE_KEY, JSON.stringify(crmSettingsMap));
  }, [ready, crmSettingsMap, session, cloudLocalFallback]);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    if (session && !cloudLocalFallback) {
      window.localStorage.removeItem(DOCUMENT_LIBRARY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(DOCUMENT_LIBRARY_STORAGE_KEY, JSON.stringify(allDocuments));
  }, [ready, allDocuments, session, cloudLocalFallback]);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    if (session && !cloudLocalFallback) {
      window.localStorage.removeItem(REPRESENTATION_MODE_STORAGE_KEY);
      return;
    }
    if (representationMode) {
      window.localStorage.setItem(REPRESENTATION_MODE_STORAGE_KEY, representationMode);
      return;
    }
    window.localStorage.removeItem(REPRESENTATION_MODE_STORAGE_KEY);
  }, [ready, session, cloudLocalFallback, representationMode]);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    if (session && !cloudLocalFallback) {
      window.localStorage.removeItem(ACTIVE_CLIENT_STORAGE_KEY);
      return;
    }
    if (activeClientId) {
      window.localStorage.setItem(ACTIVE_CLIENT_STORAGE_KEY, activeClientId);
    } else {
      window.localStorage.removeItem(ACTIVE_CLIENT_STORAGE_KEY);
    }
  }, [ready, activeClientId, session, cloudLocalFallback]);

  useEffect(() => {
    if (!ready || !session || cloudLocalFallback) return;
    let cancelled = false;
    setCloudSyncStatus("saving");
    setCloudSyncMessage("Syncing to cloud...");
    const handle = window.setTimeout(() => {
      const workspaceState = serializeWorkspaceStateForCloud(
        representationMode,
        clients,
        allDeals,
        dealStageMap,
        crmSettingsMap,
        allDocuments,
        activeClientId,
        {
          includeSnapshots: true,
        },
      );
      void (async () => {
        try {
          const saved = await saveWorkspaceCloudState(workspaceState);
          if (cancelled) return;
          setCloudLocalFallback(false);
          setCloudSyncStatus("synced");
          setCloudSyncMessage("Synced to cloud.");
          setCloudLastSyncedAt(asText(saved.updated_at) || new Date().toISOString());
          return;
        } catch (error) {
          if (cancelled) return;
          if (isWorkspacePayloadTooLargeError(error)) {
            const compactState = serializeWorkspaceStateForCloud(
              representationMode,
              clients,
              allDeals,
              dealStageMap,
              crmSettingsMap,
              allDocuments,
              activeClientId,
              {
                includeSnapshots: false,
              },
            );
            try {
              const savedCompact = await saveWorkspaceCloudState(compactState);
              if (cancelled) return;
              setCloudLocalFallback(false);
              setCloudSyncStatus("synced");
              setCloudSyncMessage("Synced to cloud (compact mode).");
              setCloudLastSyncedAt(asText(savedCompact.updated_at) || new Date().toISOString());
              console.warn("workspace_cloud_save_compacted", "Saved compact workspace payload without normalize snapshots.");
              return;
            } catch (compactError) {
              if (cancelled) return;
              const compactMessage = String(compactError instanceof Error ? compactError.message : compactError || "").trim();
              setCloudLocalFallback(true);
              setCloudSyncStatus("local");
              setCloudSyncMessage(compactMessage || "Cloud sync failed. Using local workspace.");
              console.warn("workspace_cloud_save_failed_compact", compactError);
              return;
            }
          }
          const message = String(error instanceof Error ? error.message : error || "").trim();
          setCloudLocalFallback(true);
          setCloudSyncStatus("local");
          setCloudSyncMessage(message || "Cloud sync failed. Using local workspace.");
          console.warn("workspace_cloud_save_failed", error);
        }
      })();
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    ready,
    session,
    representationMode,
    clients,
    allDeals,
    dealStageMap,
    crmSettingsMap,
    allDocuments,
    activeClientId,
    cloudLocalFallback,
  ]);

  useEffect(() => {
    if (!ready) return;
    if (activeClientId && clients.some((client) => client.id === activeClientId)) return;
    setActiveClientId(clients[0]?.id || null);
  }, [ready, activeClientId, clients]);

  useEffect(() => {
    if (!ready) return;
    if (!activeClientId) return;
    if (Array.isArray(dealStageMap[activeClientId]) && dealStageMap[activeClientId].length > 0) return;
    setDealStageMap((prev) => ({
      ...prev,
      [activeClientId]: [...getDefaultDealStagesForMode(representationMode)],
    }));
  }, [ready, activeClientId, dealStageMap, representationMode]);

  useEffect(() => {
    if (!ready) return;
    if (clients.length === 0) return;
    setDealStageMap((prev) => seedDealStagesForClients(clients, prev, representationMode));
  }, [ready, clients, representationMode]);

  useEffect(() => {
    if (!ready) return;
    if (clients.length === 0) return;
    setCrmSettingsMap((prev) => seedCrmSettingsForClients(clients, prev, representationMode));
  }, [ready, clients, representationMode]);

  const setActiveClient = useCallback((clientId: string) => {
    const targetId = asText(clientId);
    if (!targetId) return;
    setActiveClientId((prev) => (prev === targetId ? prev : targetId));
  }, []);

  const setRepresentationMode = useCallback((mode: RepresentationMode) => {
    setRepresentationModeState((prev) => (prev === mode ? prev : mode));
    setDealStageMap((prev) => seedDealStagesForClients(clients, prev, mode));
    setCrmSettingsMap((prev) => seedCrmSettingsForClients(clients, prev, mode));
  }, [clients]);

  const createClient = useCallback((input: CreateClientInput): ClientWorkspaceClient | null => {
    const name = asText(input.name);
    if (!name) return null;
    const created: ClientWorkspaceClient = {
      id: nextId("client"),
      name,
      companyType: asText(input.companyType),
      industry: asText(input.industry),
      contactName: asText(input.contactName),
      contactEmail: asText(input.contactEmail),
      brokerage: asText(input.brokerage),
      notes: asText(input.notes),
      createdAt: new Date().toISOString(),
      logoDataUrl: asText(input.logoDataUrl) || undefined,
      logoFileName: asText(input.logoFileName) || undefined,
    };
    setClients((prev) => [created, ...prev]);
    setDealStageMap((prev) => ({
      ...prev,
      [created.id]: prev[created.id] && prev[created.id].length > 0
        ? normalizeDealStages(prev[created.id], representationMode)
        : [...getDefaultDealStagesForMode(representationMode)],
    }));
    setCrmSettingsMap((prev) => ({
      ...prev,
      [created.id]: normalizeCrmSettings(prev[created.id], representationMode),
    }));
    setActiveClientId(created.id);
    return created;
  }, [representationMode]);

  const updateClient = useCallback((clientId: string, input: UpdateClientInput) => {
    const id = asText(clientId);
    if (!id) return;
    setClients((prev) =>
      prev.map((client) => {
        if (client.id !== id) return client;
        const nextLogoDataUrl = hasOwnKey(input, "logoDataUrl")
          ? (asText(input.logoDataUrl) || undefined)
          : client.logoDataUrl;
        const nextLogoFileName = hasOwnKey(input, "logoFileName")
          ? (asText(input.logoFileName) || undefined)
          : client.logoFileName;
        return {
          ...client,
          name: hasOwnKey(input, "name") ? asText(input.name) || client.name : client.name,
          companyType: hasOwnKey(input, "companyType") ? asText(input.companyType) : client.companyType,
          industry: hasOwnKey(input, "industry") ? asText(input.industry) : client.industry,
          contactName: hasOwnKey(input, "contactName") ? asText(input.contactName) : client.contactName,
          contactEmail: hasOwnKey(input, "contactEmail") ? asText(input.contactEmail) : client.contactEmail,
          brokerage: hasOwnKey(input, "brokerage") ? asText(input.brokerage) : client.brokerage,
          notes: hasOwnKey(input, "notes") ? asText(input.notes) : client.notes,
          logoDataUrl: nextLogoDataUrl,
          logoFileName: nextLogoFileName,
        };
      }),
    );
  }, []);

  const getDealsForClient = useCallback((clientId?: string | null) => {
    const resolvedClientId = asText(clientId || activeClientId);
    if (!resolvedClientId) return [];
    return allDeals.filter((deal) => deal.clientId === resolvedClientId);
  }, [allDeals, activeClientId]);

  const getDealStagesForClient = useCallback((clientId?: string | null) => {
    const resolvedClientId = asText(clientId || activeClientId);
    if (!resolvedClientId) return [...getDefaultDealStagesForMode(representationMode)];
    return normalizeDealStages(dealStageMap[resolvedClientId], representationMode);
  }, [dealStageMap, activeClientId, representationMode]);

  const setDealStages = useCallback((stages: string[], clientId?: string | null) => {
    const resolvedClientId = asText(clientId || activeClientId);
    if (!resolvedClientId) return;
    const normalizedStages = normalizeDealStages(stages, representationMode);
    setDealStageMap((prev) => ({
      ...prev,
      [resolvedClientId]: normalizedStages,
    }));
  }, [activeClientId, representationMode]);

  const getCrmSettingsForClient = useCallback((clientId?: string | null) => {
    const resolvedClientId = asText(clientId || activeClientId);
    if (!resolvedClientId) return normalizeCrmSettings(null, representationMode);
    return normalizeCrmSettings(crmSettingsMap[resolvedClientId], representationMode);
  }, [crmSettingsMap, activeClientId, representationMode]);

  const setCrmSettings = useCallback((settings: Partial<ClientCrmSettings>, clientId?: string | null) => {
    const resolvedClientId = asText(clientId || activeClientId);
    if (!resolvedClientId) return;
    setCrmSettingsMap((prev) => {
      const current = normalizeCrmSettings(prev[resolvedClientId], representationMode);
      return {
        ...prev,
        [resolvedClientId]: normalizeCrmSettings(
          {
            ...current,
            ...settings,
          },
          representationMode,
        ),
      };
    });
  }, [activeClientId, representationMode]);

  const createDeal = useCallback((input: CreateDealInput): ClientWorkspaceDeal | null => {
    const resolvedClientId = asText(input.clientId || activeClientId);
    const dealName = asText(input.dealName);
    if (!resolvedClientId || !dealName) return null;
    const stages = normalizeDealStages(dealStageMap[resolvedClientId], representationMode);
    const nowIso = new Date().toISOString();
    const created: ClientWorkspaceDeal = {
      id: nextId("deal"),
      clientId: resolvedClientId,
      companyId: asText(input.companyId) || undefined,
      dealName,
      requirementName: asText(input.requirementName),
      dealType: asText(input.dealType),
      stage: asText(input.stage) || stages[0] || getDefaultDealStagesForMode(representationMode)[0] || DEFAULT_DEAL_STAGES[0],
      status: input.status || "open",
      priority: input.priority || "medium",
      targetMarket: asText(input.targetMarket),
      submarket: asText(input.submarket),
      city: asText(input.city),
      squareFootageMin: Number(input.squareFootageMin) || 0,
      squareFootageMax: Number(input.squareFootageMax) || 0,
      budget: Number(input.budget) || 0,
      occupancyDateGoal: asText(input.occupancyDateGoal),
      expirationDate: asText(input.expirationDate),
      selectedProperty: asText(input.selectedProperty),
      selectedSuite: asText(input.selectedSuite),
      selectedLandlord: asText(input.selectedLandlord),
      tenantRepBroker: asText(input.tenantRepBroker),
      notes: asText(input.notes),
      linkedSurveyIds: input.linkedSurveyIds || [],
      linkedAnalysisIds: input.linkedAnalysisIds || [],
      linkedDocumentIds: input.linkedDocumentIds || [],
      linkedObligationIds: input.linkedObligationIds || [],
      linkedLeaseAbstractIds: input.linkedLeaseAbstractIds || [],
      timeline: [],
      tasks: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    setAllDeals((prev) => [created, ...prev]);
    setDealStageMap((prev) => ({
      ...prev,
      [resolvedClientId]: normalizeDealStages(prev[resolvedClientId], representationMode),
    }));
    return created;
  }, [activeClientId, dealStageMap, representationMode]);

  const updateDeal = useCallback((dealId: string, input: UpdateDealInput) => {
    const id = asText(dealId);
    if (!id) return;
    setAllDeals((prev) =>
      prev.map((deal) => {
        if (deal.id !== id) return deal;
        const nextLinkedDocuments = hasOwnKey(input, "linkedDocumentIds")
          ? Array.from(new Set((input.linkedDocumentIds || []).map((value) => asText(value)).filter(Boolean)))
          : deal.linkedDocumentIds;
        return {
          ...deal,
          companyId: hasOwnKey(input, "companyId") ? asText(input.companyId) || undefined : deal.companyId,
          dealName: hasOwnKey(input, "dealName") ? asText(input.dealName) || deal.dealName : deal.dealName,
          requirementName: hasOwnKey(input, "requirementName") ? asText(input.requirementName) : deal.requirementName,
          dealType: hasOwnKey(input, "dealType") ? asText(input.dealType) : deal.dealType,
          stage: hasOwnKey(input, "stage") ? asText(input.stage) : deal.stage,
          status: hasOwnKey(input, "status") ? ((asText(input.status) || deal.status) as ClientWorkspaceDeal["status"]) : deal.status,
          priority: hasOwnKey(input, "priority") ? ((asText(input.priority) || deal.priority) as ClientWorkspaceDeal["priority"]) : deal.priority,
          targetMarket: hasOwnKey(input, "targetMarket") ? asText(input.targetMarket) : deal.targetMarket,
          submarket: hasOwnKey(input, "submarket") ? asText(input.submarket) : deal.submarket,
          city: hasOwnKey(input, "city") ? asText(input.city) : deal.city,
          squareFootageMin: hasOwnKey(input, "squareFootageMin") ? (Number(input.squareFootageMin) || 0) : deal.squareFootageMin,
          squareFootageMax: hasOwnKey(input, "squareFootageMax") ? (Number(input.squareFootageMax) || 0) : deal.squareFootageMax,
          budget: hasOwnKey(input, "budget") ? (Number(input.budget) || 0) : deal.budget,
          occupancyDateGoal: hasOwnKey(input, "occupancyDateGoal") ? asText(input.occupancyDateGoal) : deal.occupancyDateGoal,
          expirationDate: hasOwnKey(input, "expirationDate") ? asText(input.expirationDate) : deal.expirationDate,
          selectedProperty: hasOwnKey(input, "selectedProperty") ? asText(input.selectedProperty) : deal.selectedProperty,
          selectedSuite: hasOwnKey(input, "selectedSuite") ? asText(input.selectedSuite) : deal.selectedSuite,
          selectedLandlord: hasOwnKey(input, "selectedLandlord") ? asText(input.selectedLandlord) : deal.selectedLandlord,
          tenantRepBroker: hasOwnKey(input, "tenantRepBroker") ? asText(input.tenantRepBroker) : deal.tenantRepBroker,
          notes: hasOwnKey(input, "notes") ? asText(input.notes) : deal.notes,
          linkedSurveyIds: hasOwnKey(input, "linkedSurveyIds")
            ? Array.from(new Set((input.linkedSurveyIds || []).map((value) => asText(value)).filter(Boolean)))
            : deal.linkedSurveyIds,
          linkedAnalysisIds: hasOwnKey(input, "linkedAnalysisIds")
            ? Array.from(new Set((input.linkedAnalysisIds || []).map((value) => asText(value)).filter(Boolean)))
            : deal.linkedAnalysisIds,
          linkedDocumentIds: nextLinkedDocuments,
          linkedObligationIds: hasOwnKey(input, "linkedObligationIds")
            ? Array.from(new Set((input.linkedObligationIds || []).map((value) => asText(value)).filter(Boolean)))
            : deal.linkedObligationIds,
          linkedLeaseAbstractIds: hasOwnKey(input, "linkedLeaseAbstractIds")
            ? Array.from(new Set((input.linkedLeaseAbstractIds || []).map((value) => asText(value)).filter(Boolean)))
            : deal.linkedLeaseAbstractIds,
          timeline: hasOwnKey(input, "timeline") && Array.isArray(input.timeline) ? input.timeline : deal.timeline,
          tasks: hasOwnKey(input, "tasks") && Array.isArray(input.tasks) ? input.tasks : deal.tasks,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  }, []);

  const removeDeal = useCallback((dealId: string) => {
    const id = asText(dealId);
    if (!id) return;
    setAllDeals((prev) => prev.filter((deal) => deal.id !== id));
    setAllDocuments((prev) => prev.map((doc) => (doc.dealId === id ? { ...doc, dealId: undefined } : doc)));
  }, []);

  const registerDocument = useCallback(async (input: RegisterClientDocumentInput): Promise<ClientWorkspaceDocument | null> => {
    const resolvedClientId = asText(input.clientId || activeClientId);
    if (!resolvedClientId) return null;

    const snapshot = toNormalizeSnapshot(input.normalize);
    const canonical = asCanonical(snapshot);
    const previewDataUrl = await maybeBuildPreview(input.file);

    const resolvedType = input.type || inferWorkspaceDocumentType(input.name, input.sourceModule, snapshot);
    const document: ClientWorkspaceDocument = {
      id: nextId("doc"),
      clientId: resolvedClientId,
      companyId: asText(input.companyId) || undefined,
      dealId: asText(input.dealId) || undefined,
      name: asText(input.name) || "Untitled document",
      type: resolvedType,
      building: asText(input.building) || asText(canonical?.building_name || canonical?.premises_name),
      address: asText(input.address) || asText(canonical?.address),
      suite: asText(input.suite) || asText(canonical?.suite),
      parsed: input.parsed ?? Boolean(snapshot?.canonical_lease),
      uploadedBy: asText(input.uploadedBy) || asText(session?.user?.name) || asText(session?.user?.email) || "User",
      uploadedAt: new Date().toISOString(),
      sourceModule: input.sourceModule,
      previewDataUrl,
      normalizeSnapshot: snapshot,
    };

    setAllDocuments((prev) => [document, ...prev]);
    if (document.dealId) {
      const nowIso = new Date().toISOString();
      setAllDeals((prev) =>
        prev.map((deal) => {
          if (deal.id !== document.dealId) return deal;
          let nextDeal = deal;
          const linkedDocumentIds = Array.from(new Set([...(deal.linkedDocumentIds || []), document.id]));
          if (linkedDocumentIds.length !== deal.linkedDocumentIds.length) {
            nextDeal = {
              ...nextDeal,
              linkedDocumentIds,
              updatedAt: nowIso,
            };
          }
          const clientCrmSettings = normalizeCrmSettings(crmSettingsMap[deal.clientId], representationMode);
          if (!clientCrmSettings.autoStageFromDocuments) return nextDeal;
          const stageOptions = normalizeDealStages(dealStageMap[deal.clientId], representationMode);
          return applyDocumentStageAutomation({
            deal: nextDeal,
            documentType: document.type,
            stageOptions,
            nowIso,
            activityDescription: `Source document: ${document.name}`,
          });
        }),
      );
    }
    return document;
  }, [activeClientId, session, dealStageMap, crmSettingsMap, representationMode]);

  const updateDocument = useCallback((documentId: string, input: UpdateClientDocumentInput) => {
    const id = asText(documentId);
    if (!id) return;
    const previousDocument = allDocuments.find((doc) => doc.id === id);
    const requestedType = hasOwnKey(input, "type") ? asText(input.type) : "";
    const nextType: ClientDocumentType =
      requestedType && (CLIENT_DOCUMENT_TYPES as readonly string[]).includes(requestedType)
        ? (requestedType as ClientDocumentType)
        : (previousDocument?.type || "other");
    const previousDealId = asText(previousDocument?.dealId);
    const nextDealId = hasOwnKey(input, "dealId") ? asText(input.dealId) : previousDealId;

    setAllDocuments((prev) =>
      prev.map((doc) => {
        if (doc.id !== id) return doc;

        return {
          ...doc,
          companyId: hasOwnKey(input, "companyId") ? asText(input.companyId) || undefined : doc.companyId,
          dealId: hasOwnKey(input, "dealId") ? (nextDealId || undefined) : doc.dealId,
          name: hasOwnKey(input, "name") ? asText(input.name) || doc.name : doc.name,
          type: nextType,
          building: hasOwnKey(input, "building") ? asText(input.building) : doc.building,
          address: hasOwnKey(input, "address") ? asText(input.address) : doc.address,
          suite: hasOwnKey(input, "suite") ? asText(input.suite) : doc.suite,
        };
      }),
    );
    if (!hasOwnKey(input, "dealId") && !hasOwnKey(input, "type")) return;
    const dealLinkChanged = hasOwnKey(input, "dealId") && previousDealId !== nextDealId;
    const nowIso = new Date().toISOString();
    setAllDeals((prev) =>
      prev.map((deal) => {
        if (deal.id !== previousDealId && deal.id !== nextDealId) return deal;
        let nextDeal = deal;
        if (dealLinkChanged && deal.id === previousDealId) {
          nextDeal = {
            ...nextDeal,
            linkedDocumentIds: nextDeal.linkedDocumentIds.filter((docId) => docId !== id),
            updatedAt: nowIso,
          };
        }
        if (dealLinkChanged && deal.id === nextDealId) {
          nextDeal = {
            ...nextDeal,
            linkedDocumentIds: Array.from(new Set([...nextDeal.linkedDocumentIds, id])),
            updatedAt: nowIso,
          };
        }
        if (deal.id === nextDealId) {
          const clientCrmSettings = normalizeCrmSettings(crmSettingsMap[deal.clientId], representationMode);
          if (!clientCrmSettings.autoStageFromDocuments) return nextDeal;
          const stageOptions = normalizeDealStages(dealStageMap[deal.clientId], representationMode);
          nextDeal = applyDocumentStageAutomation({
            deal: nextDeal,
            documentType: nextType,
            stageOptions,
            nowIso,
            activityDescription: `Linked document: ${asText(previousDocument?.name) || "document"}`,
          });
        }
        return nextDeal;
      }),
    );
  }, [allDocuments, dealStageMap, crmSettingsMap, representationMode]);

  const removeDocument = useCallback((documentId: string) => {
    const id = asText(documentId);
    if (!id) return;
    setAllDocuments((prev) => prev.filter((doc) => doc.id !== id));
    setAllDeals((prev) =>
      prev.map((deal) => {
        if (!deal.linkedDocumentIds.includes(id)) return deal;
        return {
          ...deal,
          linkedDocumentIds: deal.linkedDocumentIds.filter((docId) => docId !== id),
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  }, []);

  const getDocumentsForClient = useCallback((clientId?: string | null) => {
    const resolvedClientId = asText(clientId || activeClientId);
    if (!resolvedClientId) return [];
    return allDocuments.filter((doc) => doc.clientId === resolvedClientId);
  }, [allDocuments, activeClientId]);

  const activeClient = useMemo(
    () => clients.find((client) => client.id === activeClientId) ?? null,
    [clients, activeClientId],
  );

  const deals = useMemo(
    () => getDealsForClient(activeClientId),
    [activeClientId, getDealsForClient],
  );
  const dealStages = useMemo(
    () => getDealStagesForClient(activeClientId),
    [activeClientId, getDealStagesForClient],
  );
  const crmSettings = useMemo(
    () => getCrmSettingsForClient(activeClientId),
    [activeClientId, getCrmSettingsForClient],
  );
  const documents = useMemo(
    () => getDocumentsForClient(activeClientId),
    [activeClientId, getDocumentsForClient],
  );
  const entityGraph = useMemo(
    () => buildWorkspaceEntityGraph({ clients, documents: allDocuments, deals: allDeals }),
    [clients, allDocuments, allDeals],
  );

  const value = useMemo<ClientWorkspaceContextValue>(
    () => ({
      ready,
      session,
      isAuthenticated: Boolean(session),
      cloudSyncStatus,
      cloudSyncMessage,
      cloudLastSyncedAt,
      representationMode,
      clients,
      activeClientId,
      activeClient,
      allDeals,
      deals,
      dealStages,
      crmSettings,
      documents,
      allDocuments,
      entityGraph,
      setActiveClient,
      setRepresentationMode,
      createClient,
      updateClient,
      createDeal,
      updateDeal,
      removeDeal,
      setDealStages,
      getDealsForClient,
      getDealStagesForClient,
      setCrmSettings,
      getCrmSettingsForClient,
      registerDocument,
      updateDocument,
      removeDocument,
      getDocumentsForClient,
    }),
    [
      ready,
      session,
      cloudSyncStatus,
      cloudSyncMessage,
      cloudLastSyncedAt,
      representationMode,
      clients,
      activeClientId,
      activeClient,
      allDeals,
      deals,
      dealStages,
      crmSettings,
      documents,
      allDocuments,
      entityGraph,
      setActiveClient,
      setRepresentationMode,
      createClient,
      updateClient,
      createDeal,
      updateDeal,
      removeDeal,
      setDealStages,
      getDealsForClient,
      getDealStagesForClient,
      setCrmSettings,
      getCrmSettingsForClient,
      registerDocument,
      updateDocument,
      removeDocument,
      getDocumentsForClient,
    ],
  );

  return <ClientWorkspaceContext.Provider value={value}>{children}</ClientWorkspaceContext.Provider>;
}

export function useClientWorkspace(): ClientWorkspaceContextValue {
  const context = useContext(ClientWorkspaceContext);
  if (!context) {
    throw new Error("useClientWorkspace must be used within ClientWorkspaceProvider");
  }
  return context;
}
