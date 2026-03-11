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
  DOCUMENT_LIBRARY_STORAGE_KEY,
} from "@/lib/workspace/storage";
import { buildWorkspaceEntityGraph, type WorkspaceEntityGraph } from "@/lib/workspace/entities";
import { inferWorkspaceDocumentType } from "@/lib/workspace/document-type";
import { fetchWorkspaceCloudState, saveWorkspaceCloudState } from "@/lib/workspace/cloud";
import type {
  ClientDocumentSourceModule,
  ClientDocumentType,
  ClientWorkspaceClient,
  ClientWorkspaceDocument,
  CreateClientInput,
  DocumentNormalizeSnapshot,
  RegisterClientDocumentInput,
} from "@/lib/workspace/types";

type CloudSyncStatus = "local" | "idle" | "saving" | "synced" | "error";

interface ClientWorkspaceContextValue {
  ready: boolean;
  session: SupabaseAuthSession | null;
  isAuthenticated: boolean;
  cloudSyncStatus: CloudSyncStatus;
  cloudSyncMessage: string;
  cloudLastSyncedAt: string | null;
  clients: ClientWorkspaceClient[];
  activeClientId: string | null;
  activeClient: ClientWorkspaceClient | null;
  documents: ClientWorkspaceDocument[];
  allDocuments: ClientWorkspaceDocument[];
  entityGraph: WorkspaceEntityGraph;
  setActiveClient: (clientId: string) => void;
  createClient: (input: CreateClientInput) => ClientWorkspaceClient | null;
  registerDocument: (input: RegisterClientDocumentInput) => Promise<ClientWorkspaceDocument | null>;
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
    return parsed
      .map((item) => {
        const obj = item as Partial<ClientWorkspaceClient>;
        const name = asText(obj.name);
        const id = asText(obj.id);
        if (!name || !id) return null;
        return {
          id,
          name,
          companyType: asText(obj.companyType),
          industry: asText(obj.industry),
          contactName: asText(obj.contactName),
          contactEmail: asText(obj.contactEmail),
          brokerage: asText(obj.brokerage),
          notes: asText(obj.notes),
          createdAt: asText(obj.createdAt) || new Date().toISOString(),
        } satisfies ClientWorkspaceClient;
      })
      .filter((item): item is ClientWorkspaceClient => !!item);
  } catch {
    return [];
  }
}

function parseStoredDocuments(raw: string | null): ClientWorkspaceDocument[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const obj = item as Partial<ClientWorkspaceDocument>;
        const id = asText(obj.id);
        const clientId = asText(obj.clientId);
        const name = asText(obj.name);
        if (!id || !clientId || !name) return null;
        const previewDataUrl = asText(obj.previewDataUrl);
        const normalizeSnapshot = toNormalizeSnapshot(obj.normalizeSnapshot);
        const sourceModule = (asText(obj.sourceModule) as ClientDocumentSourceModule) || "document-center";
        const inferredType = inferWorkspaceDocumentType(name, sourceModule, normalizeSnapshot);
        const storedType = asText(obj.type) as ClientDocumentType;
        const normalizedType: ClientDocumentType =
          storedType === "sublease documents" && inferredType === "proposals"
            ? "proposals"
            : (storedType || inferredType || "other");
        return {
          id,
          clientId,
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
        } satisfies ClientWorkspaceDocument;
      })
      .filter((item): item is ClientWorkspaceDocument => !!item);
  } catch {
    return [];
  }
}

