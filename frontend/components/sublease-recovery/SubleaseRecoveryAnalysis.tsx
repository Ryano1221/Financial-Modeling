"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScenarioWithId } from "@/lib/types";
import {
  buildExistingObligationFromScenario,
  buildSensitivity,
  cloneSubleaseScenario,
  defaultSubleaseScenarios,
  monthCountInclusive,
  runSubleaseRecoveryPortfolio,
} from "@/lib/sublease-recovery/engine";
import type { SubleaseScenario } from "@/lib/sublease-recovery/types";
import type { ImportedProposalFieldReview } from "@/lib/sublease-recovery/types";
import {
  mapProposalToScenarioDraft,
  normalizeProposalUpload,
  type ProposalImportDraft,
} from "@/lib/sublease-recovery/proposal-import";
import {
  buildSubleaseRecoveryExportFileName,
  buildSubleaseRecoveryWorkbook,
  downloadArrayBuffer,
  printSubleaseRecoverySummary,
  type SubleaseRecoveryExportBranding,
} from "@/lib/sublease-recovery/export";

const STORAGE_KEY = "sublease_recovery_analysis_scenarios_v2";

function parseIsoDate(value: string): Date {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(Date.UTC(2026, 0, 1));
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatIsoDate(value: Date): string {
  const yyyy = value.getUTCFullYear();
  const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(value.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addMonths(iso: string, months: number): string {
  const date = parseIsoDate(iso);
  const day = date.getUTCDate();
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const monthEnd = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, monthEnd));
  return formatIsoDate(next);
}

function endDateFromStartAndTerm(startIso: string, termMonths: number): string {
  const start = parseIsoDate(startIso);
  const endExclusive = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + termMonths, start.getUTCDate()));
  endExclusive.setUTCDate(endExclusive.getUTCDate() - 1);
  return formatIsoDate(endExclusive);
}

function toCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function toPercent(value: number): string {
  return `${((value || 0) * 100).toFixed(1)}%`;
}

function toPercentInput(decimal: number): string {
  return ((decimal || 0) * 100).toFixed(2);
}

function fromPercentInput(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed / 100;
}

function toDateLabel(iso: string): string {
  const [y, m, d] = String(iso || "").split("-");
  if (!y || !m || !d) return "-";
  return `${m}.${d}.${y}`;
}

function scenarioSeed(existingKey: string): string {
  return `seed:${existingKey}`;
}

function scenarioDisplayTitle(scenario: SubleaseScenario): string {
  const subtenant = String(scenario.subtenantName || "").trim();
  return subtenant ? `${scenario.name} · ${subtenant}` : scenario.name;
}

function normalizeStoredScenario(existing: ReturnType<typeof buildExistingObligationFromScenario>, scenario: SubleaseScenario): SubleaseScenario {
  return {
    ...scenario,
    subtenantName: String(scenario.subtenantName || "").trim(),
    subtenantLegalEntity: String(scenario.subtenantLegalEntity || "").trim(),
    dbaName: String(scenario.dbaName || "").trim(),
    guarantor: String(scenario.guarantor || "").trim(),
    brokerName: String(scenario.brokerName || "").trim(),
    industry: String(scenario.industry || "").trim(),
    subtenantNotes: String(scenario.subtenantNotes || "").trim(),
    sourceType: scenario.sourceType === "proposal_import" ? "proposal_import" : "manual",
    sourceDocumentName: String(scenario.sourceDocumentName || "").trim(),
    sourceProposalName: String(scenario.sourceProposalName || "").trim(),
    proposalDate: String(scenario.proposalDate || "").trim(),
    proposalExpirationDate: String(scenario.proposalExpirationDate || "").trim(),
    propertyName: String(scenario.propertyName || existing.premises).trim(),
    explicitBaseRentSchedule: (scenario.explicitBaseRentSchedule || []).map((step) => ({
      startMonth: Math.max(0, Math.floor(Number(step.startMonth) || 0)),
      endMonth: Math.max(0, Math.floor(Number(step.endMonth) || 0)),
      annualRatePsf: Math.max(0, Number(step.annualRatePsf) || 0),
    })),
  };
}

interface SubleaseRecoveryAnalysisProps {
  sourceScenario: ScenarioWithId | null;
  exportBranding?: SubleaseRecoveryExportBranding;
}

