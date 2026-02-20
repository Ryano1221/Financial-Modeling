"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";

interface BrandingPreviewPayload {
  has_logo?: boolean;
  logo_filename?: string | null;
  logo_data_url?: string | null;
}

interface BrandingLogoUploaderProps {
  branding: BrandingPreviewPayload | null;
  loading: boolean;
  uploading: boolean;
  error: string | null;
  onUpload: (file: File) => Promise<void>;
  onDelete: () => Promise<void>;
}

const ACCEPTED_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/svg+xml"]);

export function BrandingLogoUploader({
  branding,
  loading,
  uploading,
  error,
  onUpload,
  onDelete,
}: BrandingLogoUploaderProps) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewSrc = branding?.logo_data_url || null;
  const hasLogo = !!branding?.has_logo && !!previewSrc;
  const busy = loading || uploading;

  const helperText = useMemo(() => {
    if (branding?.logo_filename) {
      return `Current brokerage logo: ${branding.logo_filename}`;
    }
    return "PNG, SVG, or JPG. Used on cover, page header, and prepared-by section.";
  }, [branding?.logo_filename]);

  const processFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!ACCEPTED_MIME.has((file.type || "").toLowerCase())) {
        throw new Error("Logo must be PNG, SVG, or JPG.");
      }
      await onUpload(file);
    },
    [onUpload]
  );

  const onDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      if (busy) return;
      try {
        await processFiles(event.dataTransfer.files);
      } catch {
        // error is managed by page state
      }
    },
    [busy, processFiles]
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (busy) return;
    setDragOver(true);
  }, [busy]);

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
  }, []);

  const onFileInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      try {
        await processFiles(event.target.files);
      } catch {
        // error is managed by page state
      } finally {
        event.target.value = "";
      }
    },
    [processFiles]
  );

  return (
    <section className="mb-5 border-t border-slate-300/20 pt-4">
      <p className="heading-kicker mb-2">Branding</p>
      <h3 className="text-base font-semibold text-white mb-2">Brokerage logo</h3>
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={[
          "border border-slate-300/30 bg-slate-900/30 p-4 transition-colors",
          dragOver ? "border-blue-300/70 bg-blue-500/10" : "",
          busy ? "opacity-70 pointer-events-none" : "",
        ].join(" ")}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.svg,.jpg,.jpeg,image/png,image/svg+xml,image/jpeg"
          className="hidden"
          onChange={onFileInputChange}
          disabled={busy}
        />

        {hasLogo ? (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-center">
            <div className="border border-slate-300/25 bg-black/50 p-3">
              <Image
                src={previewSrc}
                alt="Brokerage logo preview"
                className="max-h-24 w-auto object-contain"
                width={240}
                height={96}
                unoptimized
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-premium btn-premium-secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                Replace logo
              </button>
              <button
                type="button"
                className="btn-premium btn-premium-danger"
                onClick={() => void onDelete()}
                disabled={busy}
              >
                Delete logo
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm text-slate-200 mb-3">
              Drag and drop brokerage logo here, or click to upload.
            </p>
            <button
              type="button"
              className="btn-premium btn-premium-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              {uploading ? "Uploading..." : "Upload logo"}
            </button>
          </div>
        )}

        <p className="mt-3 text-xs text-slate-400">{helperText}</p>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </div>
    </section>
  );
}
