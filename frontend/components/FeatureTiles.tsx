"use client";

import { BackgroundGrid } from "@/components/BackgroundGrid";
import { Panel } from "@/components/Panel";

const features = [
  {
    title: "Extract terms",
    description: "Upload PDF or DOCX. AI extracts key lease terms and builds a scenario for review.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    title: "Model scenarios",
    description: "Compare renewal vs relocate, edit assumptions, run cashflow analysis.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    title: "Generate memo",
    description: "White labeled PDF report, institutional layout, ready for client delivery.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
  },
];

const trustedBy = ["JLL", "CBRE", "Cushman", "Newmark"];

export function FeatureTiles() {
  return (
    <section className="relative z-10 section-shell">
      <BackgroundGrid variant="section" />
      <div className="app-container">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {features.map((feature, i) => (
            <Panel key={feature.title} className="surface-card-hover p-6 md:p-8 reveal-on-scroll">
              <p className="heading-kicker mb-4">Feature {i + 1}</p>
              <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded border border-white/20 bg-white/[0.03] text-white/90">
                {feature.icon}
              </div>
              <h3 className="text-xl font-semibold text-white tracking-tight mb-2">{feature.title}</h3>
              <p className="text-sm text-white/75 leading-relaxed">{feature.description}</p>
            </Panel>
          ))}
        </div>

        {/* Trusted by - placeholders only */}
        <div className="mt-16 sm:mt-20 pt-10 sm:pt-12 border-t border-white/20 reveal-on-scroll">
          <p className="text-xs uppercase tracking-[0.18em] text-white/55 text-center mb-6">
            Trusted by leading firms
          </p>
          <div className="flex flex-wrap items-center justify-center gap-10 md:gap-16">
            {trustedBy.map((name) => (
              <span
                key={name}
                className="text-white/55 text-sm font-semibold tracking-wide grayscale opacity-70"
                aria-hidden
              >
                {name}
              </span>
            ))}
          </div>
          <p className="text-xs text-white/45 text-center mt-4">
            Placeholder logos — no endorsement implied
          </p>
        </div>
      </div>
    </section>
  );
}
