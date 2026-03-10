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
import { getSession, type SupabaseAuthSession } from "@/lib/supabase";
import type { BackendCanonicalLease, NormalizerResponse } from "@/lib/types";
import {
  ACTIVE_CLIENT_STORAGE_KEY,
  CLIENTS_STORAGE_KEY,
  DOCUMENT_LIBRARY_STORAGE_KEY,
} from "@/lib/workspace/storage";
import { buildWorkspaceEntityGraph, type WorkspaceEntityGraph } from "@/lib/workspace/entities";
import { inferWorkspaceDocumentType } from "@/lib/workspace/document-type";
import type {
  ClientDocumentSourceModule,
  ClientDocumentType,
  ClientWorkspaceClient,
  ClientWorkspaceDocument,
  CreateClientInput,
  DocumentNormalizeSnapshot,
  RegisterClientDocumentInput,
} from "@/lib/workspace/types";

interface ClientWorkspaceContextValue {
  ready: boolean;
  session: SupabaseAuthSession | null;
  isAuthenticated: boolean;
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
  if (file.size > 2_500_000) return undefined;
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
        return {
          id,
          clientId,
          name,
          type: (asText(obj.type) as ClientDocumentType) || "other",
          building: asText(obj.building),
          address: asText(obj.address),
          suite: asText(obj.suite),
          parsed: Boolean(obj.parsed),
          uploadedBy: asText(obj.uploadedBy) || "User",
          uploadedAt: asText(obj.uploadedAt) || new Date().toISOString(),
          sourceModule: (asText(obj.sourceModule) as ClientDocumentSourceModule) || "document-center",
          ...(previewDataUrl ? { previewDataUrl } : {}),
          ...(normalizeSnapshot ? { normalizeSnapshot } : {}),
        } satisfies ClientWorkspaceDocument;
      })
      .filter((item): item is ClientWorkspaceDocument => !!item);
  } catch {
    return [];
  }
}

export function ClientWorkspaceProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SupabaseAuthSession | null>(null);
  const [clients, setClients] = useState<ClientWorkspaceClient[]>([]);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [allDocuments, setAllDocuments] = useState<ClientWorkspaceDocument[]>([]);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((next) => {
        if (!cancelled) setSession(next);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
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
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    window.localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(clients));
  }, [ready, clients]);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    window.localStorage.setItem(DOCUMENT_LIBRARY_STORAGE_KEY, JSON.stringify(allDocuments));
  }, [ready, allDocuments]);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    if (activeClientId) {
      window.localStorage.setItem(ACTIVE_CLIENT_STORAGE_KEY, activeClientId);
    } else {
      window.localStorage.removeItem(ACTIVE_CLIENT_STORAGE_KEY);
    }
  }, [ready, activeClientId]);

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
