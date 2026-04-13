import type { Metadata } from "next";
import Link from "next/link";
import { REPRESENTATION_MODE_PROFILES } from "@/lib/workspace/representation-profile";

export const metadata: Metadata = {
  title: "About The CRE Model",
  description:
    "Learn how The CRE Model connects commercial real estate CRM, lease documents, financial analysis, marketing flyers, lease abstracts, obligations, and broker workflow automation.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About The CRE Model",
    description:
      "A connected commercial real estate CRM and lease analysis workspace for brokerage teams.",
    url: "https://thecremodel.com/about",
  },
};

const profiles = [
  REPRESENTATION_MODE_PROFILES.tenant_rep,
  REPRESENTATION_MODE_PROFILES.landlord_rep,
];

const portfolioSections = [
  {
    title: "Lease records and source documents",
    copy:
      "Store proposals, signed leases, amendments, subleases, landlord consents, abstracts, and supporting files under the same client workspace instead of scattering them across folders and inboxes.",
  },
  {
    title: "Analysis, marketing, and deal execution",
    copy:
      "Move from intake to financial comparison, building review, marketing flyers, and CRM follow-up without rebuilding the same context in separate tools.",
  },
  {
    title: "Ongoing obligations and reporting",
    copy:
      "Keep renewals, notices, critical dates, and client-ready exports tied to the same leasing portfolio, so nothing important gets detached after the first analysis is finished.",
  },
];

const valuePoints = [
  "One client workspace can hold the full leasing portfolio, not just a single deal.",
  "Every module stays connected to the same buildings, documents, dates, and active client record.",
  "Teams can move from document intake to client deliverables without re-entering the same lease details.",
];

export default function AboutPage() {
  return (
    <main className="relative z-10 section-shell">
      <div className="app-container max-w-6xl">
        <section className="section-panel space-y-8 p-6 sm:p-10">
          <div className="space-y-3">
            <p className="heading-kicker">About</p>
            <h1 className="heading-display !text-[clamp(2rem,5vw,3.75rem)]">Your full leasing portfolio in one place</h1>
            <p className="body-lead max-w-4xl">
              theCREmodel is a connected leasing platform for brokerage teams that want one system for the full client picture. Instead of splitting lease files, market options, analyses, obligations, and follow-up work across disconnected tools, the platform keeps the full leasing portfolio organized inside one active workspace.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <div className="brand-badge">Full leasing portfolio visibility</div>
              <div className="brand-badge">One connected workspace</div>
              <div className="brand-badge">Client-ready outputs from the same system</div>
            </div>
          </div>

          <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="surface-card p-6 sm:p-7">
              <p className="heading-kicker">Platform overview</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Why the platform exists</h2>
              <p className="mt-3 text-sm text-slate-300 sm:text-base">
                Leasing teams rarely work from one document at a time. They need to see proposals beside current leases, track renewals beside market alternatives, connect building research to live deals, and produce client deliverables without losing the underlying source record. theCREmodel is designed around that real workflow.
              </p>
              <p className="mt-3 text-sm text-slate-300 sm:text-base">
                A user can keep the full leasing portfolio in one place: the active client, the saved document library, financial analyses, marketing flyers, lease abstracts, obligations, building context, and CRM follow-up all stay linked so the team is working from the same operating picture from intake through decision and execution.
              </p>
            </div>
            <div className="surface-card brand-panel p-6 sm:p-7">
              <p className="heading-kicker">What that means</p>
              <ul className="mt-3 space-y-3 text-sm text-slate-300 sm:text-base">
                {valuePoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="heading-section">What lives in the portfolio workspace</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {portfolioSections.map((section) => (
                <article key={section.title} className="surface-card p-5">
                  <h3 className="text-lg font-semibold text-white">{section.title}</h3>
                  <p className="mt-2 text-sm text-slate-300">{section.copy}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="heading-section">Representation modes stay connected</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {profiles.map((profile) => (
                <article key={profile.mode} className="surface-card p-5 sm:p-6">
                  <p className="heading-kicker">{profile.label}</p>
                  <p className="mt-2 text-sm text-slate-300 sm:text-base">{profile.summary}</p>
                  <p className="mt-3 text-sm text-slate-400">
                    The workflow emphasis changes by representation mode, but the shared workspace model still keeps portfolio documents, analyses, and follow-up connected.
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_auto_auto_auto] lg:items-center">
            <div className="surface-card p-5">
              <p className="heading-kicker">Learn more</p>
              <p className="mt-2 text-sm text-slate-300">
                Explore product guidance, security details, and support information from the same public navigation.
              </p>
            </div>
            <Link
              href="/docs"
              className="inline-flex items-center justify-center min-h-[44px] px-5 text-sm font-medium text-slate-100 border border-slate-300/35 bg-slate-900/70 hover:bg-slate-800/80 transition-colors focus:outline-none focus-ring"
            >
              Docs
            </Link>
            <Link
              href="/security"
              className="inline-flex items-center justify-center min-h-[44px] px-5 text-sm font-medium text-slate-100 border border-slate-300/35 bg-slate-900/70 hover:bg-slate-800/80 transition-colors focus:outline-none focus-ring"
            >
              Security
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center min-h-[44px] px-5 text-sm font-medium text-slate-100 border border-slate-300/35 bg-slate-900/70 hover:bg-slate-800/80 transition-colors focus:outline-none focus-ring"
            >
              Contact
            </Link>
          </section>
        </section>
      </div>
    </main>
  );
}
