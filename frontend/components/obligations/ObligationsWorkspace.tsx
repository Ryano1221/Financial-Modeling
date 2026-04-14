"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlatformPanel, PlatformSection } from "@/components/platform/PlatformShell";
import { getDisplayErrorMessage } from "@/lib/api";
import { normalizerResponseFromSnapshot, repairNormalizerResponse } from "@/lib/lease-extraction-repair";
import type { NormalizerResponse } from "@/lib/types";
import { ClientDocumentPicker } from "@/components/workspace/ClientDocumentPicker";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import type { ClientWorkspaceDocument } from "@/lib/workspace/types";
import { isParseableWorkspaceDocument, normalizeWorkspaceDocument } from "@/lib/workspace/ingestion";
import { toDocumentNormalizeSnapshot } from "@/lib/workspace/document-cloud-payloads";
import { makeClientScopedStorageKey } from "@/lib/workspace/storage";
import { fetchWorkspaceCloudSection, saveWorkspaceCloudSection } from "@/lib/workspace/cloud";
import { preferLocalWhenRemoteEmpty } from "@/lib/workspace/account-sync";
import {
  buildTimelineBuckets,
  computeObligationCompleteness,
  computePortfolioMetrics,
  createDefaultCompany,
  findMatchingObligation,
  inferObligationDocumentKind,
  mapNormalizeToObligationSeed,
  pruneObligationsForAvailableSourceDocuments,
} from "@/lib/obligations/engine";
import type {
  ObligationCompany,
  ObligationDocumentRecord,
  ObligationRecord,
  ObligationStorageState,
} from "@/lib/obligations/types";

const STORAGE_KEY = "obligations_module_v1";

function nextId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function asText(value: unknown): string {
  return String(value || "").trim();
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Math.max(0, value || 0)
  );
}

function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.max(0, value || 0));
}

function formatIsoDate(value: string): string {
  const m = asText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return asText(value) || "-";
  return `${m[2]}.${m[3]}.${m[1]}`;
}

function toNormalizerResponseFromSnapshot(document: ClientWorkspaceDocument): NormalizerResponse | null {
  return normalizerResponseFromSnapshot(document.normalizeSnapshot);
}

function timelineDateCount(seed: ReturnType<typeof mapNormalizeToObligationSeed>): number {
  return [seed.noticeDate, seed.renewalDate, seed.terminationRightDate].filter(Boolean).length;
}

function obligationTimelineDateCount(obligation: Pick<ObligationRecord, "noticeDate" | "renewalDate" | "terminationRightDate">): number {
  return [obligation.noticeDate, obligation.renewalDate, obligation.terminationRightDate].filter(Boolean).length;
}

function fileFromDocumentPreview(document: ClientWorkspaceDocument): File | null {
  const dataUrl = asText(document.previewDataUrl);
  if (!dataUrl.startsWith("data:") || !dataUrl.includes(",")) return null;

  const [header, encoded] = dataUrl.split(",", 2);
  if (!encoded) return null;
  const mimeMatch = header.match(/^data:([^;]+);base64$/i);
  if (!mimeMatch) return null;

  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], document.name, { type: asText(document.fileMimeType) || mimeMatch[1] || "application/octet-stream" });
  } catch {
    return null;
  }
}

function mergeObligation(existing: ObligationRecord, seed: ReturnType<typeof mapNormalizeToObligationSeed>): ObligationRecord {
  const nowIso = new Date().toISOString();
  const next: ObligationRecord = {
    ...existing,
    title: seed.title || existing.title,
    buildingName: seed.buildingName || existing.buildingName,
    address: seed.address || existing.address,
    suite: seed.suite || existing.suite,
    floor: seed.floor || existing.floor,
    leaseType: seed.leaseType || existing.leaseType,
    rsf: seed.rsf > 0 ? seed.rsf : existing.rsf,
    commencementDate: seed.commencementDate || existing.commencementDate,
    expirationDate: seed.expirationDate || existing.expirationDate,
    rentCommencementDate: seed.rentCommencementDate || existing.rentCommencementDate,
    noticeDate: seed.noticeDate || existing.noticeDate,
    renewalDate: seed.renewalDate || existing.renewalDate,
    terminationRightDate: seed.terminationRightDate || existing.terminationRightDate,
    annualObligation: seed.annualObligation > 0 ? seed.annualObligation : existing.annualObligation,
    totalObligation: seed.totalObligation > 0 ? seed.totalObligation : existing.totalObligation,
    notes: [existing.notes, seed.notes].filter(Boolean).join("\n").trim(),
    updatedAtIso: nowIso,
  };
  next.completenessScore = computeObligationCompleteness(next);
  return next;
}

