"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiUrl, getBaseUrl } from "@/lib/api";
import { repairNormalizerResponse } from "@/lib/lease-extraction-repair";
import type { NormalizerResponse } from "@/lib/types";
import { getNormalizeIntakeDecision } from "@/lib/normalize-review";

const NORMALIZE_TIMEOUT_MS = 180000;
const NORMALIZE_TIMEOUT_MESSAGE =
  "Normalize request timed out after 180s. Backend may be cold starting or processing a very large file.";
const NORMALIZE_MAX_ATTEMPTS = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ExtractUploadProps {
  showAdvancedOptions?: boolean;
  showInlineDropZone?: boolean;
  onPersistDocument?: (
    payload: { file: File; normalize: NormalizerResponse | null; parsed: boolean },
  ) => void | { sourceDocumentId?: string; fileName?: string } | Promise<void | { sourceDocumentId?: string; fileName?: string }>;
  onSuccess: (data: NormalizerResponse, context?: { fileName: string; file: File; sourceDocumentId?: string }) => void | Promise<void>;
  onError: (message: string) => void;
}

function formatNormalizeError(res: Response, body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = String((body as { error: unknown }).error || "").toLowerCase();
    const detail = "details" in body ? String((body as { details?: unknown }).details ?? "") : "";
    const rid = "rid" in body ? String((body as { rid?: unknown }).rid ?? "") : "";
    if (err === "normalize_failed") {
      const reason = classifyFailureReason(detail);
      if (reason) return reason;
      if (detail) return `Normalize failed: ${detail}${rid ? ` (request: ${rid})` : ""}`;
      return `We could not auto-extract this file right now.${rid ? ` (request: ${rid})` : ""}`;
    }
  }
  const detail = body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : null;
  if (detail) return detail;
  if (res.status >= 500) {
    return "We could not auto-extract this file. Review the lease fields manually to continue.";
  }
  return `Request failed (${res.status}). Please try again.`;
}

function classifyFailureReason(raw: unknown): string | null {
  const msg = String(raw ?? "").toLowerCase();
  if (!msg) return null;
  if (msg.includes("openai_api_key") || (msg.includes("api key") && msg.includes("openai"))) {
    return "Backend AI key is missing (`OPENAI_API_KEY`) on Render.";
  }
  if (msg.includes("invalid api key") || msg.includes("incorrect api key") || msg.includes("authentication")) {
    return "Backend OpenAI key is invalid.";
  }
  if (msg.includes("model") && (msg.includes("not found") || msg.includes("does not exist") || msg.includes("not have access"))) {
    return "Configured OpenAI model is not available for this key.";
  }
  if (msg.includes("quota") || msg.includes("rate limit") || msg.includes("429")) {
    return "AI provider quota/rate limit was hit.";
  }
  if (msg.includes("tesseract") || msg.includes("poppler") || msg.includes("pdf2image") || msg.includes("pytesseract")) {
    return "OCR dependencies are missing on backend (poppler/tesseract).";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "Extraction timed out while calling backend/AI.";
  }
  if (msg.includes("network") || msg.includes("failed to fetch") || msg.includes("trouble connecting")) {
    return "Website could not reach the backend service.";
  }
  if (msg.includes("backend_url") || msg.includes("backEND") || msg.includes("not configured") || msg.includes("set backend")) {
    return "Backend URL not set. Add NEXT_PUBLIC_BACKEND_URL in Vercel (Settings → Environment Variables) to your Render backend URL.";
  }
  if (msg.includes("cold start") || msg.includes("too long to respond")) {
    return "Backend was starting up. Try again in a few seconds.";
  }
  if (msg.includes("backend took too long") || msg.includes("render logs for normalize")) {
    return "Backend took too long. Check Render logs for normalize request id.";
  }
  return null;
}

