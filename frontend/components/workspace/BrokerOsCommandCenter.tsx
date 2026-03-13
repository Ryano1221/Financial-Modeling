"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { PlatformPanel } from "@/components/platform/PlatformShell";
import { useBrokerOs } from "@/components/workspace/BrokerOsProvider";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { getDisplayErrorMessage } from "@/lib/api";
import { normalizeWorkspaceDocument } from "@/lib/workspace/ingestion";
import { LANDLORD_REP_MODE } from "@/lib/workspace/representation-mode";

function formatDateTime(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return date.toLocaleString();
}

export function BrokerOsCommandCenter() {
  const { activeClient, representationMode, registerDocument } = useClientWorkspace();
  const { graph, artifacts, runAiCommand, suggestPlan } = useBrokerOs();
  const isLandlordMode = representationMode === LANDLORD_REP_MODE;
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [resultSummary, setResultSummary] = useState("");
  const [resultError, setResultError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const plan = useMemo(() => suggestPlan(command), [command, suggestPlan]);

  const processFiles = useCallback(async (incoming: FileList | File[] | null | undefined) => {
    if (!activeClient) return;
    const files = Array.from(incoming ?? []);
    if (files.length === 0) return;
    setUploading(true);
    setUploadError("");
    setUploadStatus("");
    try {
      let processed = 0;
      for (const file of files) {
        setUploadStatus(`Ingesting ${file.name}...`);
        let normalize = null;
        try {
          normalize = await normalizeWorkspaceDocument(file);
        } catch {
          normalize = null;
        }
        await registerDocument({
          clientId: activeClient.id,
          name: file.name,
          file,
          sourceModule: "document-center",
          normalize,
          parsed: Boolean(normalize),
        });
        processed += 1;
      }
      setUploadStatus(`Ingested ${processed} document${processed === 1 ? "" : "s"} to ${activeClient.name} Document Center.`);
    } catch (error) {
      setUploadError(getDisplayErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }, [activeClient, registerDocument]);

  if (!activeClient) return null;

  return (
    <section className="scroll-mt-24 bg-grid mt-6">
      <div className="mx-auto w-full max-w-[96vw] grid grid-cols-1 lg:grid-cols-12 gap-4">
        <PlatformPanel
          kicker="AI Orchestration"
          title="Brokerage OS Command Center"
          className="lg:col-span-8"
        >
          <p className="text-sm text-slate-300 mb-3">
            {isLandlordMode
              ? "Run structured landlord workflows across listings, inquiries, tours, proposals, leases, reporting, exports, and share links."
              : "Run structured workflows across deals, documents, surveys, analyses, lease abstracts, obligations, exports, and share links."}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void processFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
              setDragOver(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOver(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOver(false);
              void processFiles(event.dataTransfer.files);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={`mb-3 cursor-pointer border border-dashed p-4 text-center transition-colors ${
              dragOver ? "border-cyan-300 bg-cyan-500/10" : "border-white/20 bg-black/20"
            }`}
          >
            <p className="heading-kicker mb-1">Command Center Document Intake</p>
            <p className="text-xs text-slate-300">
              Drop files here to ingest into the shared Document Center library, or click to upload.
            </p>
          </div>
          <textarea
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            className="input-premium w-full min-h-[96px]"
            placeholder={
              isLandlordMode
                ? 'Example: "Generate a landlord report for active spaces, tours, and proposal pipeline."'
                : 'Example: "Run a sublease recovery using the Austin obligation and these three proposals."'
            }
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-premium btn-premium-primary disabled:opacity-50"
              disabled={running || !command.trim()}
              onClick={() => {
                setRunning(true);
                setResultError("");
                setResultSummary("");
                void runAiCommand(command)
                  .then((result) => {
                    const failed = result.results.filter((item) => !item.ok);
                    const succeeded = result.results.filter((item) => item.ok);
                    const summary = [
                      `Intent: ${result.resolvedIntent}`,
                      `${succeeded.length} tool action(s) succeeded`,
                      failed.length > 0 ? `${failed.length} action(s) failed` : "No failures",
                      failed.length > 0 ? `Failure: ${failed[0]?.message || ""}` : "",
                    ]
                      .filter(Boolean)
                      .join(" | ");
                    setResultSummary(summary);
                  })
                  .catch((error) => {
                    setResultError(String(error instanceof Error ? error.message : error || "Unable to run AI command."));
                  })
                  .finally(() => setRunning(false));
              }}
            >
              {running ? "Running..." : "Run AI Workflow"}
            </button>
            <button
              type="button"
              className="btn-premium btn-premium-secondary disabled:opacity-50"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading..." : "Upload Documents"}
            </button>
            <button
              type="button"
              className="btn-premium btn-premium-secondary"
              onClick={() => {
                setCommand("");
                setResultSummary("");
                setResultError("");
              }}
            >
              Clear
            </button>
          </div>
          <div className="mt-3 border border-white/15 bg-black/25 p-3">
            <p className="heading-kicker mb-2">Resolved Tool Plan</p>
            <p className="text-xs text-slate-300 mb-2">Intent: {plan.resolvedIntent || "-"}</p>
            <ul className="text-xs text-slate-300 space-y-1">
              {plan.toolCalls.length === 0 ? (
                <li>No tool calls planned.</li>
              ) : (
                plan.toolCalls.map((call, idx) => (
                  <li key={`${call.tool}-${idx}`}>• {call.tool}</li>
                ))
              )}
            </ul>
          </div>
          {uploadStatus ? <p className="mt-3 text-xs text-emerald-200">{uploadStatus}</p> : null}
          {uploadError ? <p className="mt-3 text-xs text-red-300">{uploadError}</p> : null}
          {resultSummary ? <p className="mt-3 text-xs text-cyan-200">{resultSummary}</p> : null}
          {resultError ? <p className="mt-3 text-xs text-red-300">{resultError}</p> : null}
        </PlatformPanel>

        <PlatformPanel
          kicker="Shared Graph"
          title={`${activeClient.name} Entity Snapshot`}
          className="lg:col-span-4"
        >
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="border border-white/10 bg-black/20 p-2">
              <p className="text-xs text-slate-400">{isLandlordMode ? "Inquiries" : "Deals"}</p>
              <p className="text-white">{graph.deals.length}</p>
            </div>
            <div className="border border-white/10 bg-black/20 p-2">
              <p className="text-xs text-slate-400">Documents</p>
              <p className="text-white">{graph.documents.length}</p>
            </div>
            <div className="border border-white/10 bg-black/20 p-2">
              <p className="text-xs text-slate-400">{isLandlordMode ? "Marketing Sets" : "Surveys"}</p>
              <p className="text-white">{graph.surveys.length}</p>
            </div>
            <div className="border border-white/10 bg-black/20 p-2">
              <p className="text-xs text-slate-400">Survey Entries</p>
              <p className="text-white">{graph.surveyEntries.length}</p>
            </div>
            <div className="border border-white/10 bg-black/20 p-2">
              <p className="text-xs text-slate-400">Analyses</p>
              <p className="text-white">{graph.financialAnalyses.length}</p>
            </div>
            <div className="border border-white/10 bg-black/20 p-2">
              <p className="text-xs text-slate-400">{isLandlordMode ? "Reporting Rows" : "Obligations"}</p>
              <p className="text-white">{graph.obligations.length}</p>
            </div>
          </div>
          <div className="mt-3 border border-white/10 bg-black/20 p-2">
            <p className="text-xs text-slate-400">Workflow Stages</p>
            <p className="text-xs text-slate-200 mt-1">{graph.deals.map((deal) => deal.stage).slice(0, 4).join(" | ") || "-"}</p>
          </div>
        </PlatformPanel>

        <PlatformPanel
          kicker="Logs"
          title="Activity + Change + Audit"
          className="lg:col-span-12"
        >
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <div className="border border-white/10 bg-black/20 p-3">
              <p className="heading-kicker mb-2">Activity</p>
              <div className="space-y-2 max-h-[220px] overflow-auto">
                {artifacts.activityLog.slice(0, 12).map((item) => (
                  <div key={item.id} className="border border-white/10 bg-black/20 p-2">
                    <p className="text-xs text-white">{item.label}</p>
                    <p className="text-[11px] text-slate-400">{item.description}</p>
                    <p className="text-[10px] text-slate-500">{formatDateTime(item.createdAt)}</p>
                  </div>
                ))}
                {artifacts.activityLog.length === 0 ? <p className="text-xs text-slate-500">No activity logged yet.</p> : null}
              </div>
            </div>
            <div className="border border-white/10 bg-black/20 p-3">
              <p className="heading-kicker mb-2">Change Log</p>
              <div className="space-y-2 max-h-[220px] overflow-auto">
                {artifacts.changeLog.slice(0, 12).map((item) => (
                  <div key={item.id} className="border border-white/10 bg-black/20 p-2">
                    <p className="text-xs text-white">{item.entityType} · {item.field}</p>
                    <p className="text-[11px] text-slate-400">{item.before || "-"} {"->"} {item.after || "-"}</p>
                    <p className="text-[10px] text-slate-500">{formatDateTime(item.createdAt)}</p>
                  </div>
                ))}
                {artifacts.changeLog.length === 0 ? <p className="text-xs text-slate-500">No changes logged yet.</p> : null}
              </div>
            </div>
            <div className="border border-white/10 bg-black/20 p-3">
              <p className="heading-kicker mb-2">Audit Trail</p>
              <div className="space-y-2 max-h-[220px] overflow-auto">
                {artifacts.auditTrail.slice(0, 12).map((item) => (
                  <div key={item.id} className="border border-white/10 bg-black/20 p-2">
                    <p className="text-xs text-white">{item.action}</p>
                    <p className="text-[11px] text-slate-400">Actor: {item.actor.name}</p>
                    <p className="text-[10px] text-slate-500">{formatDateTime(item.createdAt)}</p>
                  </div>
                ))}
                {artifacts.auditTrail.length === 0 ? <p className="text-xs text-slate-500">No audit records yet.</p> : null}
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div className="border border-white/10 bg-black/20 p-3">
              <p className="heading-kicker mb-2">Exports</p>
              <ul className="space-y-1 text-xs text-slate-300">
                {artifacts.exports.slice(0, 8).map((item) => (
                  <li key={item.id}>{item.module} · {item.format.toUpperCase()} · {formatDateTime(item.createdAt)}</li>
                ))}
                {artifacts.exports.length === 0 ? <li className="text-slate-500">No exports yet.</li> : null}
              </ul>
            </div>
            <div className="border border-white/10 bg-black/20 p-3">
              <p className="heading-kicker mb-2">Share Links</p>
              <ul className="space-y-1 text-xs text-slate-300">
                {artifacts.shareLinks.slice(0, 8).map((item) => (
                  <li key={item.id}>
                    <a href={item.url} className="text-cyan-200 hover:underline" target="_blank" rel="noreferrer">
                      {item.label || item.module}
                    </a>
                    <span className="text-slate-500"> · {formatDateTime(item.createdAt)}</span>
                  </li>
                ))}
                {artifacts.shareLinks.length === 0 ? <li className="text-slate-500">No share links yet.</li> : null}
              </ul>
            </div>
          </div>
        </PlatformPanel>
      </div>
    </section>
  );
}