function createObligationFromSeed(
  clientId: string,
  companyId: string,
  seed: ReturnType<typeof mapNormalizeToObligationSeed>,
): ObligationRecord {
  const nowIso = new Date().toISOString();
  const base: ObligationRecord = {
    id: nextId(),
    clientId,
    companyId,
    title: seed.title,
    buildingName: seed.buildingName,
    address: seed.address,
    suite: seed.suite,
    floor: seed.floor,
    leaseType: seed.leaseType,
    rsf: seed.rsf,
    commencementDate: seed.commencementDate,
    expirationDate: seed.expirationDate,
    rentCommencementDate: seed.rentCommencementDate,
    noticeDate: seed.noticeDate,
    renewalDate: seed.renewalDate,
    terminationRightDate: seed.terminationRightDate,
    annualObligation: seed.annualObligation,
    totalObligation: seed.totalObligation,
    completenessScore: 0,
    sourceDocumentIds: [],
    linkedAnalysisCount: 0,
    linkedSurveyCount: 0,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
    notes: seed.notes,
  };
  base.completenessScore = computeObligationCompleteness(base);
  return base;
}

function kindChipClass(kind: string): string {
  if (kind === "lease") return "bg-cyan-500/15 text-cyan-100 border-cyan-300/60";
  if (kind === "amendment") return "bg-amber-500/15 text-amber-100 border-amber-300/60";
  if (kind === "proposal" || kind === "counter") return "bg-blue-500/15 text-blue-100 border-blue-300/60";
  if (kind === "sublease") return "bg-fuchsia-500/15 text-fuchsia-100 border-fuchsia-300/60";
  if (kind === "survey") return "bg-emerald-500/15 text-emerald-100 border-emerald-300/60";
  return "bg-white/10 text-slate-100 border-white/30";
}

const TIMELINE_EVENT_STYLES = {
  expiring: {
    label: "Expirations",
    border: "#38BDF8",
    fill: "#0EA5E9",
    track: "rgba(14, 165, 233, 0.14)",
    textClass: "text-sky-200",
  },
  notice: {
    label: "Notices",
    border: "#F97316",
    fill: "#EA580C",
    track: "rgba(234, 88, 12, 0.14)",
    textClass: "text-orange-200",
  },
  renewal: {
    label: "Renewals",
    border: "#84CC16",
    fill: "#65A30D",
    track: "rgba(101, 163, 13, 0.16)",
    textClass: "text-lime-200",
  },
  termination: {
    label: "Termination Rights",
    border: "#E879F9",
    fill: "#D946EF",
    track: "rgba(217, 70, 239, 0.14)",
    textClass: "text-fuchsia-200",
  },
} as const;

interface ObligationsWorkspaceProps {
  clientId: string;
  clientName?: string | null;
  pendingDocumentImport?: ClientWorkspaceDocument | null;
  onPendingDocumentImportHandled?: () => void;
}

