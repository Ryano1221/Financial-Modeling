"use client";

import { useCallback, useState } from "react";
import { fetchApi } from "@/lib/api";
import type { NormalizerResponse } from "@/lib/types";

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
      notes: "",
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

  const sendFile = useCallback(
    async (file: File) => {
      const fn = file.name.toLowerCase();
      if (!fn.endsWith(".pdf") && !fn.endsWith(".docx")) {
        onError("Only .pdf and .docx files are accepted.");
        return;
      }
      setLoading(true);
      onError("");
      try {
        const form = new FormData();
        form.append("source", fn.endsWith(".pdf") ? "PDF" : "WORD");
        form.append("file", file);
        const res = await fetchApi("/normalize", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const detail = body && typeof body === "object" && "detail" in body ? (body as { detail: unknown }).detail : null;
          const reason = classifyFailureReason(detail);
          if (res.status >= 500 || res.status === 503 || res.status === 429) {
            onError("");
            onSuccess(buildFallbackNormalizerResponse(file.name, reason));
            return;
          }
          onError(formatNormalizeError(res, body));
          return;
        }
        const data: NormalizerResponse = await res.json();
        onSuccess(data);
      } catch (e) {
        const reason = classifyFailureReason(e instanceof Error ? e.message : String(e));
        onError("");
        onSuccess(buildFallbackNormalizerResponse(file.name, reason));
      } finally {
        setLoading(false);
      }
    },
    [onSuccess, onError]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) sendFile(file);
    },
    [sendFile]
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
      const file = e.target.files?.[0];
      if (file) sendFile(file);
      e.target.value = "";
    },
    [sendFile]
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
          Drag and drop a <strong className="text-zinc-300">.pdf</strong> or <strong className="text-zinc-300">.docx</strong> lease document here, or click to choose.
        </p>
        <input
          type="file"
          accept=".pdf,.docx"
          onChange={onFileInput}
          disabled={loading}
          className="hidden"
          id="extract-file-input"
        />
        <label
          htmlFor="extract-file-input"
          className="inline-block rounded-full bg-[#3b82f6] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#2563eb] hover:shadow-[0_0_20px_rgba(59,130,246,0.35)] transition-all cursor-pointer focus-within:ring-2 focus-within:ring-[#3b82f6] focus-within:ring-offset-2 focus-within:ring-offset-[#0a0a0b] active:scale-[0.98]"
        >
          {loading ? "Extracting…" : "Choose file"}
        </label>
      </div>
    </div>
  );
}
