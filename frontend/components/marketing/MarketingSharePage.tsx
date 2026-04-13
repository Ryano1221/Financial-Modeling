"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MarketingFlyerPreview } from "@/components/marketing/MarketingFlyerPreview";
import { fetchMarketingShareSnapshot } from "@/lib/marketing/share";
import type { MarketingFlyerSnapshot } from "@/lib/marketing/types";
import { fetchApi, getDisplayErrorMessage } from "@/lib/api";
import { downloadBlob } from "@/lib/export-runtime";

export function MarketingSharePage() {
  const searchParams = useSearchParams();
  const shareId = String(searchParams.get("id") || "").trim();
  const [snapshot, setSnapshot] = useState<MarketingFlyerSnapshot | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Loading flyer...");

  useEffect(() => {
    let cancelled = false;
    if (!shareId) {
      setError("Missing flyer link id.");
      setStatus("");
      return;
    }
    setStatus("Loading flyer...");
    fetchMarketingShareSnapshot(shareId)
      .then((nextSnapshot) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
        setError("");
        setStatus("");
      })
      .catch((err) => {
        if (cancelled) return;
        setSnapshot(null);
        setError(getDisplayErrorMessage(err));
        setStatus("");
      });
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  const downloadPdf = useCallback(async () => {
    if (!snapshot) return;
    setStatus("Building PDF...");
    setError("");
    try {
      const res = await fetchApi("/marketing/flyer/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot }),
      });
      if (!res.ok) throw new Error((await res.text()) || `PDF export failed (${res.status}).`);
      const blob = await res.blob();
      const building = snapshot.form.building_name || "marketing-flyer";
      downloadBlob(blob, `${building.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "marketing-flyer"}.pdf`);
      setStatus("PDF downloaded.");
    } catch (err) {
      setError(getDisplayErrorMessage(err));
      setStatus("");
    }
  }, [snapshot]);

  if (!snapshot) {
    return (
      <main className="marketing-page-shell">
        <div className="app-container">
          <section className="marketing-page-panel mx-auto max-w-[900px] space-y-4">
            <p className="heading-kicker">Marketing Flyer</p>
            <h1 className="heading-section">This flyer link could not be opened.</h1>
            <p className="body-copy text-[var(--muted)]">{status || error || "Ask the workspace owner to generate a fresh share link."}</p>
            <Link href="/" className="btn-premium btn-premium-primary">Open Workspace</Link>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="marketing-page-shell">
      <div className="app-container">
        <section className="marketing-page-panel mx-auto max-w-[1100px] space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="heading-kicker">Marketing Flyer</p>
              <h1 className="heading-section">{snapshot.form.building_name || "Shared Flyer"}</h1>
              <p className="text-sm text-[var(--muted)]">{snapshot.form.address}</p>
            </div>
            <button type="button" className="btn-premium btn-premium-secondary" onClick={() => void downloadPdf()}>
              Download PDF
            </button>
          </div>
          {status ? <p className="text-sm text-[var(--muted)]">{status}</p> : null}
          {error ? <p className="border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</p> : null}
          <MarketingFlyerPreview snapshot={snapshot} />
        </section>
      </div>
    </main>
  );
}