export function SubleaseRecoveryAnalysis({ sourceScenario, exportBranding = {} }: SubleaseRecoveryAnalysisProps) {
  const existing = useMemo(() => buildExistingObligationFromScenario(sourceScenario), [sourceScenario]);
  const existingKey = `${existing.premises}|${existing.commencementDate}|${existing.expirationDate}|${existing.rsf}`;

  const [scenarios, setScenarios] = useState<SubleaseScenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string>("");
  const [excelLoading, setExcelLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>("Not saved");
  const [importLoading, setImportLoading] = useState(false);
  const [importStatus, setImportStatus] = useState<string>("");
  const [importError, setImportError] = useState<string>("");
  const [proposalDraft, setProposalDraft] = useState<ProposalImportDraft | null>(null);
  const [proposalFieldReview, setProposalFieldReview] = useState<ImportedProposalFieldReview[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [globalDragActive, setGlobalDragActive] = useState(false);
  const proposalFileInputRef = useRef<HTMLInputElement | null>(null);
  const globalDragDepthRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { seed?: string; scenarios?: SubleaseScenario[] };
        if (parsed.seed === scenarioSeed(existingKey) && Array.isArray(parsed.scenarios) && parsed.scenarios.length > 0) {
          const restored = parsed.scenarios.map((scenario) => normalizeStoredScenario(existing, scenario));
          setScenarios(restored);
          setActiveScenarioId(restored[0].id);
          setSaveStatus("Loaded saved scenarios");
          return;
        }
      }
    } catch {
      // ignore parse issues and reset from baseline
    }
    const defaults = defaultSubleaseScenarios(existing).map((scenario) => normalizeStoredScenario(existing, scenario));
    setScenarios(defaults);
    setActiveScenarioId(defaults[0]?.id || "");
    setSaveStatus("Seeded from existing obligation");
  }, [existingKey, existing]);

  useEffect(() => {
    if (typeof window === "undefined" || scenarios.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ seed: scenarioSeed(existingKey), scenarios }));
      setSaveStatus(`Saved ${new Date().toLocaleTimeString()}`);
    } catch {
      setSaveStatus("Unable to save in this browser");
    }
  }, [scenarios, existingKey]);

  const activeScenario = scenarios.find((scenario) => scenario.id === activeScenarioId) ?? scenarios[0] ?? null;

  useEffect(() => {
    if (!activeScenario && scenarios[0]) setActiveScenarioId(scenarios[0].id);
  }, [activeScenario, scenarios]);

  const results = useMemo(() => runSubleaseRecoveryPortfolio(existing, scenarios), [existing, scenarios]);
  const activeResult = useMemo(() => results.find((result) => result.scenario.id === activeScenario?.id) ?? results[0] ?? null, [results, activeScenario?.id]);
  const sensitivity = useMemo(() => {
    if (!activeScenario) return null;
    return buildSensitivity(existing, activeScenario);
  }, [existing, activeScenario]);

  const baselineSummary = useMemo(() => {
    const first = results[0]?.summary;
    if (!first) return null;
    return {
      totalRemainingObligation: first.totalRemainingObligation,
      averageTotalCostPerMonth: first.totalRemainingObligation / Math.max(1, monthCountInclusive(existing.commencementDate, existing.expirationDate)),
      averageTotalCostPerYear:
        first.totalRemainingObligation /
        Math.max(1 / 12, monthCountInclusive(existing.commencementDate, existing.expirationDate) / 12),
    };
  }, [results, existing]);

  const updateScenario = (scenarioId: string, patch: Partial<SubleaseScenario>) => {
    setScenarios((prev) =>
      prev.map((scenario) => {
        if (scenario.id !== scenarioId) return scenario;
        const merged: SubleaseScenario = { ...scenario, ...patch };

        if (patch.downtimeMonths != null) {
          merged.subleaseCommencementDate = addMonths(existing.commencementDate, Math.max(0, Math.floor(patch.downtimeMonths)));
          merged.subleaseExpirationDate = endDateFromStartAndTerm(merged.subleaseCommencementDate, Math.max(1, Math.floor(merged.subleaseTermMonths)));
        }
        if (patch.subleaseCommencementDate != null) {
          const downtime = Math.max(0, monthCountInclusive(existing.commencementDate, patch.subleaseCommencementDate) - 1);
          merged.downtimeMonths = downtime;
          merged.subleaseExpirationDate = endDateFromStartAndTerm(merged.subleaseCommencementDate, Math.max(1, Math.floor(merged.subleaseTermMonths)));
        }
        if (patch.subleaseTermMonths != null) {
          merged.subleaseTermMonths = Math.max(1, Math.floor(patch.subleaseTermMonths));
          merged.subleaseExpirationDate = endDateFromStartAndTerm(merged.subleaseCommencementDate, merged.subleaseTermMonths);
        }
        if (patch.subleaseExpirationDate != null) {
          merged.subleaseTermMonths = Math.max(1, monthCountInclusive(merged.subleaseCommencementDate, patch.subleaseExpirationDate));
        }

        if (merged.phaseInEvents.length > 5) merged.phaseInEvents = merged.phaseInEvents.slice(0, 5);
        return merged;
      })
    );
  };

  const addScenario = () => {
    const next = normalizeStoredScenario(existing, defaultSubleaseScenarios(existing)[0]);
    const scenario: SubleaseScenario = {
      ...next,
      id: `custom-${Date.now().toString(36)}`,
      name: `Scenario ${scenarios.length + 1}`,
    };
    setScenarios((prev) => [...prev, scenario]);
    setActiveScenarioId(scenario.id);
  };

  const duplicateScenario = () => {
    if (!activeScenario) return;
    const clone = cloneSubleaseScenario(activeScenario);
    setScenarios((prev) => [...prev, clone]);
    setActiveScenarioId(clone.id);
  };

  const deleteScenario = (scenarioId: string) => {
    setScenarios((prev) => {
      const next = prev.filter((scenario) => scenario.id !== scenarioId);
      if (next.length > 0 && activeScenarioId === scenarioId) {
        setActiveScenarioId(next[0].id);
      }
      return next;
    });
  };

  const resetScenarios = () => {
    const defaults = defaultSubleaseScenarios(existing).map((scenario) => normalizeStoredScenario(existing, scenario));
    setScenarios(defaults);
    setActiveScenarioId(defaults[0]?.id || "");
    setSaveStatus("Reset from existing obligation");
  };

  const exportExcel = async () => {
    if (results.length === 0 || !sensitivity) return;
    setExcelLoading(true);
    try {
      const buffer = await buildSubleaseRecoveryWorkbook(existing, results, sensitivity, exportBranding);
      downloadArrayBuffer(
        buffer,
        buildSubleaseRecoveryExportFileName("xlsx", exportBranding),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    } finally {
      setExcelLoading(false);
    }
  };

  const exportPdf = () => {
    if (results.length === 0) return;
    setPdfLoading(true);
    try {
      printSubleaseRecoverySummary(existing, results, sensitivity, exportBranding);
    } finally {
      setPdfLoading(false);
    }
  };

  const applyProposalFieldChange = (fieldKey: string, nextValue: string | number) => {
    setProposalFieldReview((prevFields) => {
      const nextFields = prevFields.map((field) =>
        field.key === fieldKey
          ? { ...field, value: nextValue, accepted: true, needsReview: false }
          : field
      );
      setProposalDraft((prevDraft) => {
        if (!prevDraft) return prevDraft;
        const updatedScenario: SubleaseScenario = { ...prevDraft.scenario };
        const key = fieldKey as keyof SubleaseScenario;
        if (key in updatedScenario) {
          (updatedScenario as unknown as Record<string, unknown>)[fieldKey] = nextValue;
        }
        return { ...prevDraft, scenario: updatedScenario, fieldReview: nextFields };
      });
      return nextFields;
    });
  };

  const toggleProposalFieldAccepted = (fieldKey: string, accepted: boolean) => {
    setProposalFieldReview((prevFields) => {
      const nextFields = prevFields.map((field) =>
        field.key === fieldKey
          ? { ...field, accepted }
          : field
      );
      setProposalDraft((prevDraft) => {
        if (!prevDraft) return prevDraft;
        const updatedScenario: SubleaseScenario = { ...prevDraft.scenario };
        const target = nextFields.find((field) => field.key === fieldKey);
        const key = fieldKey as keyof SubleaseScenario;
        if (target && key in updatedScenario && !accepted) {
          const fallback = typeof target.value === "number" ? 0 : "";
          (updatedScenario as unknown as Record<string, unknown>)[fieldKey] = fallback;
        }
        return { ...prevDraft, scenario: updatedScenario, fieldReview: nextFields };
      });
      return nextFields;
    });
  };

  const processImportFiles = useCallback(async (incoming: FileList | File[] | null | undefined) => {
    const files = Array.from(incoming ?? []);
    if (files.length === 0) return;

    const accepted = files.filter((file) => {
      const name = String(file.name || "").toLowerCase();
      return name.endsWith(".pdf") || name.endsWith(".docx") || name.endsWith(".doc");
    });
    const rejectedCount = files.length - accepted.length;
    if (accepted.length === 0) {
      setImportError("Only .pdf, .docx, and .doc proposal files are supported.");
      setImportStatus("");
      return;
    }
    if (accepted.length > 1) {
      setImportStatus(`Detected ${accepted.length} supported files. Importing the first file: ${accepted[0].name}.`);
    } else if (rejectedCount > 0) {
      setImportStatus(`Imported 1 supported file. Ignored ${rejectedCount} unsupported file${rejectedCount === 1 ? "" : "s"}.`);
    }

    const file = accepted[0];
    setImportLoading(true);
    setImportError("");
    setImportStatus(`Parsing ${file.name}...`);
    try {
      const normalized = await normalizeProposalUpload(file);
      const draft = mapProposalToScenarioDraft(normalized, existing, file.name || "Uploaded proposal");
      setProposalDraft(draft);
      setProposalFieldReview(draft.fieldReview);
      setImportStatus(`Extracted proposal terms from ${file.name}. Review and approve below.`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Unable to parse proposal file.");
      setImportStatus("");
    } finally {
      setImportLoading(false);
    }
  }, [existing]);

  const isFileDragEvent = useCallback((event: DragEvent): boolean => {
    const dt = event.dataTransfer;
    if (!dt) return false;
    const types = Array.from(dt.types ?? []);
    return types.includes("Files");
  }, []);

  useEffect(() => {
    const onWindowDragEnter = (event: DragEvent) => {
      if (event.defaultPrevented || importLoading || !isFileDragEvent(event)) return;
      event.preventDefault();
      globalDragDepthRef.current += 1;
      setGlobalDragActive(true);
    };

    const onWindowDragOver = (event: DragEvent) => {
      if (event.defaultPrevented || importLoading || !isFileDragEvent(event)) return;
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
      if (event.defaultPrevented) {
        globalDragDepthRef.current = 0;
        setGlobalDragActive(false);
        return;
      }
      event.preventDefault();
      globalDragDepthRef.current = 0;
      setGlobalDragActive(false);
      void processImportFiles(event.dataTransfer?.files);
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
  }, [importLoading, isFileDragEvent, processImportFiles]);

  const saveProposalDraftScenario = () => {
    if (!proposalDraft) return;
    const scenarioToSave = normalizeStoredScenario(existing, {
      ...proposalDraft.scenario,
      importedProposalMeta: {
        ...proposalDraft.reviewMeta,
        extractedFields: proposalFieldReview,
      },
    });
    setScenarios((prev) => {
      const existingIdx = prev.findIndex((item) => item.id === scenarioToSave.id);
      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = scenarioToSave;
        return next;
      }
      return [...prev, scenarioToSave];
    });
    setActiveScenarioId(scenarioToSave.id);
    setProposalDraft(null);
    setProposalFieldReview([]);
    setImportStatus(`Created scenario: ${scenarioDisplayTitle(scenarioToSave)}`);
    setImportError("");
  };

  const openStoredProposalReview = (scenario: SubleaseScenario) => {
    if (!scenario.importedProposalMeta) return;
    const restored: ProposalImportDraft = {
      scenario,
      fieldReview: scenario.importedProposalMeta.extractedFields,
      parserConfidence: scenario.importedProposalMeta.parserConfidence,
      reviewMeta: scenario.importedProposalMeta,
    };
    setProposalDraft(restored);
    setProposalFieldReview(restored.fieldReview);
    setImportStatus(`Reviewing imported proposal for ${scenario.name}.`);
    setImportError("");
  };

  const renderSensitivityRow = (title: string, rows: Array<{ label: string; netObligation: number; recoveryPercent: number }>) => (
    <div className="border border-white/15 bg-black/30 p-3">
      <p className="heading-kicker mb-2">{title}</p>
      <div className="grid grid-cols-3 gap-2">
        {rows.map((row) => (
          <div key={`${title}-${row.label}`} className="border border-white/15 px-2 py-2">
            <p className="text-xs text-slate-400">{row.label}</p>
            <p className="text-sm text-white">{toCurrency(row.netObligation)}</p>
            <p className="text-xs text-cyan-200">{toPercent(row.recoveryPercent)}</p>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <section className="mx-auto w-full max-w-6xl border border-white/20 bg-black/55 backdrop-blur-[2px] p-4 sm:p-5">
      {globalDragActive && (
        <div className="pointer-events-none fixed inset-0 z-[70] border-2 border-dashed border-cyan-300/70 bg-cyan-500/10 backdrop-blur-[1px]">
          <div className="absolute inset-x-4 top-16 rounded-xl border border-cyan-200/70 bg-slate-900/90 px-4 py-3 text-center text-sm font-semibold tracking-tight text-cyan-100 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
            Drop proposal files anywhere to import into Sublease Recovery
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-center sm:items-start justify-center sm:justify-between gap-3 border-b border-white/15 pb-4 mb-4 text-center sm:text-left">
        <div className="w-full sm:w-auto">
          <h2 className="heading-section">Sublease Recovery Analysis</h2>
          <p className="text-sm text-slate-300 mt-1">
            Existing obligation is auto-seeded from your extracted lease data. Build and compare sublease scenarios side by side.
          </p>
        </div>
        <div className="flex w-full sm:w-auto flex-wrap justify-center sm:justify-end gap-2">
          <input
            ref={proposalFileInputRef}
            type="file"
            accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
            multiple
            className="hidden"
            onChange={(e) => {
              void processImportFiles(e.target.files);
              e.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            className="btn-premium btn-premium-success"
            onClick={() => proposalFileInputRef.current?.click()}
            disabled={importLoading}
          >
            {importLoading ? "Parsing Proposal…" : "Import Proposal"}
          </button>
          <button type="button" className="btn-premium btn-premium-secondary" onClick={addScenario}>Add Scenario</button>
          <button type="button" className="btn-premium btn-premium-secondary" onClick={duplicateScenario} disabled={!activeScenario}>Duplicate</button>
          <button type="button" className="btn-premium btn-premium-secondary" onClick={resetScenarios}>Reset</button>
          <button type="button" className="btn-premium btn-premium-success" onClick={exportExcel} disabled={excelLoading || results.length === 0}>
            {excelLoading ? "Exporting…" : "Export Excel"}
          </button>
          <button type="button" className="btn-premium btn-premium-secondary" onClick={exportPdf} disabled={pdfLoading || results.length === 0}>
            {pdfLoading ? "Preparing…" : "Export PDF Summary"}
          </button>
        </div>
      </div>

      <div
        className={`
          mb-4 rounded-xl border-2 border-dashed p-4 sm:p-5 text-center transition-all duration-200 cursor-pointer
          ${dragOver ? "border-cyan-300/70 bg-cyan-500/12 shadow-[0_0_0_1px_rgba(34,211,238,0.4),0_16px_45px_rgba(8,145,178,0.25)]" : "border-white/20 bg-black/25"}
          ${importLoading ? "opacity-75 pointer-events-none" : ""}
        `}
        onClick={() => {
          if (!importLoading) proposalFileInputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          void processImportFiles(e.dataTransfer.files);
        }}
      >
        <p className="heading-kicker mb-1">Upload Sublease Proposal</p>
        <p className="text-sm text-slate-200">
          Drag and drop one or more <strong>.pdf</strong>, <strong>.docx</strong>, or <strong>.doc</strong> proposal files here, or click to choose.
        </p>
        <p className="text-xs text-slate-400 mt-2">Parsed terms are reviewed before a scenario is created.</p>
        {importStatus && <p className="text-xs text-cyan-200 mt-2">{importStatus}</p>}
        {importError && <p className="text-xs text-rose-300 mt-2">{importError}</p>}
      </div>

      {proposalDraft && (
        <div className="mb-4 border border-amber-400/40 bg-amber-500/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <p className="heading-kicker">Imported Proposal Review</p>
              <p className="text-xs text-slate-200">
                Parser confidence: {(proposalDraft.parserConfidence * 100).toFixed(1)}% · Source: {proposalDraft.scenario.sourceDocumentName || "Uploaded proposal"}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-premium btn-premium-secondary text-xs"
                onClick={() => {
                  const accepted = proposalFieldReview.map((field) => ({ ...field, accepted: true, needsReview: false }));
                  setProposalFieldReview(accepted);
                  setProposalDraft((prev) => (prev ? { ...prev, fieldReview: accepted } : prev));
                }}
              >
                Accept All
              </button>
              <button
                type="button"
                className="btn-premium btn-premium-success text-xs"
                onClick={saveProposalDraftScenario}
              >
                Save as Scenario
              </button>
              <button
                type="button"
                className="btn-premium btn-premium-secondary text-xs"
                onClick={() => {
                  setProposalDraft(null);
                  setProposalFieldReview([]);
                }}
              >
                Cancel
              </button>
            </div>
          </div>

          <div className="max-h-[320px] overflow-auto border border-white/20 bg-black/35">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-950/95">
                <tr>
                  <th className="px-2 py-2 text-left">Field</th>
                  <th className="px-2 py-2 text-left">Value</th>
                  <th className="px-2 py-2 text-left">Use</th>
                  <th className="px-2 py-2 text-left">Confidence</th>
                  <th className="px-2 py-2 text-left">Source Snippet</th>
                </tr>
              </thead>
              <tbody>
                {proposalFieldReview.map((field) => (
                  <tr key={field.key} className={`border-t border-white/10 ${field.needsReview ? "bg-amber-500/10" : ""}`}>
                    <td className="px-2 py-1.5 align-top text-slate-200">{field.label}</td>
                    <td className="px-2 py-1.5 align-top">
                      <input
                        className="input-premium text-xs"
                        value={String(field.value ?? "")}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const nextValue = typeof field.value === "number"
                            ? (Number.isFinite(Number(raw)) ? Number(raw) : 0)
                            : raw;
                          applyProposalFieldChange(field.key, nextValue);
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <input
                        type="checkbox"
                        checked={field.accepted}
                        onChange={(e) => toggleProposalFieldAccepted(field.key, e.target.checked)}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-top text-slate-300">
                      {field.confidence == null ? "—" : `${(field.confidence * 100).toFixed(0)}%`}
                    </td>
                    <td className="px-2 py-1.5 align-top text-slate-400">
                      {field.sourceSnippet || "No snippet"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mb-4 border border-white/15 bg-black/25 p-3 text-center sm:text-left">
        <p className="heading-kicker mb-2">Existing Obligation (Auto-Populated)</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm justify-items-center sm:justify-items-start">
          <div><span className="text-slate-400">Premises:</span> <span className="text-white">{existing.premises}</span></div>
          <div><span className="text-slate-400">RSF:</span> <span className="text-white">{existing.rsf.toLocaleString()}</span></div>
          <div><span className="text-slate-400">Commencement:</span> <span className="text-white">{toDateLabel(existing.commencementDate)}</span></div>
          <div><span className="text-slate-400">Expiration:</span> <span className="text-white">{toDateLabel(existing.expirationDate)}</span></div>
          <div><span className="text-slate-400">Lease Type:</span> <span className="text-white uppercase">{existing.leaseType.replace("_", " ")}</span></div>
          <div><span className="text-slate-400">Base OpEx:</span> <span className="text-white">{toCurrency(existing.baseOperatingExpense)}/SF/YR</span></div>
          <div><span className="text-slate-400">Parking Spaces:</span> <span className="text-white">{existing.allottedParkingSpaces}</span></div>
          <div><span className="text-slate-400">Saved Scenarios:</span> <span className="text-white">{saveStatus}</span></div>
        </div>
      </div>

      <div className="flex flex-wrap justify-center sm:justify-start gap-2 mb-4">
        {scenarios.map((scenario) => {
          const selected = scenario.id === activeScenario?.id;
          return (
            <button
              key={scenario.id}
              type="button"
              onClick={() => setActiveScenarioId(scenario.id)}
              className={`px-3 py-2 text-sm border ${selected ? "border-cyan-300 bg-cyan-500/20 text-cyan-100" : "border-white/20 text-slate-200 hover:bg-white/5"}`}
            >
              <div className="text-left">
                <div>{scenario.name}</div>
                <div className="text-[11px] text-slate-300">
                  {scenario.subtenantName ? `Subtenant: ${scenario.subtenantName}` : "Subtenant: —"}
                  {scenario.sourceType === "proposal_import" ? " · Imported" : ""}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {activeScenario ? (
        <div className="space-y-4">
          <aside className="grid grid-cols-1 xl:grid-cols-2 gap-3 content-start">
            <div className="border border-white/15 bg-black/35 p-3">
              <p className="heading-kicker mb-2">General Inputs</p>
              <label className="block text-xs text-slate-400 mb-1">Scenario name</label>
              <input
                className="input-premium mb-2"
                value={activeScenario.name}
                onChange={(e) => updateScenario(activeScenario.id, { name: e.target.value })}
              />
              <label className="block text-xs text-slate-400 mb-1">Subtenant name</label>
              <input
                className="input-premium mb-2"
                value={activeScenario.subtenantName}
                onChange={(e) => updateScenario(activeScenario.id, { subtenantName: e.target.value })}
                placeholder="Confidential Tech Tenant"
              />
              <label className="block text-xs text-slate-400 mb-1">Subtenant legal entity (optional)</label>
              <input
                className="input-premium mb-2"
                value={activeScenario.subtenantLegalEntity || ""}
                onChange={(e) => updateScenario(activeScenario.id, { subtenantLegalEntity: e.target.value })}
              />
              <label className="block text-xs text-slate-400 mb-1">Guarantor (optional)</label>
              <input
                className="input-premium mb-2"
                value={activeScenario.guarantor || ""}
                onChange={(e) => updateScenario(activeScenario.id, { guarantor: e.target.value })}
              />
              {activeScenario.sourceType === "proposal_import" && (
                <div className="border border-white/15 bg-black/30 p-2 mb-2 text-xs text-slate-300">
                  <p><span className="text-slate-400">Source:</span> {activeScenario.sourceDocumentName || "Imported proposal"}</p>
                  {activeScenario.sourceProposalName && <p><span className="text-slate-400">Proposal:</span> {activeScenario.sourceProposalName}</p>}
                  {activeScenario.importedProposalMeta && (
                    <p><span className="text-slate-400">Parser confidence:</span> {(activeScenario.importedProposalMeta.parserConfidence * 100).toFixed(1)}%</p>
                  )}
                  {activeScenario.importedProposalMeta && (
                    <button
                      type="button"
                      className="btn-premium btn-premium-secondary text-xs mt-2"
                      onClick={() => openStoredProposalReview(activeScenario)}
                    >
                      Reopen Parsed Terms Review
                    </button>
                  )}
                </div>
              )}
              <label className="block text-xs text-slate-400 mb-1">Downtime (months)</label>
              <input
                className="input-premium mb-2"
                type="number"
                min={0}
                value={activeScenario.downtimeMonths}
                onChange={(e) => updateScenario(activeScenario.id, { downtimeMonths: Math.max(0, Number(e.target.value) || 0) })}
              />
              <label className="block text-xs text-slate-400 mb-1">Sublease commencement</label>
              <input
                className="input-premium mb-2"
                type="date"
                value={activeScenario.subleaseCommencementDate}
                onChange={(e) => updateScenario(activeScenario.id, { subleaseCommencementDate: e.target.value })}
              />
              <label className="block text-xs text-slate-400 mb-1">Term (months)</label>
              <input
                className="input-premium mb-2"
                type="number"
                min={1}
                value={activeScenario.subleaseTermMonths}
                onChange={(e) => updateScenario(activeScenario.id, { subleaseTermMonths: Math.max(1, Number(e.target.value) || 1) })}
              />
              <label className="block text-xs text-slate-400 mb-1">Sublease expiration</label>
              <input
                className="input-premium mb-2"
                type="date"
                value={activeScenario.subleaseExpirationDate}
                onChange={(e) => updateScenario(activeScenario.id, { subleaseExpirationDate: e.target.value })}
              />
              <label className="block text-xs text-slate-400 mb-1">RSF</label>
              <input
                className="input-premium mb-2"
                type="number"
                min={0}
                value={activeScenario.rsf}
                onChange={(e) => updateScenario(activeScenario.id, { rsf: Math.max(0, Number(e.target.value) || 0) })}
              />
              <label className="block text-xs text-slate-400 mb-1">Lease type</label>
              <select
                className="input-premium mb-2"
                value={activeScenario.leaseType}
                onChange={(e) => updateScenario(activeScenario.id, { leaseType: e.target.value as SubleaseScenario["leaseType"] })}
              >
                <option value="nnn">NNN</option>
                <option value="full_service">Full Service</option>
                <option value="base_year">Base Year</option>
                <option value="modified_gross">Modified Gross</option>
                <option value="expense_stop">Expense Stop</option>
              </select>
              <label className="block text-xs text-slate-400 mb-1">Discount rate (%)</label>
              <input
                className="input-premium"
                type="number"
                step="0.1"
                value={toPercentInput(activeScenario.discountRate)}
                onChange={(e) => updateScenario(activeScenario.id, { discountRate: fromPercentInput(e.target.value) })}
              />
            </div>

            <div className="border border-white/15 bg-black/35 p-3">
              <p className="heading-kicker mb-2">Rent Inputs</p>
              {activeScenario.explicitBaseRentSchedule && activeScenario.explicitBaseRentSchedule.length > 1 && (
                <div className="border border-cyan-300/30 bg-cyan-500/10 p-2 mb-2 text-xs text-cyan-100">
                  Using explicit rent schedule extracted from proposal ({activeScenario.explicitBaseRentSchedule.length} steps).
                </div>
              )}
              <label className="block text-xs text-slate-400 mb-1">Base rent</label>
              <input className="input-premium mb-2" type="number" value={activeScenario.baseRent} onChange={(e) => updateScenario(activeScenario.id, { baseRent: Math.max(0, Number(e.target.value) || 0) })} />
              <label className="block text-xs text-slate-400 mb-1">Rent input type</label>
              <select className="input-premium mb-2" value={activeScenario.rentInputType} onChange={(e) => updateScenario(activeScenario.id, { rentInputType: e.target.value as SubleaseScenario["rentInputType"] })}>
                <option value="annual_psf">Annual per RSF</option>
                <option value="monthly_amount">Monthly amount</option>
              </select>
              <label className="block text-xs text-slate-400 mb-1">Annual base rent escalation (%)</label>
              <input className="input-premium mb-2" type="number" step="0.1" value={toPercentInput(activeScenario.annualBaseRentEscalation)} onChange={(e) => updateScenario(activeScenario.id, { annualBaseRentEscalation: fromPercentInput(e.target.value) })} />
              <label className="block text-xs text-slate-400 mb-1">Escalation type</label>
              <select className="input-premium mb-2" value={activeScenario.rentEscalationType} onChange={(e) => updateScenario(activeScenario.id, { rentEscalationType: e.target.value as SubleaseScenario["rentEscalationType"] })}>
                <option value="percent">Percent</option>
                <option value="dollar">Dollar</option>
              </select>
              <label className="block text-xs text-slate-400 mb-1">Base operating expense ($/SF/YR)</label>
              <input className="input-premium mb-2" type="number" value={activeScenario.baseOperatingExpense} onChange={(e) => updateScenario(activeScenario.id, { baseOperatingExpense: Math.max(0, Number(e.target.value) || 0) })} />
              <label className="block text-xs text-slate-400 mb-1">Annual operating expense escalation (%)</label>
              <input className="input-premium" type="number" step="0.1" value={toPercentInput(activeScenario.annualOperatingExpenseEscalation)} onChange={(e) => updateScenario(activeScenario.id, { annualOperatingExpenseEscalation: fromPercentInput(e.target.value) })} />
            </div>

            <div className="border border-white/15 bg-black/35 p-3">
              <p className="heading-kicker mb-2">Sublease Costs</p>
              <label className="block text-xs text-slate-400 mb-1">Rent abatement start date</label>
              <input className="input-premium mb-2" type="date" value={activeScenario.rentAbatementStartDate} onChange={(e) => updateScenario(activeScenario.id, { rentAbatementStartDate: e.target.value })} />
              <label className="block text-xs text-slate-400 mb-1">Rent abatement months</label>
              <input className="input-premium mb-2" type="number" min={0} value={activeScenario.rentAbatementMonths} onChange={(e) => updateScenario(activeScenario.id, { rentAbatementMonths: Math.max(0, Number(e.target.value) || 0) })} />
              <label className="block text-xs text-slate-400 mb-1">Rent abatement type</label>
              <select className="input-premium mb-2" value={activeScenario.rentAbatementType} onChange={(e) => updateScenario(activeScenario.id, { rentAbatementType: e.target.value as SubleaseScenario["rentAbatementType"] })}>
                <option value="base">Base</option>
                <option value="gross">Gross</option>
                <option value="custom">Custom</option>
              </select>
              {activeScenario.rentAbatementType === "custom" && (
                <>
                  <label className="block text-xs text-slate-400 mb-1">Custom monthly abatement ($)</label>
                  <input className="input-premium mb-2" type="number" min={0} value={activeScenario.customAbatementMonthlyAmount} onChange={(e) => updateScenario(activeScenario.id, { customAbatementMonthlyAmount: Math.max(0, Number(e.target.value) || 0) })} />
                </>
              )}
              <label className="block text-xs text-slate-400 mb-1">Commission (%)</label>
              <input className="input-premium mb-2" type="number" step="0.1" value={toPercentInput(activeScenario.commissionPercent)} onChange={(e) => updateScenario(activeScenario.id, { commissionPercent: fromPercentInput(e.target.value) })} />
              <label className="block text-xs text-slate-400 mb-1">Construction budget ($)</label>
              <input className="input-premium mb-2" type="number" min={0} value={activeScenario.constructionBudget} onChange={(e) => updateScenario(activeScenario.id, { constructionBudget: Math.max(0, Number(e.target.value) || 0) })} />
              <label className="block text-xs text-slate-400 mb-1">TI allowance to subtenant ($)</label>
              <input className="input-premium mb-2" type="number" min={0} value={activeScenario.tiAllowanceToSubtenant} onChange={(e) => updateScenario(activeScenario.id, { tiAllowanceToSubtenant: Math.max(0, Number(e.target.value) || 0) })} />
              <label className="block text-xs text-slate-400 mb-1">Legal & miscellaneous fees ($)</label>
              <input className="input-premium mb-2" type="number" min={0} value={activeScenario.legalMiscFees} onChange={(e) => updateScenario(activeScenario.id, { legalMiscFees: Math.max(0, Number(e.target.value) || 0) })} />
              <label className="block text-xs text-slate-400 mb-1">Other one-time costs ($)</label>
              <input className="input-premium" type="number" min={0} value={activeScenario.otherOneTimeCosts} onChange={(e) => updateScenario(activeScenario.id, { otherOneTimeCosts: Math.max(0, Number(e.target.value) || 0) })} />
            </div>

            <div className="border border-white/15 bg-black/35 p-3">
              <p className="heading-kicker mb-2">Parking Inputs</p>
              <label className="block text-xs text-slate-400 mb-1">Parking ratio (per 1,000 RSF)</label>
              <input className="input-premium mb-2" type="number" step="0.01" value={activeScenario.parkingRatio} onChange={(e) => updateScenario(activeScenario.id, { parkingRatio: Math.max(0, Number(e.target.value) || 0) })} />
              <label className="block text-xs text-slate-400 mb-1">Allotted spaces</label>
              <input className="input-premium mb-2" type="number" min={0} value={activeScenario.allottedParkingSpaces} onChange={(e) => updateScenario(activeScenario.id, { allottedParkingSpaces: Math.max(0, Number(e.target.value) || 0) })} />
              <label className="block text-xs text-slate-400 mb-1">Reserved paid spaces</label>
              <input className="input-premium mb-2" type="number" min={0} value={activeScenario.reservedPaidSpaces} onChange={(e) => updateScenario(activeScenario.id, { reservedPaidSpaces: Math.max(0, Number(e.target.value) || 0) })} />
              <label className="block text-xs text-slate-400 mb-1">Unreserved paid spaces</label>
              <input className="input-premium mb-2" type="number" min={0} value={activeScenario.unreservedPaidSpaces} onChange={(e) => updateScenario(activeScenario.id, { unreservedPaidSpaces: Math.max(0, Number(e.target.value) || 0) })} />
              <label className="block text-xs text-slate-400 mb-1">Parking cost per space ($/month)</label>
              <input className="input-premium mb-2" type="number" min={0} value={activeScenario.parkingCostPerSpace} onChange={(e) => updateScenario(activeScenario.id, { parkingCostPerSpace: Math.max(0, Number(e.target.value) || 0) })} />
              <label className="block text-xs text-slate-400 mb-1">Annual parking escalation (%)</label>
              <input className="input-premium" type="number" step="0.1" value={toPercentInput(activeScenario.annualParkingEscalation)} onChange={(e) => updateScenario(activeScenario.id, { annualParkingEscalation: fromPercentInput(e.target.value) })} />
            </div>

            <div className="border border-white/15 bg-black/35 p-3 xl:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <p className="heading-kicker">Rent Phase In (max 5)</p>
                <button
                  type="button"
                  className="btn-premium btn-premium-secondary px-2 py-1 text-xs"
                  onClick={() => {
                    if (activeScenario.phaseInEvents.length >= 5) return;
                    const nextEvent = {
                      id: `phase-${Date.now().toString(36)}`,
                      startDate: activeScenario.subleaseCommencementDate,
                      rsfIncrease: 0,
                    };
                    updateScenario(activeScenario.id, { phaseInEvents: [...activeScenario.phaseInEvents, nextEvent] });
                  }}
                >
                  Add event
                </button>
              </div>
              {activeScenario.phaseInEvents.length === 0 ? (
                <p className="text-xs text-slate-500">No phase-in events configured.</p>
              ) : (
                <div className="space-y-2">
                  {activeScenario.phaseInEvents.map((event) => (
                    <div key={event.id} className="border border-white/15 p-2">
                      <label className="block text-xs text-slate-400 mb-1">Start date</label>
                      <input
                        className="input-premium mb-2"
                        type="date"
                        value={event.startDate}
                        onChange={(e) => {
                          const next = activeScenario.phaseInEvents.map((row) => row.id === event.id ? { ...row, startDate: e.target.value } : row);
                          updateScenario(activeScenario.id, { phaseInEvents: next });
                        }}
                      />
                      <label className="block text-xs text-slate-400 mb-1">RSF increase</label>
                      <input
                        className="input-premium mb-2"
                        type="number"
                        min={0}
                        value={event.rsfIncrease}
                        onChange={(e) => {
                          const next = activeScenario.phaseInEvents.map((row) => row.id === event.id ? { ...row, rsfIncrease: Math.max(0, Number(e.target.value) || 0) } : row);
                          updateScenario(activeScenario.id, { phaseInEvents: next });
                        }}
                      />
                      <button
                        type="button"
                        className="btn-premium btn-premium-secondary text-xs"
                        onClick={() => {
                          const next = activeScenario.phaseInEvents.filter((row) => row.id !== event.id);
                          updateScenario(activeScenario.id, { phaseInEvents: next });
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 xl:col-span-2">
              <button type="button" className="btn-premium btn-premium-secondary w-full" onClick={duplicateScenario}>
                Duplicate Scenario
              </button>
              <button type="button" className="btn-premium btn-premium-secondary w-full" onClick={() => deleteScenario(activeScenario.id)} disabled={scenarios.length <= 1}>
                Delete Scenario
              </button>
            </div>
          </aside>

          <div className="space-y-4">
            {activeResult && (
              <>
                <div className="border border-white/15 bg-black/30 p-3 text-sm text-slate-200">
                  <span className="text-slate-400">Scenario:</span> {activeResult.summary.scenarioName}
                  {" · "}
                  <span className="text-slate-400">Subtenant:</span> {activeResult.scenario.subtenantName || "—"}
                  {activeResult.scenario.sourceType === "proposal_import" && (
                    <>
                      {" · "}
                      <span className="text-slate-400">Source:</span> {activeResult.scenario.sourceDocumentName || "Imported proposal"}
                    </>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3">
                  <div className="border border-white/15 bg-black/30 p-3">
                    <p className="text-xs text-slate-400">Total Remaining Obligation</p>
                    <p className="text-base sm:text-lg leading-tight break-all text-white">{toCurrency(activeResult.summary.totalRemainingObligation)}</p>
                  </div>
                  <div className="border border-white/15 bg-black/30 p-3">
                    <p className="text-xs text-slate-400">Net Sublease Recovery</p>
                    <p className="text-base sm:text-lg leading-tight break-all text-cyan-100">{toCurrency(activeResult.summary.netSubleaseRecovery)}</p>
                  </div>
                  <div className="border border-white/15 bg-black/30 p-3">
                    <p className="text-xs text-slate-400">Net Obligation</p>
                    <p className="text-base sm:text-lg leading-tight break-all text-white">{toCurrency(activeResult.summary.netObligation)}</p>
                  </div>
                  <div className="border border-white/15 bg-black/30 p-3">
                    <p className="text-xs text-slate-400">Recovery % | NPV</p>
                    <p className="text-base sm:text-lg leading-tight text-white">{toPercent(activeResult.summary.recoveryPercent)}</p>
                    <p className="text-xs leading-tight break-all text-slate-400">NPV: {toCurrency(activeResult.summary.npv)}</p>
                  </div>
                </div>

                <div className="border border-white/15 bg-black/30 p-3">
                  <p className="heading-kicker mb-2">Monthly Cash Flow</p>
                  <div className="max-h-[420px] overflow-auto border border-white/15">
                    <table className="w-full min-w-[1160px] text-[11px] whitespace-nowrap">
                      <thead className="sticky top-0 bg-slate-950/95 z-10">
                        <tr className="text-slate-300">
                          <th className="px-1.5 py-2 text-left leading-tight">Month</th>
                          <th className="px-1.5 py-2 text-left leading-tight">Date</th>
                          <th className="px-1.5 py-2 text-right leading-tight">Occupied RSF</th>
                          <th className="px-1.5 py-2 text-right leading-tight">Base Rent</th>
                          <th className="px-1.5 py-2 text-right leading-tight">OpEx</th>
                          <th className="px-1.5 py-2 text-right leading-tight">Parking</th>
                          <th className="px-1.5 py-2 text-right leading-tight">TI Amort.</th>
                          <th className="px-1.5 py-2 text-right leading-tight">Gross Rent</th>
                          <th className="px-1.5 py-2 text-right leading-tight">Abatements</th>
                          <th className="px-1.5 py-2 text-right leading-tight">Net Rent</th>
                          <th className="px-1.5 py-2 text-right leading-tight">One-Time</th>
                          <th className="px-1.5 py-2 text-right leading-tight">Recovery</th>
                          <th className="px-1.5 py-2 text-right leading-tight">Net Obligation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeResult.monthly.map((row) => (
                          <tr key={`${row.monthNumber}-${row.date}`} className="border-t border-white/10 hover:bg-white/[0.03]">
                            <td className="px-1.5 py-1.5">{row.monthNumber}</td>
                            <td className="px-1.5 py-1.5">{toDateLabel(row.date)}</td>
                            <td className="px-1.5 py-1.5 text-right">{row.occupiedRsf.toLocaleString()}</td>
                            <td className="px-1.5 py-1.5 text-right">{toCurrency(row.baseRent)}</td>
                            <td className="px-1.5 py-1.5 text-right">{toCurrency(row.operatingExpenses)}</td>
                            <td className="px-1.5 py-1.5 text-right">{toCurrency(row.parking)}</td>
                            <td className="px-1.5 py-1.5 text-right">{toCurrency(row.tiAmortization)}</td>
                            <td className="px-1.5 py-1.5 text-right">{toCurrency(row.grossMonthlyRent)}</td>
                            <td className="px-1.5 py-1.5 text-right">{toCurrency(row.abatementsOrCredits)}</td>
                            <td className="px-1.5 py-1.5 text-right">{toCurrency(row.netMonthlyRent)}</td>
                            <td className="px-1.5 py-1.5 text-right">{toCurrency(row.oneTimeCosts)}</td>
                            <td className="px-1.5 py-1.5 text-right">{toCurrency(row.subleaseRecovery)}</td>
                            <td className="px-1.5 py-1.5 text-right font-medium">{toCurrency(row.netObligation)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-400">Add a scenario to start the analysis.</p>
      )}

      <div className="mt-5 border border-white/15 bg-black/30 p-3">
        <p className="heading-kicker mb-2">Scenario Comparison</p>
        <div className="overflow-x-auto border border-white/15">
          <table className="w-full min-w-[1620px] text-xs sm:text-sm whitespace-nowrap">
            <thead className="bg-slate-950/90">
              <tr className="text-slate-300">
                <th className="px-3 py-2 text-left">Case</th>
                <th className="px-3 py-2 text-left">Subtenant</th>
                <th className="px-3 py-2 text-right">Total Remaining Obligation</th>
                <th className="px-3 py-2 text-right">Total Sublease Recovery</th>
                <th className="px-3 py-2 text-right">Total Sublease Costs</th>
                <th className="px-3 py-2 text-right">Net Sublease Recovery</th>
                <th className="px-3 py-2 text-right">Net Obligation</th>
                <th className="px-3 py-2 text-right">Recovery %</th>
                <th className="px-3 py-2 text-right">Recovery % / SF</th>
                <th className="px-3 py-2 text-right">Avg Cost / SF / Year</th>
                <th className="px-3 py-2 text-right">Avg Cost / Month</th>
                <th className="px-3 py-2 text-right">Avg Cost / Year</th>
                <th className="px-3 py-2 text-right">NPV</th>
              </tr>
            </thead>
            <tbody>
              {baselineSummary && (
                <tr className="border-t border-white/10 hover:bg-white/[0.03]">
                  <td className="px-3 py-2">Existing Obligation</td>
                  <td className="px-3 py-2">—</td>
                  <td className="px-3 py-2 text-right">{toCurrency(baselineSummary.totalRemainingObligation)}</td>
                  <td className="px-3 py-2 text-right">-</td>
                  <td className="px-3 py-2 text-right">-</td>
                  <td className="px-3 py-2 text-right">-</td>
                  <td className="px-3 py-2 text-right">{toCurrency(baselineSummary.totalRemainingObligation)}</td>
                  <td className="px-3 py-2 text-right">0.0%</td>
                  <td className="px-3 py-2 text-right">0.0%</td>
                  <td className="px-3 py-2 text-right">{toCurrency((baselineSummary.totalRemainingObligation / Math.max(1, existing.rsf)) / Math.max(1 / 12, monthCountInclusive(existing.commencementDate, existing.expirationDate) / 12))}</td>
                  <td className="px-3 py-2 text-right">{toCurrency(baselineSummary.averageTotalCostPerMonth)}</td>
                  <td className="px-3 py-2 text-right">{toCurrency(baselineSummary.averageTotalCostPerYear)}</td>
                  <td className="px-3 py-2 text-right">-</td>
                </tr>
              )}
              {results.map((result) => (
                <tr key={result.scenario.id} className="border-t border-white/10 hover:bg-white/[0.03]">
                  <td className="px-3 py-2">{result.summary.scenarioName}</td>
                  <td className="px-3 py-2">{result.scenario.subtenantName || "—"}</td>
                  <td className="px-3 py-2 text-right">{toCurrency(result.summary.totalRemainingObligation)}</td>
                  <td className="px-3 py-2 text-right">{toCurrency(result.summary.totalSubleaseRecovery)}</td>
                  <td className="px-3 py-2 text-right">{toCurrency(result.summary.totalSubleaseCosts)}</td>
                  <td className="px-3 py-2 text-right">{toCurrency(result.summary.netSubleaseRecovery)}</td>
                  <td className="px-3 py-2 text-right">{toCurrency(result.summary.netObligation)}</td>
                  <td className="px-3 py-2 text-right">{toPercent(result.summary.recoveryPercent)}</td>
                  <td className="px-3 py-2 text-right">{toPercent(result.summary.recoveryPercentPerSf)}</td>
                  <td className="px-3 py-2 text-right">{toCurrency(result.summary.averageTotalCostPerSfPerYear)}</td>
                  <td className="px-3 py-2 text-right">{toCurrency(result.summary.averageTotalCostPerMonth)}</td>
                  <td className="px-3 py-2 text-right">{toCurrency(result.summary.averageTotalCostPerYear)}</td>
                  <td className="px-3 py-2 text-right">{toCurrency(result.summary.npv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sensitivity && (
        <div className="mt-5 border border-white/15 bg-black/30 p-3 space-y-3">
          <p className="heading-kicker">Sensitivity Analysis</p>
          <div className="overflow-x-auto border border-white/15">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="bg-slate-950/90">
                <tr>
                  <th className="px-2 py-2 text-left text-slate-300">Downtime \\ Base Rent</th>
                  {sensitivity.baseRentValues.map((rent) => (
                    <th key={`rent-${rent}`} className="px-2 py-2 text-right text-slate-300">{rent.toFixed(2)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sensitivity.downtimeValues.map((downtime) => (
                  <tr key={`downtime-${downtime}`} className="border-t border-white/10">
                    <td className="px-2 py-2 text-slate-200">{downtime} months</td>
                    {sensitivity.baseRentValues.map((rent) => {
                      const cell = sensitivity.matrix.find((item) => item.downtimeMonths === downtime && item.baseRent === rent);
                      const heat = cell ? Math.max(-1, Math.min(1, cell.recoveryPercent * 2)) : 0;
                      const alpha = Math.abs(heat) * 0.35 + 0.08;
                      const bg = heat >= 0
                        ? `rgba(34,197,94,${alpha.toFixed(2)})`
                        : `rgba(239,68,68,${alpha.toFixed(2)})`;
                      return (
                        <td key={`cell-${downtime}-${rent}`} className="px-2 py-2 text-right" style={{ backgroundColor: bg }}>
                          <div className="text-white">{cell ? toCurrency(cell.netObligation) : "-"}</div>
                          <div className="text-[11px] text-slate-200">{cell ? toPercent(cell.recoveryPercent) : ""}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {renderSensitivityRow("Term", sensitivity.termSensitivity)}
            {renderSensitivityRow("Commission", sensitivity.commissionSensitivity)}
            {renderSensitivityRow("TI + Legal", sensitivity.tiLegalSensitivity)}
            {renderSensitivityRow("Operating Expense", sensitivity.opexSensitivity)}
          </div>
        </div>
      )}
    </section>
  );
}
