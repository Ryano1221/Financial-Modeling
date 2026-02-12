"use client";

import { useCallback, useState } from "react";
import { baseUrl } from "@/lib/api";
import type { ExtractionResponse } from "@/lib/types";

interface ExtractUploadProps {
  onSuccess: (data: ExtractionResponse) => void;
  onError: (message: string) => void;
}

function formatExtractError(res: Response, body: unknown): string {
  const detail = body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : null;
  if (detail) return `Backend error (${res.status}): ${detail}`;
  return `Backend error: ${res.status} ${res.statusText}`;
}

export function ExtractUpload({ onSuccess, onError }: ExtractUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [forceOcr, setForceOcr] = useState(false);

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
        form.append("file", file);
        if (showAdvanced) {
          form.append("force_ocr", forceOcr ? "true" : "false");
        }
        const res = await fetch(`${baseUrl}/extract`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          onError(formatExtractError(res, body));
          setLoading(false);
          return;
        }
        const data: ExtractionResponse = await res.json();
        onSuccess(data);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Extraction failed";
        if (msg === "Failed to fetch" || (e instanceof TypeError && (e as TypeError).message?.includes("fetch"))) {
          onError(`Cannot reach backend at ${baseUrl}. Is it running? Check the Diagnostics section below.`);
        } else {
          onError(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [showAdvanced, forceOcr, onSuccess, onError]
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
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowAdvanced((a) => !a)}
          className="text-sm text-zinc-500 hover:text-zinc-400 focus:outline-none"
        >
          {showAdvanced ? "Hide" : "Show"} advanced options
        </button>
        {showAdvanced && (
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={forceOcr}
              onChange={(e) => setForceOcr(e.target.checked)}
              disabled={loading}
              className="rounded border-white/20 bg-white/5 text-[#3b82f6] focus:ring-[#3b82f6] focus:ring-offset-0"
            />
            Force OCR (override auto; use for scanned PDFs when text extraction is poor)
          </label>
        )}
      </div>
    </div>
  );
}
