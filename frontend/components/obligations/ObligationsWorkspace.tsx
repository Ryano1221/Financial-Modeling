"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlatformPanel, PlatformSection } from "@/components/platform/PlatformShell";
import { fetchApi, getDisplayErrorMessage } from "@/lib/api";
import type { NormalizerResponse } from "@/lib/types";
import {
  buildTimelineBuckets,
  computeObligationCompleteness,
  computePortfolioMetrics,
  createDefaultCompany,
  findMatchingObligation,
  inferObligationDocumentKind,
  mapNormalizeToObligationSeed,
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

function createObligationFromSeed(companyId: string, seed: ReturnType<typeof mapNormalizeToObligationSeed>): ObligationRecord {
  const nowIso = new Date().toISOString();
  const base: ObligationRecord = {
    id: nextId(),
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

export function ObligationsWorkspace() {
  const [companies, setCompanies] = useState<ObligationCompany[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState("");
  const [obligations, setObligations] = useState<ObligationRecord[]>([]);
  const [documents, setDocuments] = useState<ObligationDocumentRecord[]>([]);
  const [selectedObligationId, setSelectedObligationId] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("No obligation documents uploaded.");
  const [dragOver, setDragOver] = useState(false);
  const [globalDragActive, setGlobalDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const globalDragDepthRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const fallback = createDefaultCompany();
        setCompanies([fallback]);
        setActiveCompanyId(fallback.id);
        return;
      }
      const parsed = JSON.parse(raw) as Partial<ObligationStorageState>;
      const loadedCompanies = Array.isArray(parsed.companies) && parsed.companies.length > 0
        ? parsed.companies
        : [createDefaultCompany()];
      const nextActive = asText(parsed.activeCompanyId) && loadedCompanies.some((c) => c.id === parsed.activeCompanyId)
        ? asText(parsed.activeCompanyId)
        : loadedCompanies[0].id;
      const loadedObligations = Array.isArray(parsed.obligations) ? parsed.obligations : [];
      const loadedDocuments = Array.isArray(parsed.documents) ? parsed.documents : [];
      const nextSelected = asText(parsed.selectedObligationId) && loadedObligations.some((o) => o.id === parsed.selectedObligationId)
        ? asText(parsed.selectedObligationId)
        : (loadedObligations.find((o) => o.companyId === nextActive)?.id || "");
      setCompanies(loadedCompanies);
      setActiveCompanyId(nextActive);
      setObligations(loadedObligations);
      setDocuments(loadedDocuments);
      setSelectedObligationId(nextSelected);
      if (loadedObligations.length > 0 || loadedDocuments.length > 0) {
        setStatus(`Loaded ${loadedObligations.length} obligations and ${loadedDocuments.length} documents.`);
      }
    } catch {
      const fallback = createDefaultCompany();
      setCompanies([fallback]);
      setActiveCompanyId(fallback.id);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || companies.length === 0) return;
    const payload: ObligationStorageState = {
      companies,
      obligations,
      documents,
      activeCompanyId,
      selectedObligationId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [companies, obligations, documents, activeCompanyId, selectedObligationId]);

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

  const parseDocument = useCallback(async (file: File) => {
    const lower = file.name.toLowerCase();
    const isDoc = lower.endsWith(".pdf") || lower.endsWith(".docx") || lower.endsWith(".doc");
    if (!isDoc) {
      throw new Error(`Unsupported file type for ${file.name}. Use PDF, DOCX, or DOC.`);
    }

    const form = new FormData();
    form.append("source", lower.endsWith(".pdf") ? "PDF" : "WORD");
    form.append("file", file);
    const res = await fetchApi("/normalize", { method: "POST", body: form });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Normalize request failed (${res.status}).`);
    }
    return (await res.json()) as NormalizerResponse;
  }, []);

  const processFiles = useCallback(async (incoming: FileList | File[] | null | undefined) => {
    if (!activeCompanyId) return;
    const files = Array.from(incoming ?? []);
    if (files.length === 0) return;
    setLoading(true);
    setError("");

    try {
      let processed = 0;
      for (const file of files) {
        setStatus(`Processing ${file.name}...`);
        const normalize = await parseDocument(file);
        const seed = mapNormalizeToObligationSeed(normalize, file.name);

        let obligationId = "";
        setObligations((prev) => {
          const matched = findMatchingObligation(prev, activeCompanyId, seed);
          if (!matched) {
            const created = createObligationFromSeed(activeCompanyId, seed);
            obligationId = created.id;
            return [created, ...prev];
          }
          obligationId = matched.id;
          return prev.map((item) => (item.id === matched.id ? mergeObligation(item, seed) : item));
        });

        if (!obligationId) {
          const fallback = activeObligations[0];
          obligationId = fallback?.id || "";
        }

        if (obligationId) {
          setObligations((prev) =>
            prev.map((item) => {
              if (item.id !== obligationId) return item;
              if (item.sourceDocumentIds.includes(file.name)) return item;
              return { ...item, sourceDocumentIds: [file.name, ...item.sourceDocumentIds], updatedAtIso: new Date().toISOString() };
            })
          );

          const doc: ObligationDocumentRecord = {
            id: nextId(),
            companyId: activeCompanyId,
            obligationId,
            fileName: file.name,
            kind: inferObligationDocumentKind(file.name, normalize),
            uploadedAtIso: new Date().toISOString(),
            confidenceScore: Math.max(0, Math.min(1, asNumber(normalize.confidence_score))),
            reviewRequired: seed.reviewRequired,
            parseWarnings: seed.parseWarnings,
            extractionSummary: normalize.extraction_summary,
            canonical: normalize.canonical_lease,
          };
          setDocuments((prev) => [doc, ...prev]);
          setSelectedObligationId(obligationId);
        }

        processed += 1;
      }
      setStatus(`Processed ${processed} document${processed === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(getDisplayErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, parseDocument, activeObligations]);

  const isFileDragEvent = useCallback((event: DragEvent): boolean => {
    const dt = event.dataTransfer;
    if (!dt) return false;
    return Array.from(dt.types || []).includes("Files");
  }, []);

  useEffect(() => {
    const onWindowDragEnter = (event: DragEvent) => {
      if (loading || !isFileDragEvent(event)) return;
      event.preventDefault();
      globalDragDepthRef.current += 1;
      setGlobalDragActive(true);
    };
    const onWindowDragOver = (event: DragEvent) => {
      if (loading || !isFileDragEvent(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setGlobalDragActive(true);
    };
    const onWindowDragLeave = (event: DragEvent) => {
      if (!isFileDragEvent(event)) return;
      globalDragDepthRef.current = Math.max(0, globalDragDepthRef.current - 1);
      if (globalDragDepthRef.current === 0) setGlobalDragActive(false);
    };
    const onWindowDrop = (event: DragEvent) => {
      if (!isFileDragEvent(event)) return;
      event.preventDefault();
      globalDragDepthRef.current = 0;
      setGlobalDragActive(false);
      void processFiles(event.dataTransfer?.files);
    };
    window.addEventListener("dragenter", onWindowDragEnter);
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("dragleave", onWindowDragLeave);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragenter", onWindowDragEnter);
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("dragleave", onWindowDragLeave);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, [isFileDragEvent, loading, processFiles]);

  const onReassignDocument = useCallback((documentId: string, nextObligationId: string) => {
    const target = obligations.find((o) => o.id === nextObligationId);
    if (!target || target.companyId !== activeCompanyId) return;

    setDocuments((prev) => prev.map((doc) => (doc.id === documentId ? { ...doc, obligationId: nextObligationId } : doc)));

    setObligations((prev) =>
      prev.map((item) => {
        if (item.companyId !== activeCompanyId) return item;
        const docsForObligation = documents
          .map((doc) => (doc.id === documentId ? { ...doc, obligationId: nextObligationId } : doc))
          .filter((doc) => doc.companyId === activeCompanyId && doc.obligationId === item.id)
          .map((doc) => doc.fileName);
        return {
          ...item,
          sourceDocumentIds: docsForObligation,
          updatedAtIso: new Date().toISOString(),
        };
      })
    );
  }, [obligations, documents, activeCompanyId]);

  return (
    <PlatformSection
      kicker="Obligations"
      title="Portfolio Obligation Command Center"
      description="Store company obligations, associate documents, and track expirations, notices, and risk from one workspace."
      actions={
        <button
          type="button"
          className="btn-premium btn-premium-secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading || !activeCompanyId}
        >
          {loading ? "Processing..." : "Upload Obligation Docs"}
        </button>
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

          <div
            role="button"
            tabIndex={0}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void processFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={`mt-4 cursor-pointer border border-dashed px-4 py-7 text-center transition-colors ${
              dragOver || globalDragActive ? "border-cyan-300 bg-cyan-500/10" : "border-white/20 bg-black/20"
            }`}
          >
            <p className="heading-kicker mb-2">Upload leases + amendments + proposals</p>
            <p className="text-sm text-slate-200">Drop PDF, DOCX, or DOC files to classify and map obligations.</p>
            <p className="text-xs text-slate-400 mt-2">Documents are auto-associated and flagged for review when confidence is low.</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.doc,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            className="hidden"
            onChange={(e) => {
              void processFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <p className="text-xs text-slate-400 mt-3">{status}</p>
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

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="border border-white/15 p-3 bg-black/20">
              <p className="text-xs text-slate-400">Expiring in 12 months</p>
              <p className="text-xl text-white mt-1">{formatInt(metrics.expiringWithin12Months)}</p>
            </div>
            <div className="border border-white/15 p-3 bg-black/20">
              <p className="text-xs text-slate-400">Notice in 6 months</p>
              <p className="text-xl text-white mt-1">{formatInt(metrics.upcomingNoticeWithin6Months)}</p>
            </div>
            <div className="border border-white/15 p-3 bg-black/20">
              <p className="text-xs text-slate-400">Avg completeness</p>
              <p className="text-xl text-white mt-1">{metrics.averageCompleteness}%</p>
            </div>
          </div>

          <div className="mt-4 border border-white/15 p-3 bg-black/20">
            <p className="heading-kicker mb-2">Expiration + notice timeline</p>
            <div className="space-y-2">
              {timeline.map((bucket) => {
                const maxValue = Math.max(
                  1,
                  ...timeline.map((item) => Math.max(item.expiringCount, item.noticeCount))
                );
                const expireWidth = `${Math.round((bucket.expiringCount / maxValue) * 100)}%`;
                const noticeWidth = `${Math.round((bucket.noticeCount / maxValue) * 100)}%`;
                return (
                  <div key={bucket.year} className="grid grid-cols-[70px_1fr_1fr] gap-2 items-center text-xs">
                    <span className="text-slate-300">{bucket.year}</span>
                    <div className="h-2 border border-cyan-300/40 bg-cyan-500/15">
                      <div className="h-full bg-cyan-300" style={{ width: expireWidth }} />
                    </div>
                    <div className="h-2 border border-amber-300/40 bg-amber-500/15">
                      <div className="h-full bg-amber-300" style={{ width: noticeWidth }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Cyan bars = expirations. Amber bars = notice events.</p>
          </div>
        </PlatformPanel>

        <PlatformPanel kicker="Obligations" title="Obligation Repository" className="xl:col-span-8">
          <div className="overflow-x-auto">
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

        <PlatformPanel kicker="Documents" title="Document Associations" className="xl:col-span-4">
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

        <PlatformPanel kicker="Obligation Detail" title={selectedObligation ? selectedObligation.title : "Select an obligation"} className="xl:col-span-12">
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