function serializeWorkspaceStateForCloud(
  clients: ClientWorkspaceClient[],
  documents: ClientWorkspaceDocument[],
  activeClientId: string | null,
  options?: { includeSnapshots?: boolean },
): Record<string, unknown> {
  const includeSnapshots = options?.includeSnapshots !== false;
  const serializedDocuments = documents.map((doc) => {
    const baseDocument = {
      id: doc.id,
      clientId: doc.clientId,
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
    clients,
    documents: serializedDocuments,
    activeClientId: activeClientId || null,
  };
}

function isWorkspacePayloadTooLargeError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error || "").toLowerCase();
  if (!message) return false;
  return message.includes("exceeds size limit") || message.includes("workspace payload") || message.includes("413");
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
  const [clients, setClients] = useState<ClientWorkspaceClient[]>([]);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
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
      const clientsRaw = Array.isArray(state?.clients) ? state?.clients : [];
      const documentsRaw = Array.isArray(state?.documents) ? state?.documents : [];
      const activeRaw = asText(state?.activeClientId);
      const loadedClients = parseStoredClients(JSON.stringify(clientsRaw));
      const loadedDocuments = parseStoredDocuments(JSON.stringify(documentsRaw));
      const resolvedActive =
        activeRaw && loadedClients.some((client) => client.id === activeRaw)
          ? activeRaw
          : (loadedClients[0]?.id || null);
      setClients(loadedClients);
      setAllDocuments(loadedDocuments);
      setActiveClientId(resolvedActive);
    };

    const applyLocalFallback = () => {
      const loadedClients = parseStoredClients(window.localStorage.getItem(CLIENTS_STORAGE_KEY));
      const loadedDocuments = parseStoredDocuments(window.localStorage.getItem(DOCUMENT_LIBRARY_STORAGE_KEY));
      const storedActiveId = asText(window.localStorage.getItem(ACTIVE_CLIENT_STORAGE_KEY));
      setClients(loadedClients);
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
            window.localStorage.removeItem(DOCUMENT_LIBRARY_STORAGE_KEY);
            window.localStorage.removeItem(ACTIVE_CLIENT_STORAGE_KEY);
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
      window.localStorage.removeItem(DOCUMENT_LIBRARY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(DOCUMENT_LIBRARY_STORAGE_KEY, JSON.stringify(allDocuments));
  }, [ready, allDocuments, session, cloudLocalFallback]);

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
      const workspaceState = serializeWorkspaceStateForCloud(clients, allDocuments, activeClientId, {
        includeSnapshots: true,
      });
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
            const compactState = serializeWorkspaceStateForCloud(clients, allDocuments, activeClientId, {
              includeSnapshots: false,
            });
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
  }, [ready, session, clients, allDocuments, activeClientId, cloudLocalFallback]);

  useEffect(() => {
    if (!ready) return;
    if (activeClientId && clients.some((client) => client.id === activeClientId)) return;
    setActiveClientId(clients[0]?.id || null);
  }, [ready, activeClientId, clients]);

  const setActiveClient = useCallback((clientId: string) => {
    const targetId = asText(clientId);
    if (!targetId) return;
    setActiveClientId((prev) => (prev === targetId ? prev : targetId));
  }, []);

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
    };
    setClients((prev) => [created, ...prev]);
    setActiveClientId(created.id);
    return created;
  }, []);

  const registerDocument = useCallback(async (input: RegisterClientDocumentInput): Promise<ClientWorkspaceDocument | null> => {
    const resolvedClientId = asText(input.clientId || activeClientId);
    if (!resolvedClientId) return null;

    const snapshot = toNormalizeSnapshot(input.normalize);
    const canonical = asCanonical(snapshot);
    const previewDataUrl = await maybeBuildPreview(input.file);

    const document: ClientWorkspaceDocument = {
      id: nextId("doc"),
      clientId: resolvedClientId,
      name: asText(input.name) || "Untitled document",
      type: input.type || inferWorkspaceDocumentType(input.name, input.sourceModule, snapshot),
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
    return document;
  }, [activeClientId, session]);

  const removeDocument = useCallback((documentId: string) => {
    const id = asText(documentId);
    if (!id) return;
    setAllDocuments((prev) => prev.filter((doc) => doc.id !== id));
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

  const documents = useMemo(
    () => getDocumentsForClient(activeClientId),
    [activeClientId, getDocumentsForClient],
  );
  const entityGraph = useMemo(
    () => buildWorkspaceEntityGraph({ clients, documents: allDocuments }),
    [clients, allDocuments],
  );

  const value = useMemo<ClientWorkspaceContextValue>(
    () => ({
      ready,
      session,
      isAuthenticated: Boolean(session),
      cloudSyncStatus,
      cloudSyncMessage,
      cloudLastSyncedAt,
      clients,
      activeClientId,
      activeClient,
      documents,
      allDocuments,
      entityGraph,
      setActiveClient,
      createClient,
      registerDocument,
      removeDocument,
      getDocumentsForClient,
    }),
    [
      ready,
      session,
      cloudSyncStatus,
      cloudSyncMessage,
      cloudLastSyncedAt,
      clients,
      activeClientId,
      activeClient,
      documents,
      allDocuments,
      entityGraph,
      setActiveClient,
      createClient,
      registerDocument,
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
