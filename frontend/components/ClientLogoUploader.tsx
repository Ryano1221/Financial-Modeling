"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";

interface ClientLogoUploaderProps {
  logoDataUrl: string | null;
  fileName: string | null;
  uploading: boolean;
  disabled?: boolean;
  disabledMessage?: string;
  error: string | null;
  onUpload: (file: File) => Promise<void>;
  onClear: () => void;
}

const ACCEPTED_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/svg+xml"]);

export function ClientLogoUploader({
  logoDataUrl,
  fileName,
  uploading,
  disabled = false,
  disabledMessage = "Sign in to upload a client logo.",
  error,
  onUpload,
  onClear,
}: ClientLogoUploaderProps) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasLogo = !!logoDataUrl;

  const helperText = useMemo(() => {
    if (fileName) return `Client logo loaded: ${fileName}`;
    return "Optional. PNG, SVG, or JPG. Used on PDF cover.";
  }, [fileName]);

  const processFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!ACCEPTED_MIME.has((file.type || "").toLowerCase())) {
        throw new Error("Client logo must be PNG, SVG, or JPG.");
      }
      await onUpload(file);
    },
    [onUpload]
  );

  const onDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      if (uploading || disabled) return;
      try {
        await processFiles(event.dataTransfer.files);
      } catch {
        // error is managed by page state
      }
    },
    [processFiles, uploading, disabled]
  );

  const onDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (uploading || disabled) return;
      setDragOver(true);
    },
    [uploading, disabled]
  );

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
  }, []);

  const onFileInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      try {
        if (disabled) return;
        await processFiles(event.target.files);
      } catch {
        // error is managed by page state
      } finally {
        event.target.value = "";
      }
    },
    [processFiles, disabled]
  );

  return (
    <div className="border border-slate-300/20 p-3">
      <p className="text-xs text-slate-400 mb-2">Client logo (PDF cover)</p>
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={[
          "border border-slate-300/20 bg-slate-900/20 p-3 transition-colors",
          dragOver ? "border-blue-300/60 bg-blue-500/10" : "",
          uploading ? "opacity-70 pointer-events-none" : "",
        ].join(" ")}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.svg,.jpg,.jpeg,image/png,image/svg+xml,image/jpeg"
          className="hidden"
          onChange={onFileInputChange}
          disabled={uploading || disabled}
        />
        {hasLogo ? (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-center">
            <div className="border border-slate-300/20 bg-black/50 p-2">
              <Image
                src={logoDataUrl}
                alt="Client logo preview"
                className="max-h-16 w-auto object-contain"
                width={200}
                height={64}
                unoptimized
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-premium btn-premium-secondary"
                disabled={uploading || disabled}
              >
                Replace
              </button>
              <button
                type="button"
                onClick={onClear}
                className="btn-premium btn-premium-danger"
                disabled={uploading || disabled}
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <p className="text-sm text-slate-200">Drag and drop client logo here, or click to upload.</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-premium btn-premium-secondary"
              disabled={uploading || disabled}
            >
              {uploading ? "Uploading..." : "Upload client logo"}
            </button>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">{helperText}</p>
        {disabled && <p className="mt-2 text-xs text-amber-200">{disabledMessage}</p>}
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </div>
    </div>
  );
}