export function ObligationsWorkspace({
  clientId,
  clientName,
  pendingDocumentImport = null,
  onPendingDocumentImportHandled,
}: ObligationsWorkspaceProps) {
  const { isAuthenticated, documents: clientDocuments, updateDocument } = useClientWorkspace();
  const resolvedClientName = asText(clientName);
  const defaultCompanyName = resolvedClientName || "Default Portfolio";
  const [companies, setCompanies] = useState<ObligationCompany[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState("");
  const [obligations, setObligations] = useState<ObligationRecord[]>([]);
  const [documents, setDocuments] = useState<ObligationDocumentRecord[]>([]);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [selectedObligationId, setSelectedObligationId] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("No obligation documents uploaded.");
  const [editingPanelsOpen, setEditingPanelsOpen] = useState(false);
  const obligationsRef = useRef<ObligationRecord[]>([]);
  const documentsRef = useRef<ObligationDocumentRecord[]>([]);
  const timelineRepairAttemptedRef = useRef<Set<string>>(new Set());
  const scopedStorageKey = useMemo(
    () => makeClientScopedStorageKey(STORAGE_KEY, clientId),
    [clientId],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    setStorageHydrated(false);
    setCompanies([]);
    setObligations([]);
    setDocuments([]);
    setSelectedObligationId("");
    setStatus("No obligation documents uploaded.");
    setError("");

    const applyParsed = (parsed: Partial<ObligationStorageState> | null) => {
      if (!parsed) {
        const fallback = createDefaultCompany(defaultCompanyName);
        setCompanies([fallback]);
        setActiveCompanyId(fallback.id);
        setStorageHydrated(true);
        return;
      }
      const rawCompanies = Array.isArray(parsed.companies) && parsed.companies.length > 0
        ? parsed.companies
        : [createDefaultCompany(defaultCompanyName)];
      const loadedCompanies = resolvedClientName
        ? rawCompanies.map((company, idx) => {
            const looksDefault = asText(company.name).toLowerCase() === "default portfolio";
            if (rawCompanies.length === 1 && idx === 0 && looksDefault) {
              return { ...company, name: resolvedClientName };
            }
            return company;
          })
        : rawCompanies;
      const nextActive = asText(parsed.activeCompanyId) && loadedCompanies.some((c) => c.id === parsed.activeCompanyId)
        ? asText(parsed.activeCompanyId)
        : loadedCompanies[0].id;
      const loadedObligations = Array.isArray(parsed.obligations) ? parsed.obligations : [];
      const loadedDocuments = Array.isArray(parsed.documents) ? parsed.documents : [];
      const nextSelected = asText(parsed.selectedObligationId) && loadedObligations.some((o) => o.id === parsed.selectedObligationId)
        ? asText(parsed.selectedObligationId)
        : (loadedObligations.find((o) => o.companyId === nextActive)?.id || "");
      const scopedObligations = loadedObligations.map((item) => ({ ...item, clientId }));
      const scopedDocuments = loadedDocuments.map((item) => ({ ...item, clientId }));
      setCompanies(loadedCompanies);
      setActiveCompanyId(nextActive);
      setObligations(scopedObligations);
      setDocuments(scopedDocuments);
      obligationsRef.current = scopedObligations;
      documentsRef.current = scopedDocuments;
      setSelectedObligationId(nextSelected);
      if (scopedObligations.length > 0 || scopedDocuments.length > 0) {
        setStatus(`Loaded ${scopedObligations.length} obligations and ${scopedDocuments.length} documents.`);
      }
      setStorageHydrated(true);
    };

    async function hydrate() {
      let localParsed: Partial<ObligationStorageState> | null = null;
      try {
        const raw = localStorage.getItem(scopedStorageKey);
        localParsed = raw ? (JSON.parse(raw) as Partial<ObligationStorageState>) : null;
      } catch {
        localParsed = null;
      }
      if (isAuthenticated) {
        try {
          const remote = await fetchWorkspaceCloudSection(scopedStorageKey);
          if (cancelled) return;
          applyParsed(
            preferLocalWhenRemoteEmpty(
              (remote.value as Partial<ObligationStorageState> | null) ?? null,
              localParsed,
              (value) =>
                (Array.isArray(value.obligations) && value.obligations.length > 0)
                || (Array.isArray(value.documents) && value.documents.length > 0)
                || (Array.isArray(value.companies) && value.companies.length > 0),
            ),
          );
          return;
        } catch (error) {
          console.warn("obligations_cloud_load_failed", error);
          if (cancelled) return;
        }
      }
      applyParsed(localParsed);
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [scopedStorageKey, clientId, isAuthenticated, defaultCompanyName, resolvedClientName]);

  useEffect(() => {
    obligationsRef.current = obligations;
  }, [obligations]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!storageHydrated) return;
    const payload: ObligationStorageState = {
      clientId,
      companies,
      obligations,
      documents,
      activeCompanyId,
      selectedObligationId,
    };
    localStorage.setItem(scopedStorageKey, JSON.stringify(payload));
    if (isAuthenticated) {
      void saveWorkspaceCloudSection(scopedStorageKey, payload).catch((error) => {
        console.warn("obligations_cloud_save_failed", error);
      });
      return;
    }
  }, [clientId, companies, obligations, documents, activeCompanyId, selectedObligationId, scopedStorageKey, isAuthenticated, storageHydrated]);

  const activeCompany = useMemo(
    () => companies.find((company) => company.id === activeCompanyId) ?? companies[0] ?? null,
    [companies, activeCompanyId]
  );

  const activeObligations = useMemo(
    () => obligations.filter((item) => item.companyId === activeCompanyId),
    [obligations, activeCompanyId]
  );

  const activeDocuments = useMemo(
    () => documents.filter((doc) => doc.companyId === activeCompanyId),
    [documents, activeCompanyId]
  );

  const selectedObligation = useMemo(
    () => activeObligations.find((item) => item.id === selectedObligationId) ?? activeObligations[0] ?? null,
    [activeObligations, selectedObligationId]
  );

  const metrics = useMemo(
    () => computePortfolioMetrics(activeObligations, activeDocuments.length, new Date()),
    [activeObligations, activeDocuments.length]
  );

  const timeline = useMemo(() => buildTimelineBuckets(activeObligations), [activeObligations]);

  useEffect(() => {
    if (!storageHydrated) return;
    const availableSourceDocumentIds = clientDocuments.map((doc) => doc.id).filter(Boolean);
    const linkedSourceDocumentIds = documents.map((doc) => doc.sourceDocumentId).filter(Boolean);
    if (linkedSourceDocumentIds.length === 0) return;

    const pruned = pruneObligationsForAvailableSourceDocuments(
      obligations,
      documents,
      availableSourceDocumentIds,
    );
    if (pruned.removedDocumentCount === 0) return;

    setDocuments(pruned.documents);
    setObligations(pruned.obligations);
    documentsRef.current = pruned.documents;
    obligationsRef.current = pruned.obligations;
    if (selectedObligationId && !pruned.obligations.some((item) => item.id === selectedObligationId)) {
      const nextSelected = pruned.obligations.find((item) => item.companyId === activeCompanyId)?.id || "";
      setSelectedObligationId(nextSelected);
    }
    const removedObligationText = pruned.removedObligationCount > 0
      ? ` and ${pruned.removedObligationCount} linked obligation${pruned.removedObligationCount === 1 ? "" : "s"}`
      : "";
    setStatus(`Removed ${pruned.removedDocumentCount} deleted source document${pruned.removedDocumentCount === 1 ? "" : "s"}${removedObligationText} from Obligations.`);
  }, [activeCompanyId, clientDocuments, documents, obligations, selectedObligationId, storageHydrated]);

  useEffect(() => {
    if (!selectedObligation && activeObligations.length > 0) {
      setSelectedObligationId(activeObligations[0].id);
      return;
    }
    if (selectedObligation && selectedObligation.companyId !== activeCompanyId) {
      setSelectedObligationId(activeObligations[0]?.id || "");
    }
  }, [selectedObligation, activeObligations, activeCompanyId]);

  const updateObligation = useCallback((obligationId: string, patch: Partial<ObligationRecord>) => {
    setObligations((prev) =>
      prev.map((item) => {
        if (item.id !== obligationId) return item;
        const next = { ...item, ...patch, updatedAtIso: new Date().toISOString() };
        next.completenessScore = computeObligationCompleteness(next);
        return next;
      })
    );
  }, []);

  const createCompany = useCallback(() => {
    const name = asText(newCompanyName);
    if (!name) return;
    const next = createDefaultCompany(name);
    setCompanies((prev) => [next, ...prev]);
    setActiveCompanyId(next.id);
    setSelectedObligationId("");
    setNewCompanyName("");
  }, [newCompanyName]);

  const ingestNormalize = useCallback(async (
    sourceName: string,
    normalize: NormalizerResponse,
    sourceDocumentId?: string,
  ) => {
    if (!activeCompanyId) return;
    const seed = mapNormalizeToObligationSeed(normalize, sourceName);
    const nowIso = new Date().toISOString();

    const currentObligations = obligationsRef.current;
    const matched = findMatchingObligation(currentObligations, activeCompanyId, seed);
    let obligationId = "";
    let nextBaseObligations: ObligationRecord[] = [];
    if (matched) {
      obligationId = matched.id;
      nextBaseObligations = currentObligations.map((item) => (item.id === matched.id ? mergeObligation(item, seed) : item));
    } else {
      const created = createObligationFromSeed(clientId, activeCompanyId, seed);
      obligationId = created.id;
      nextBaseObligations = [created, ...currentObligations];
    }

    const currentDocs = documentsRef.current;
    const existing = currentDocs.find((doc) =>
      doc.companyId === activeCompanyId && (
        (sourceDocumentId && doc.sourceDocumentId === sourceDocumentId)
        || doc.fileName === sourceName
      )
    );
    const nextDocRecord: ObligationDocumentRecord = {
      id: existing?.id || nextId(),
      clientId,
      sourceDocumentId,
      companyId: activeCompanyId,
      obligationId,
      fileName: sourceName,
      kind: inferObligationDocumentKind(sourceName, normalize),
      uploadedAtIso: nowIso,
      confidenceScore: Math.max(0, Math.min(1, asNumber(normalize.confidence_score))),
      reviewRequired: seed.reviewRequired,
      parseWarnings: seed.parseWarnings,
      extractionSummary: normalize.extraction_summary,
      canonical: normalize.canonical_lease,
    };
    const nextDocs = existing
      ? currentDocs.map((doc) => (doc.id === existing.id ? nextDocRecord : doc))
      : [nextDocRecord, ...currentDocs];

    const documentNamesByObligation = new Map<string, string[]>();
    for (const doc of nextDocs) {
      if (doc.companyId !== activeCompanyId) continue;
      const bucket = documentNamesByObligation.get(doc.obligationId) || [];
      bucket.push(doc.fileName);
      documentNamesByObligation.set(doc.obligationId, bucket);
    }

    const nextObligations = nextBaseObligations.map((item) => {
      if (item.companyId !== activeCompanyId) return item;
      const docsForObligation = documentNamesByObligation.get(item.id) || [];
      const changedDocs = docsForObligation.join("|") !== item.sourceDocumentIds.join("|");
      if (!changedDocs && item.id !== obligationId) return item;
      return {
        ...item,
        sourceDocumentIds: docsForObligation,
        updatedAtIso: item.id === obligationId ? nowIso : item.updatedAtIso,
      };
    });

    setDocuments(nextDocs);
    setObligations(nextObligations);
    documentsRef.current = nextDocs;
    obligationsRef.current = nextObligations;

    setSelectedObligationId(obligationId);
  }, [activeCompanyId, clientId]);

  const resolveNormalizeForImport = useCallback(async (document: ClientWorkspaceDocument): Promise<NormalizerResponse | null> => {
    const normalize = toNormalizerResponseFromSnapshot(document);
    if (!normalize) {
      return null;
    }

    const seed = mapNormalizeToObligationSeed(normalize, document.name);
    if (timelineDateCount(seed) >= 3 || !isParseableWorkspaceDocument(document.name)) {
      return normalize;
    }

    const sourceFile = fileFromDocumentPreview(document);
    if (!sourceFile) return normalize;

    try {
      setStatus(`Refreshing ${document.name} to capture obligation dates...`);
      const refreshedRaw = await normalizeWorkspaceDocument(sourceFile);
      const refreshed = repairNormalizerResponse(refreshedRaw) || refreshedRaw;
      if (!refreshed?.canonical_lease) return normalize;

      const refreshedSeed = mapNormalizeToObligationSeed(refreshed, document.name);
      if (timelineDateCount(refreshedSeed) <= timelineDateCount(seed)) return normalize;

      const refreshedSnapshot = toDocumentNormalizeSnapshot(refreshed);
      if (refreshedSnapshot?.canonical_lease) {
        updateDocument(document.id, {
          parsed: true,
          normalizeSnapshot: refreshedSnapshot,
          building: refreshedSeed.buildingName || document.building,
          address: refreshedSeed.address || document.address,
          suite: refreshedSeed.suite || document.suite,
        });
      }
      return refreshed;
    } catch (refreshError) {
      console.warn("[obligations] obligation_date_refresh_failed", document.id, refreshError);
      return normalize;
    }
  }, [updateDocument]);

  const onSelectExistingDocument = useCallback(async (document: ClientWorkspaceDocument) => {
    const normalize = await resolveNormalizeForImport(document);
    if (!normalize) {
      setError("Selected document has no parsed cloud payload yet. Keep the upload device online, then refresh and try Apply again.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      setStatus(`Importing ${document.name} from client library...`);
      await ingestNormalize(document.name, normalize, document.id);
      setStatus(`Imported ${document.name} from client document library.`);
    } catch (err) {
      setError(getDisplayErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [ingestNormalize, resolveNormalizeForImport]);

  useEffect(() => {
    if (!pendingDocumentImport) return;
    void onSelectExistingDocument(pendingDocumentImport).finally(() => {
      onPendingDocumentImportHandled?.();
    });
  }, [onPendingDocumentImportHandled, onSelectExistingDocument, pendingDocumentImport]);

  useEffect(() => {
    if (!storageHydrated || !activeCompanyId || loading) return;

    const staleLink = activeDocuments.find((doc) => {
      if (!doc.sourceDocumentId) return false;
      if (timelineRepairAttemptedRef.current.has(doc.sourceDocumentId)) return false;
      const obligation = activeObligations.find((item) => item.id === doc.obligationId);
      return obligation ? obligationTimelineDateCount(obligation) < 3 : false;
    });
    if (!staleLink?.sourceDocumentId) return;

    const sourceDocument = clientDocuments.find((doc) => doc.id === staleLink.sourceDocumentId);
    if (!sourceDocument) return;

    let cancelled = false;
    timelineRepairAttemptedRef.current.add(sourceDocument.id);
    void (async () => {
      setLoading(true);
      setError("");
      try {
        setStatus(`Refreshing ${sourceDocument.name} to fill missing obligation dates...`);
        const normalize = await resolveNormalizeForImport(sourceDocument);
        if (!normalize || cancelled) return;
        await ingestNormalize(sourceDocument.name, normalize, sourceDocument.id);
        if (!cancelled) setStatus(`Updated obligation dates from ${sourceDocument.name}.`);
      } catch (err) {
        if (!cancelled) setError(getDisplayErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeCompanyId,
    activeDocuments,
    activeObligations,
    clientDocuments,
    ingestNormalize,
    loading,
    resolveNormalizeForImport,
    storageHydrated,
  ]);

  useEffect(() => {
    if (!storageHydrated || !activeCompanyId || loading) return;
    const pendingDocs = clientDocuments.filter((document) => {
      if (document.sourceModule !== "obligations") return false;
      if (!document.normalizeSnapshot?.canonical_lease) return false;
      return !documents.some((record) => record.sourceDocumentId === document.id);
    });
    if (pendingDocs.length === 0) return;

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        for (const document of pendingDocs) {
          if (cancelled) return;
          const normalize = await resolveNormalizeForImport(document);
          if (!normalize) continue;
          await ingestNormalize(document.name, normalize, document.id);
        }
        if (!cancelled) {
          setStatus(`Imported ${pendingDocs.length} obligation document${pendingDocs.length === 1 ? "" : "s"} from this client's Obligations tab upload.`);
        }
      } catch (err) {
        if (!cancelled) setError(getDisplayErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, clientDocuments, documents, ingestNormalize, loading, resolveNormalizeForImport, storageHydrated]);

  const onReassignDocument = useCallback((documentId: string, nextObligationId: string) => {
    const target = obligationsRef.current.find((o) => o.id === nextObligationId);
    if (!target || target.companyId !== activeCompanyId) return;

    const nextDocs = documentsRef.current.map((doc) =>
      doc.id === documentId ? { ...doc, obligationId: nextObligationId } : doc
    );
    const nextObligations = obligationsRef.current.map((item) => {
      if (item.companyId !== activeCompanyId) return item;
      const docsForObligation = nextDocs
        .filter((doc) => doc.companyId === activeCompanyId && doc.obligationId === item.id)
        .map((doc) => doc.fileName);
      return {
        ...item,
        sourceDocumentIds: docsForObligation,
        updatedAtIso: new Date().toISOString(),
      };
    });

    setDocuments(nextDocs);
    setObligations(nextObligations);
    documentsRef.current = nextDocs;
    obligationsRef.current = nextObligations;
  }, [activeCompanyId]);

  return (
    <PlatformSection
      kicker="Obligations"
      title="Portfolio Obligation Command Center"
      description="Store company obligations, associate documents, and track expirations, notices, and risk from one workspace."
      headerAlign="center"
      actions={
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className={`btn-premium ${editingPanelsOpen ? "btn-premium-primary" : "btn-premium-secondary"}`}
            onClick={() => setEditingPanelsOpen((prev) => !prev)}
          >
            {editingPanelsOpen ? "Close Obligation Editor" : "Edit Obligation Details"}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <PlatformPanel kicker="Company" title="Workspace + Intake" className="xl:col-span-4">
          <label className="text-xs text-slate-300 block mb-1">Company workspace</label>
          <select
            value={activeCompanyId}
            onChange={(e) => setActiveCompanyId(e.target.value)}
            className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white"
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <input
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white"
              placeholder="Add company workspace"
            />
            <button type="button" className="btn-premium btn-premium-secondary" onClick={createCompany}>
              Add
            </button>
          </div>

          <div className="mt-4 border border-dashed border-white/20 bg-black/20 px-4 py-7 text-center">
            <p className="heading-kicker mb-2">Unified Document Intake</p>
            <p className="text-sm text-slate-200">Drop files anywhere on this tab to save them to this client and update obligations.</p>
            <p className="text-xs text-slate-400 mt-2">Parsed files auto-load here, and you can still select any existing client document below.</p>
          </div>
          <p className="text-xs text-slate-400 mt-3">{loading ? "Importing selected document..." : status}</p>
          <div className="mt-3">
            <ClientDocumentPicker
              buttonLabel="Select Existing Obligation Document"
              allowedTypes={["leases", "amendments", "proposals", "lois", "counters", "sublease documents", "redlines", "other"]}
              onSelectDocument={(doc) => {
                void onSelectExistingDocument(doc);
              }}
            />
          </div>
          {error ? <p className="text-xs text-red-300 mt-2">{error}</p> : null}
        </PlatformPanel>

        <PlatformPanel kicker="Portfolio" title={`${activeCompany?.name || "Portfolio"} Metrics`} className="xl:col-span-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="border border-white/15 p-3 bg-black/20">
              <p className="text-xs text-slate-400">Obligations</p>
              <p className="text-2xl text-white mt-1">{formatInt(metrics.obligationCount)}</p>
            </div>
            <div className="border border-white/15 p-3 bg-black/20">
              <p className="text-xs text-slate-400">Total RSF</p>
              <p className="text-2xl text-white mt-1">{formatInt(metrics.totalRsf)}</p>
            </div>
            <div className="border border-white/15 p-3 bg-black/20">
              <p className="text-xs text-slate-400">Annual Obligation</p>
              <p className="text-2xl text-white mt-1">{formatUsd(metrics.totalAnnualObligation)}</p>
            </div>
            <div className="border border-white/15 p-3 bg-black/20">
              <p className="text-xs text-slate-400">Documents</p>
              <p className="text-2xl text-white mt-1">{formatInt(metrics.documentCount)}</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-5 gap-3">
            <div className="border border-white/15 p-3 bg-black/20">
              <p className="text-xs text-slate-400">Expiring in 12 months</p>
              <p className="text-xl text-white mt-1">{formatInt(metrics.expiringWithin12Months)}</p>
            </div>
            <div className="border border-white/15 p-3 bg-black/20">
              <p className="text-xs text-slate-400">Notice in 6 months</p>
              <p className="text-xl text-white mt-1">{formatInt(metrics.upcomingNoticeWithin6Months)}</p>
            </div>
            <div className="border border-white/15 p-3 bg-black/20">
              <p className="text-xs text-slate-400">Renewal in 12 months</p>
              <p className="text-xl text-white mt-1">{formatInt(metrics.upcomingRenewalWithin12Months)}</p>
            </div>
            <div className="border border-white/15 p-3 bg-black/20">
              <p className="text-xs text-slate-400">Termination in 12 months</p>
              <p className="text-xl text-white mt-1">{formatInt(metrics.upcomingTerminationWithin12Months)}</p>
            </div>
            <div className="border border-white/15 p-3 bg-black/20">
              <p className="text-xs text-slate-400">Avg completeness</p>
              <p className="text-xl text-white mt-1">{metrics.averageCompleteness}%</p>
            </div>
          </div>

          <div className="mt-4 border border-white/15 p-3 bg-black/20">
            <p className="heading-kicker mb-2">Obligation event timeline</p>
            <div className="space-y-2">
              {timeline.map((bucket) => {
                const maxValue = Math.max(
                  1,
                  ...timeline.map((item) =>
                    Math.max(item.expiringCount, item.noticeCount, item.renewalCount, item.terminationCount)
                  )
                );
                const widthForCount = (count: number): string => {
                  if (count <= 0) return "0%";
                  return `${Math.max(8, Math.round((count / maxValue) * 100))}%`;
                };
                const expireWidth = widthForCount(bucket.expiringCount);
                const noticeWidth = widthForCount(bucket.noticeCount);
                const renewalWidth = widthForCount(bucket.renewalCount);
                const terminationWidth = widthForCount(bucket.terminationCount);
                return (
                  <div key={bucket.year} className="grid grid-cols-[70px_1fr_1fr_1fr_1fr] gap-2 items-center text-xs">
                    <span className="text-slate-300">{bucket.year}</span>
                    <div
                      className="h-2 border"
                      style={{
                        borderColor: TIMELINE_EVENT_STYLES.expiring.border,
                        backgroundColor: TIMELINE_EVENT_STYLES.expiring.track,
                      }}
                    >
                      <div
                        className="h-full"
                        style={{ width: expireWidth, backgroundColor: TIMELINE_EVENT_STYLES.expiring.fill }}
                      />
                    </div>
                    <div
                      className="h-2 border"
                      style={{
                        borderColor: TIMELINE_EVENT_STYLES.notice.border,
                        backgroundColor: TIMELINE_EVENT_STYLES.notice.track,
                      }}
                    >
                      <div
                        className="h-full"
                        style={{ width: noticeWidth, backgroundColor: TIMELINE_EVENT_STYLES.notice.fill }}
                      />
                    </div>
                    <div
                      className="h-2 border"
                      style={{
                        borderColor: TIMELINE_EVENT_STYLES.renewal.border,
                        backgroundColor: TIMELINE_EVENT_STYLES.renewal.track,
                      }}
                    >
                      <div
                        className="h-full"
                        style={{ width: renewalWidth, backgroundColor: TIMELINE_EVENT_STYLES.renewal.fill }}
                      />
                    </div>
                    <div
                      className="h-2 border"
                      style={{
                        borderColor: TIMELINE_EVENT_STYLES.termination.border,
                        backgroundColor: TIMELINE_EVENT_STYLES.termination.track,
                      }}
                    >
                      <div
                        className="h-full"
                        style={{ width: terminationWidth, backgroundColor: TIMELINE_EVENT_STYLES.termination.fill }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <span className={TIMELINE_EVENT_STYLES.expiring.textClass}>Expirations</span>
              <span className={TIMELINE_EVENT_STYLES.notice.textClass}>Notices</span>
              <span className={TIMELINE_EVENT_STYLES.renewal.textClass}>Renewals</span>
              <span className={TIMELINE_EVENT_STYLES.termination.textClass}>Termination rights</span>
            </div>
          </div>
        </PlatformPanel>

        <PlatformPanel
          kicker="Obligations"
          title="Obligation Repository"
          className={editingPanelsOpen ? "xl:col-span-8" : "xl:col-span-12"}
        >
          <div className="space-y-3 md:hidden">
            {activeObligations.length === 0 ? (
              <p className="py-4 text-sm text-slate-400">No obligations for this company yet.</p>
            ) : (
              activeObligations.map((item) => {
                const isActive = selectedObligation?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`w-full border p-3 text-left space-y-2 ${isActive ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/15 bg-black/20"}`}
                    onClick={() => setSelectedObligationId(item.id)}
                  >
                    <p className="text-sm text-white break-words">{item.title}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <p className="text-slate-400">Expiration: <span className="text-slate-200">{formatIsoDate(item.expirationDate)}</span></p>
                      <p className="text-slate-400">RSF: <span className="text-slate-200">{formatInt(item.rsf)}</span></p>
                      <p className="text-slate-400">Annual: <span className="text-slate-200">{formatUsd(item.annualObligation)}</span></p>
                      <p className="text-slate-400">Completeness: <span className="text-slate-200">{item.completenessScore}%</span></p>
                      <p className="text-slate-400">Docs: <span className="text-slate-200">{item.sourceDocumentIds.length}</span></p>
                      <p className="col-span-2 text-slate-400">Address: <span className="text-slate-200">{item.address || "-"}</span></p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/20">
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Obligation</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Address</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Expiration</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">RSF</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Annual</th>
                  <th className="text-left py-2 pr-3 text-slate-300 font-medium">Docs</th>
                  <th className="text-left py-2 text-slate-300 font-medium">Completeness</th>
                </tr>
              </thead>
              <tbody>
                {activeObligations.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-slate-400">No obligations for this company yet.</td>
                  </tr>
                ) : (
                  activeObligations.map((item) => {
                    const isActive = selectedObligation?.id === item.id;
                    return (
                      <tr
                        key={item.id}
                        className={`border-b border-white/10 cursor-pointer ${isActive ? "bg-cyan-500/10" : "hover:bg-white/5"}`}
                        onClick={() => setSelectedObligationId(item.id)}
                      >
                        <td className="py-2 pr-3 text-white">{item.title}</td>
                        <td className="py-2 pr-3 text-slate-200">{item.address || "-"}</td>
                        <td className="py-2 pr-3 text-slate-200">{formatIsoDate(item.expirationDate)}</td>
                        <td className="py-2 pr-3 text-slate-200">{formatInt(item.rsf)}</td>
                        <td className="py-2 pr-3 text-slate-200">{formatUsd(item.annualObligation)}</td>
                        <td className="py-2 pr-3 text-slate-200">{item.sourceDocumentIds.length}</td>
                        <td className="py-2 text-slate-200">{item.completenessScore}%</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </PlatformPanel>

        <PlatformPanel
          kicker="Documents"
          title="Document Associations"
          className={editingPanelsOpen ? "xl:col-span-4" : "hidden"}
        >
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {activeDocuments.length === 0 ? (
              <p className="text-sm text-slate-400">No documents uploaded for this company yet.</p>
            ) : (
              activeDocuments.map((doc) => (
                <div key={doc.id} className="border border-white/15 bg-black/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-white break-all">{doc.fileName}</p>
                    <span className={`text-[11px] px-2 py-0.5 border ${kindChipClass(doc.kind)}`}>{doc.kind}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Confidence: {Math.round(doc.confidenceScore * 100)}%</p>
                  <p className={`text-xs mt-1 ${doc.reviewRequired ? "text-amber-300" : "text-emerald-300"}`}>
                    {doc.reviewRequired ? "Needs review" : "Ready"}
                  </p>
                  <label className="text-xs text-slate-300 block mt-2 mb-1">Linked obligation</label>
                  <select
                    value={doc.obligationId}
                    onChange={(e) => onReassignDocument(doc.id, e.target.value)}
                    className="w-full border border-white/20 bg-black/30 px-2 py-1.5 text-xs text-white"
                  >
                    {activeObligations.map((obligation) => (
                      <option key={obligation.id} value={obligation.id}>
                        {obligation.title}
                      </option>
                    ))}
                  </select>
                  {doc.parseWarnings.length > 0 ? (
                    <p className="text-[11px] text-amber-300 mt-2">{doc.parseWarnings[0]}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </PlatformPanel>

        <PlatformPanel
          kicker="Obligation Detail"
          title={selectedObligation ? selectedObligation.title : "Select an obligation"}
          className={editingPanelsOpen ? "xl:col-span-12" : "hidden"}
        >
          {!selectedObligation ? (
            <p className="text-sm text-slate-400">Select an obligation from the repository to review and edit details.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-slate-300">Building</label>
                <input
                  className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white mt-1"
                  value={selectedObligation.buildingName}
                  onChange={(e) => updateObligation(selectedObligation.id, { buildingName: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-300">Address</label>
                <input
                  className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white mt-1"
                  value={selectedObligation.address}
                  onChange={(e) => updateObligation(selectedObligation.id, { address: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-300">Suite / Floor</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <input
                    className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white"
                    value={selectedObligation.suite}
                    onChange={(e) => updateObligation(selectedObligation.id, { suite: e.target.value })}
                    placeholder="Suite"
                  />
                  <input
                    className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white"
                    value={selectedObligation.floor}
                    onChange={(e) => updateObligation(selectedObligation.id, { floor: e.target.value })}
                    placeholder="Floor"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-300">Lease type</label>
                <input
                  className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white mt-1"
                  value={selectedObligation.leaseType}
                  onChange={(e) => updateObligation(selectedObligation.id, { leaseType: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs text-slate-300">RSF</label>
                <input
                  type="number"
                  min={0}
                  className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white mt-1"
                  value={selectedObligation.rsf}
                  onChange={(e) => updateObligation(selectedObligation.id, { rsf: Math.max(0, Math.floor(asNumber(e.target.value))) })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-300">Commencement</label>
                <input
                  type="date"
                  className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white mt-1"
                  value={selectedObligation.commencementDate}
                  onChange={(e) => updateObligation(selectedObligation.id, { commencementDate: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-300">Expiration</label>
                <input
                  type="date"
                  className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white mt-1"
                  value={selectedObligation.expirationDate}
                  onChange={(e) => updateObligation(selectedObligation.id, { expirationDate: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-300">Notice date</label>
                <input
                  type="date"
                  className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white mt-1"
                  value={selectedObligation.noticeDate}
                  onChange={(e) => updateObligation(selectedObligation.id, { noticeDate: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs text-slate-300">Renewal date</label>
                <input
                  type="date"
                  className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white mt-1"
                  value={selectedObligation.renewalDate}
                  onChange={(e) => updateObligation(selectedObligation.id, { renewalDate: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-300">Termination right date</label>
                <input
                  type="date"
                  className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white mt-1"
                  value={selectedObligation.terminationRightDate}
                  onChange={(e) => updateObligation(selectedObligation.id, { terminationRightDate: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-300">Annual obligation</label>
                <input
                  type="number"
                  min={0}
                  className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white mt-1"
                  value={selectedObligation.annualObligation}
                  onChange={(e) => updateObligation(selectedObligation.id, { annualObligation: Math.max(0, asNumber(e.target.value)) })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-300">Total obligation</label>
                <input
                  type="number"
                  min={0}
                  className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white mt-1"
                  value={selectedObligation.totalObligation}
                  onChange={(e) => updateObligation(selectedObligation.id, { totalObligation: Math.max(0, asNumber(e.target.value)) })}
                />
              </div>

              <div className="lg:col-span-2 xl:col-span-4">
                <label className="text-xs text-slate-300">Notes</label>
                <textarea
                  className="w-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white mt-1 min-h-[90px]"
                  value={selectedObligation.notes}
                  onChange={(e) => updateObligation(selectedObligation.id, { notes: e.target.value })}
                />
              </div>
            </div>
          )}
        </PlatformPanel>
      </div>
    </PlatformSection>
  );
}
