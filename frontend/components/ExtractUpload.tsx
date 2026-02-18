"use client";

import { useCallback, useState } from "react";
import { getApiUrl, getBaseUrl } from "@/lib/api";
import type { NormalizerResponse } from "@/lib/types";

const NORMALIZE_TIMEOUT_MS = 180000;
const NORMALIZE_TIMEOUT_MESSAGE =
  "Normalize request timed out after 180s. Backend may be cold starting or processing a very large file.";
const NORMALIZE_MAX_ATTEMPTS = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ExtractUploadProps {
  showAdvancedOptions?: boolean;
  onSuccess: (data: NormalizerResponse) => void;
  onError: (message: string) => void;
}

function formatNormalizeError(res: Response, body: unknown): string {
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

function buildFallbackNormalizerResponse(fileName: string, reason?: string | null): NormalizerResponse {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(start.getFullYear() + 5, start.getMonth(), start.getDate());
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const reasonLine = reason ? `Likely cause: ${reason}` : null;
  return {
    canonical_lease: {
      scenario_name: fileName.replace(/\.(pdf|docx)$/i, "") || "Uploaded lease",
      premises_name: "",
      address: "",
      building_name: "",
      suite: "",
      rsf: 0,
      lease_type: "NNN",
      commencement_date: iso(start),
      expiration_date: iso(end),
      term_months: 60,
      free_rent_months: 0,
      discount_rate_annual: 0.08,
      rent_schedule: [],
      opex_psf_year_1: 0,
      opex_growth_rate: 0,
      expense_stop_psf: 0,
      expense_structure_type: "nnn",
      parking_count: 0,
      parking_rate_monthly: 0,
      ti_allowance_psf: 0,
      notes: "Clause highlights unavailable from auto-extraction. Review ROFR/ROFO, renewal/extension rights, termination rights, and OpEx exclusions manually.",
    },
    confidence_score: 0.2,
    field_confidence: {},
    missing_fields: ["address", "premises_name", "rsf", "rent_schedule", "term_months"],
    clarification_questions: ["Automatic extraction failed. Enter Building name, Suite, RSF, and base rent schedule."],
    warnings: [
      "Automatic extraction was unavailable for this upload.",
      "A review template was loaded so you can continue without re-uploading.",
      ...(reasonLine ? [reasonLine] : []),
    ],
  };
}

export function ExtractUpload({ showAdvancedOptions = false, onSuccess, onError }: ExtractUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);

  const sendFile = useCallback(
    async (file: File) => {
      const fn = file.name.toLowerCase();
      if (!fn.endsWith(".pdf") && !fn.endsWith(".docx")) {
        onError("Only .pdf and .docx files are accepted.");
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
                console.log("[normalize] parsed", {
                  hasCanonical: !!data?.canonical_lease,
                  lease_type: (data as { canonical_lease?: { lease_type?: string } })?.canonical_lease?.lease_type,
                });
                console.log("[normalize] calling onSuccess");
                onSuccess(data);
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
              throw new Error(String((body as { error: unknown }).error));
            }
            const reason = classifyFailureReason(body && typeof body === "object" && "detail" in body ? (body as { detail: unknown }).detail : null);
            if (res.status >= 500 || res.status === 503 || res.status === 429) {
              onError("");
              onSuccess(buildFallbackNormalizerResponse(file.name, reason));
              return;
            }
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
            const reason = "Backend timeout after retry.";
            onError(NORMALIZE_TIMEOUT_MESSAGE);
            onSuccess(buildFallbackNormalizerResponse(file.name, reason));
            return;
          }
          const reason = classifyFailureReason(msg);
          onError(msg);
          onSuccess(buildFallbackNormalizerResponse(file.name, reason));
          return;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[normalize] error", { rid, msg });
        if (e instanceof Error && (e.name === "AbortError" || msg.toLowerCase().includes("abort"))) {
          onError(NORMALIZE_TIMEOUT_MESSAGE);
          onSuccess(buildFallbackNormalizerResponse(file.name, "Backend timeout."));
          return;
        }
        const reason = classifyFailureReason(msg);
        onError(msg || "Request failed.");
        onSuccess(buildFallbackNormalizerResponse(file.name, reason));
      } finally {
        // batch processor manages loading state
      }
    },
    [onSuccess, onError]
  );

  const processFiles = useCallback(
    async (incoming: FileList | File[] | null | undefined) => {
      const files = Array.from(incoming ?? []);
      if (files.length === 0) return;

      const accepted = files.filter((f) => {
        const fn = f.name.toLowerCase();
        return fn.endsWith(".pdf") || fn.endsWith(".docx");
      });
      const rejectedCount = files.length - accepted.length;

      if (accepted.length === 0) {
        onError("Only .pdf and .docx files are accepted.");
        return;
      }

      if (rejectedCount > 0) {
        onError(`Ignored ${rejectedCount} unsupported file${rejectedCount === 1 ? "" : "s"}. Only .pdf and .docx are accepted.`);
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
        setBatchStatus(`Finished ${accepted.length} proposal${accepted.length === 1 ? "" : "s"}.`);
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
      setDragOver(false);
      void processFiles(e.dataTransfer.files);
    },
    [processFiles]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void processFiles(e.target.files);
      e.target.value = "";
    },
    [processFiles]
  );

  return (
    <div className="space-y-3">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-colors
          ${dragOver ? "border-[#3b82f6]/50 bg-[#3b82f6]/10" : "border-white/20 bg-white/[0.03]"}
          ${loading ? "pointer-events-none opacity-70" : ""}
        `}
      >
        <p className="text-sm text-zinc-400 mb-2">
          Drag and drop one or more <strong className="text-zinc-300">.pdf</strong> or <strong className="text-zinc-300">.docx</strong> lease documents here, or click to choose.
        </p>
        <input
          type="file"
          accept=".pdf,.docx"
          multiple
          onChange={onFileInput}
          disabled={loading}
          className="hidden"
          id="extract-file-input"
        />
        <label
          htmlFor="extract-file-input"
          className="inline-block rounded-full bg-[#3b82f6] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#2563eb] hover:shadow-[0_0_20px_rgba(59,130,246,0.35)] transition-all cursor-pointer focus-within:ring-2 focus-within:ring-[#3b82f6] focus-within:ring-offset-2 focus-within:ring-offset-[#0a0a0b] active:scale-[0.98]"
        >
          {loading ? "Extracting…" : "Choose files"}
        </label>
        {batchStatus && <p className="mt-3 text-xs text-zinc-400">{batchStatus}</p>}
      </div>
    </div>
  );
}
