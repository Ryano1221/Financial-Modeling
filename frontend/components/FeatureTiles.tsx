"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { LANDLORD_REP_MODE, type RepresentationMode } from "@/lib/workspace/representation-mode";

interface FeatureTilesProps {
  documentCount: number;
  workflowCount: number;
  insightCount: number;
  activeClientName: string;
  representationMode: RepresentationMode | null;
}

export function FeatureTiles({
  documentCount,
  workflowCount,
  insightCount,
  activeClientName,
  representationMode,
}: FeatureTilesProps) {
  const isLandlordMode = representationMode === LANDLORD_REP_MODE;
  const features = isLandlordMode
    ? [
      {
        step: "Step 1",
        title: "Ingest Listing Docs",
        description:
          "Upload leases, floorplans, flyers, proposals, and marketing collateral. AI classifies suite-level listing inputs.",
        metric: `${documentCount} document${documentCount === 1 ? "" : "s"} indexed`,
        ctaLabel: "Open Availabilities",
        href: "/?module=financial-analyses#extract",
        icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10.5l9-7 9 7M5 9.5V20h14V9.5M9 20v-5h6v5" />
          </svg>
        ),
      },
      {
        step: "Step 2",
        title: "Track Pipeline",
        description:
          "Manage inquiry-to-execution workflow for listings with tours, proposals, negotiations, and lease tracking.",
        metric: `${workflowCount} workflow${workflowCount === 1 ? "" : "s"} active for ${activeClientName}`,
        ctaLabel: "Open CRM",
        href: "/?module=deals",
        icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6h18M7 12h10M9 18h6" />
          </svg>
        ),
      },
      {
        step: "Step 3",
        title: "Publish Reporting",
        description:
          "Generate landlord-facing outputs for active spaces, proposal pipeline, signed deals, and portfolio reporting.",
        metric: `${insightCount} reporting stream${insightCount === 1 ? "" : "s"} ready`,
        ctaLabel: "Open Reporting",
        href: "/?module=obligations",
        icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 19h16M7 16V8m5 8V5m5 11v-6" />
          </svg>
        ),
      },
    ] as const
    : [
      {
        step: "Step 1",
        title: "Ingest Documents",
        description:
          "Upload leases, amendments, proposals, flyers, and floorplans. AI extracts and structures every key term.",
        metric: `${documentCount} document${documentCount === 1 ? "" : "s"} indexed`,
        ctaLabel: "Open Document Center",
        href: "/?module=financial-analyses#extract",
        icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
      {
        step: "Step 2",
        title: "Run Workflows",
        description:
          "Create financial analyses, sublease recoveries, surveys, lease abstracts, deal tracking, and obligation views all inside one client workspace.",
        metric: `${workflowCount} workflow${workflowCount === 1 ? "" : "s"} active for ${activeClientName}`,
        ctaLabel: "Open CRM",
        href: "/?module=deals",
        icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
      },
      {
        step: "Step 3",
        title: "Deliver Insights",
        description:
          "Generate branded reports, dashboards, lease abstracts, survey comparisons, and shareable client outputs.",
        metric: `${insightCount} live insight stream${insightCount === 1 ? "" : "s"} ready`,
        ctaLabel: "Open Financial Analyses",
        href: "/?module=financial-analyses",
        icon: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        ),
      },
    ] as const;

  return (
    <section className="relative z-10 section-shell">
      <div className="app-container">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.5, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
              className="surface-card surface-card-hover p-6 md:p-8 reveal-on-scroll"
            >
              <p className="heading-kicker mb-4">{feature.step}</p>
              <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded border border-white/20 bg-white/[0.03] text-white/90">
                {feature.icon}
              </div>
              <h3 className="text-xl font-semibold text-white tracking-tight mb-2">{feature.title}</h3>
              <p className="text-sm text-white/75 leading-relaxed">{feature.description}</p>
              <div className="mt-4 border border-white/15 bg-black/25 px-3 py-2 text-xs text-slate-300">
                {feature.metric}
              </div>
              <div className="mt-4">
                <Link href={feature.href} className="btn-premium btn-premium-secondary w-full text-center">
                  {feature.ctaLabel}
                </Link>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
