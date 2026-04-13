"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MarketingFlyerPreview } from "@/components/marketing/MarketingFlyerPreview";
import { parseMarketingShareData } from "@/lib/marketing/share";

export function MarketingSharePage() {
  const searchParams = useSearchParams();
  const snapshot = parseMarketingShareData(searchParams.get("data"));

  if (!snapshot) {
    return (
      <main className="marketing-page-shell">
        <div className="app-container">
          <section className="marketing-page-panel mx-auto max-w-[900px] space-y-4">
            <p className="heading-kicker">Marketing Flyer</p>
            <h1 className="heading-section">This flyer link could not be opened.</h1>
            <p className="body-copy text-[var(--muted)]">Ask the workspace owner to generate a fresh share link.</p>
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
            <button type="button" className="btn-premium btn-premium-secondary" onClick={() => window.print()}>
              Print / Save PDF
            </button>
          </div>
          <MarketingFlyerPreview snapshot={snapshot} />
        </section>
      </div>
    </main>
  );
}