export function ExtractUpload({
  showAdvancedOptions = false,
  showInlineDropZone = true,
  onPersistDocument,
  onSuccess,
  onError,
}: ExtractUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [globalDragActive, setGlobalDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const globalDragDepthRef = useRef(0);

  const sendFile = useCallback(
    async (file: File) => {
      const persistDocument = async (
        normalize: NormalizerResponse | null,
        parsed: boolean,
      ): Promise<{ sourceDocumentId?: string; fileName?: string } | null> => {
        if (!onPersistDocument) return null;
        try {
          return (await onPersistDocument({ file, normalize, parsed })) || null;
        } catch (persistError) {
          console.warn("[normalize] persist_document_failed", persistError);
          return null;
        }
      };
      const fn = file.name.toLowerCase();
      if (!fn.endsWith(".pdf") && !fn.endsWith(".docx") && !fn.endsWith(".doc")) {
        await persistDocument(null, false);
        onError("Only .pdf, .docx, and .doc files are accepted.");
        return;
      }
      const rid = crypto.randomUUID();
      const form = new FormData();
      form.append("source", fn.endsWith(".pdf") ? "PDF" : "WORD");
      form.append("file", file);
      try {
        let lastError: Error | null = null;
        const url = getApiUrl("/normalize");
        for (let attempt = 1; attempt <= NORMALIZE_MAX_ATTEMPTS; attempt += 1) {
          const attemptRid = `${rid}-${attempt}`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), NORMALIZE_TIMEOUT_MS);
          try {
            console.log("[normalize] start", {
              rid: attemptRid,
              attempt,
              file: file.name,
              size: file.size,
              type: file.type,
              backend: getBaseUrl(),
            });
            if (attempt > 1) {
              try {
                await fetch(getApiUrl("/health"), { method: "GET" });
              } catch {
                // best-effort warm-up only
              }
              await sleep(1000);
            }
            const res = await fetch(url, {
              method: "POST",
              body: form,
              headers: { "x-request-id": attemptRid },
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            console.log("[normalize] response", { rid: attemptRid, status: res.status, attempt });
            const rawText = await res.text();
            if (res.ok) {
              let data: NormalizerResponse;
              try {
                data = JSON.parse(rawText) as NormalizerResponse;
              } catch {
                throw new Error("Normalize returned non-JSON: " + rawText.slice(0, 200));
              }
              if (data.canonical_lease) {
                const repaired = repairNormalizerResponse(data) || data;
                const intake = getNormalizeIntakeDecision(repaired);
                console.log("[normalize] parsed", {
                  hasCanonical: !!repaired?.canonical_lease,
                  lease_type: (repaired as { canonical_lease?: { lease_type?: string } })?.canonical_lease?.lease_type,
                  parsed: intake.parsed,
                  autoAdd: intake.autoAdd,
                });
                console.log("[normalize] calling onSuccess");
                const persisted = await persistDocument(repaired, intake.autoAdd);
                await onSuccess(repaired, {
                  fileName: persisted?.fileName || file.name,
                  file,
                  sourceDocumentId: persisted?.sourceDocumentId,
                });
                return;
              }
              throw new Error("Unexpected normalize response keys: " + Object.keys(data).join(","));
            }
            const body = (() => {
              try {
                return JSON.parse(rawText || "{}") as unknown;
              } catch {
                return null;
              }
            })();
            if (body && typeof body === "object" && "error" in body) {
              const pretty = formatNormalizeError(res, body);
              throw new Error(pretty);
            }
            const reason = classifyFailureReason(body && typeof body === "object" && "detail" in body ? (body as { detail: unknown }).detail : null);
            if (res.status >= 500 || res.status === 503 || res.status === 429) {
              if (attempt < NORMALIZE_MAX_ATTEMPTS) {
                console.warn("[normalize] upstream temporary failure, retrying", {
                  rid: attemptRid,
                  status: res.status,
                  attempt,
                  reason,
                });
                await sleep(1000 * attempt);
                continue;
              }
              await persistDocument(null, false);
              onError(reason ?? formatNormalizeError(res, body));
              return;
            }
            await persistDocument(null, false);
            onError(formatNormalizeError(res, body));
            return;
          } catch (err) {
            clearTimeout(timeoutId);
            const msg = err instanceof Error ? err.message : String(err);
            const isAbort = err instanceof Error && (err.name === "AbortError" || msg.toLowerCase().includes("abort"));
            if (!isAbort || attempt === NORMALIZE_MAX_ATTEMPTS) {
              lastError = err instanceof Error ? err : new Error(msg || "Request failed.");
              break;
            }
            console.warn("[normalize] timeout, retrying", { rid: attemptRid, attempt, msg });
          }
        }

        if (lastError) {
          const msg = lastError.message || "Request failed.";
          if (lastError.name === "AbortError" || msg.toLowerCase().includes("abort")) {
            await persistDocument(null, false);
            onError(NORMALIZE_TIMEOUT_MESSAGE);
            return;
          }
          const reason = classifyFailureReason(msg);
          await persistDocument(null, false);
          onError(reason ?? msg);
          return;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[normalize] error", { rid, msg });
        if (e instanceof Error && (e.name === "AbortError" || msg.toLowerCase().includes("abort"))) {
          await persistDocument(null, false);
          onError(NORMALIZE_TIMEOUT_MESSAGE);
          return;
        }
        const reason = classifyFailureReason(msg);
        await persistDocument(null, false);
        onError(reason ?? (msg || "Request failed."));
      } finally {
        // batch processor manages loading state
      }
    },
    [onSuccess, onError, onPersistDocument]
  );

  const processFiles = useCallback(
    async (incoming: FileList | File[] | null | undefined) => {
      const files = Array.from(incoming ?? []);
      if (files.length === 0) return;

      const accepted = files.filter((f) => {
        const fn = f.name.toLowerCase();
        return fn.endsWith(".pdf") || fn.endsWith(".docx") || fn.endsWith(".doc");
      });
      const rejectedCount = files.length - accepted.length;

      if (accepted.length === 0) {
        onError("Only .pdf, .docx, and .doc files are accepted.");
        return;
      }

      if (rejectedCount > 0) {
        onError(
          `Ignored ${rejectedCount} unsupported file${rejectedCount === 1 ? "" : "s"}. Only .pdf, .docx, and .doc are accepted.`
        );
      } else {
        onError("");
      }

      setLoading(true);
      try {
        for (let i = 0; i < accepted.length; i += 1) {
          const file = accepted[i];
          setBatchStatus(`Processing ${i + 1}/${accepted.length}: ${file.name}`);
          await sendFile(file);
        }
        setBatchStatus(`Finished ${accepted.length} document${accepted.length === 1 ? "" : "s"}.`);
      } finally {
        setLoading(false);
        setTimeout(() => setBatchStatus(null), 2500);
      }
    },
    [onError, sendFile]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      void processFiles(e.dataTransfer.files);
    },
    [processFiles]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void processFiles(e.target.files);
      e.target.value = "";
    },
    [processFiles]
  );

  const isFileDragEvent = useCallback((event: DragEvent): boolean => {
    const dt = event.dataTransfer;
    if (!dt) return false;
    const types = Array.from(dt.types ?? []);
    return types.includes("Files");
  }, []);

  useEffect(() => {
    if (!showInlineDropZone) {
      setGlobalDragActive(false);
      setDragOver(false);
      return;
    }

    const onWindowDragEnter = (event: DragEvent) => {
      if (event.defaultPrevented || loading || !isFileDragEvent(event)) return;
      event.preventDefault();
      globalDragDepthRef.current += 1;
      setGlobalDragActive(true);
    };

    const onWindowDragOver = (event: DragEvent) => {
      if (event.defaultPrevented || loading || !isFileDragEvent(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setGlobalDragActive(true);
    };

    const onWindowDragLeave = (event: DragEvent) => {
      if (!isFileDragEvent(event)) return;
      globalDragDepthRef.current = Math.max(0, globalDragDepthRef.current - 1);
      if (globalDragDepthRef.current === 0) {
        setGlobalDragActive(false);
      }
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
  }, [isFileDragEvent, loading, processFiles, showInlineDropZone]);

  return (
    <div className="space-y-3">
      {globalDragActive && (
        <div className="pointer-events-none fixed inset-0 z-[70] border-2 border-dashed border-blue-300/70 bg-blue-500/10 backdrop-blur-[1px]">
          <div className="absolute inset-x-4 top-16 rounded-xl border border-blue-200/70 bg-slate-900/90 px-4 py-3 text-center text-sm font-semibold tracking-tight text-blue-100 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
            Drop lease files anywhere to extract
          </div>
        </div>
      )}
      <div
        onDrop={showInlineDropZone ? onDrop : undefined}
        onDragOver={showInlineDropZone ? onDragOver : undefined}
        onDragLeave={showInlineDropZone ? onDragLeave : undefined}
        className={`
          overflow-hidden rounded-[28px] border transition-all duration-200
          ${showInlineDropZone ? "border-dashed border-slate-300/30" : "border-white/15"}
          ${dragOver ? "border-blue-300/70 bg-blue-500/12 shadow-[0_0_0_1px_rgba(147,197,253,0.4),0_16px_45px_rgba(30,64,175,0.2)]" : "bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.72))]"}
          ${loading ? "pointer-events-none opacity-70" : ""}
        `}
      >
        <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)] lg:items-center">
          <div className="space-y-4 text-left">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/80">Financial Analysis Extractor</p>
              <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">
                Upload the source lease document
              </h3>
              <p className="max-w-2xl text-sm leading-6 text-slate-300 sm:text-[15px]">
                Use the original PDF or Word file. We normalize the lease terms, validate the core math, and send clean scenarios straight into comparison.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-slate-200">
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1">PDF</span>
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1">DOCX</span>
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1">DOC</span>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-emerald-200">
                Auto-validates core terms
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label
                htmlFor="extract-file-input"
                className="btn-premium btn-premium-primary inline-flex cursor-pointer items-center justify-center focus-within:focus-ring"
              >
                {loading ? "Extracting..." : "Choose files"}
              </label>
              <p className="text-sm text-slate-300">
                {showInlineDropZone ? "Or drag files directly into this panel." : "You can also drag files anywhere on this tab."}
              </p>
            </div>

            {batchStatus ? (
              <div className="rounded-2xl border border-cyan-300/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                {batchStatus}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/12 bg-white/5 p-4 sm:p-5">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">What happens next</p>
            <div className="mt-3 space-y-3 text-sm text-slate-200">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-cyan-300" />
                <p>Start with the actual lease, proposal, amendment, or counter rather than a generated report PDF.</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-cyan-300" />
                <p>RSF, term dates, and rent schedule are checked before the scenario enters comparison.</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-cyan-300" />
                <p>Clean extracts auto-open in the comparison workspace so you can keep moving without extra clicks.</p>
              </div>
            </div>
          </div>
        </div>
        <input
          type="file"
          accept=".pdf,.docx,.doc"
          multiple
          onChange={onFileInput}
          disabled={loading}
          className="hidden"
          id="extract-file-input"
        />
      </div>
    </div>
  );
}
