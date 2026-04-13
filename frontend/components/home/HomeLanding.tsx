"use client";

import Link from "next/link";

type LandingStat = {
  label: string;
  value: string;
  detail: string;
};

type LandingPipelineStage = {
  label: string;
  count: number;
  width: number;
  tone: "touring" | "proposals" | "negotiating" | "executing";
};

interface HomeLandingProps {
  isAuthenticated: boolean;
  primaryCtaHref: string;
  secondaryCtaHref: string;
  workspaceName: string;
  workspaceDescription: string;
  stats: LandingStat[];
  pipeline: LandingPipelineStage[];
}

function pipelineToneClass(tone: LandingPipelineStage["tone"]): string {
  if (tone === "touring") return "landing-pipeline-fill-touring";
  if (tone === "proposals") return "landing-pipeline-fill-proposals";
  if (tone === "negotiating") return "landing-pipeline-fill-negotiating";
  return "landing-pipeline-fill-executing";
}

const FEATURE_CARDS = [
  {
    index: "01",
    title: "CRM",
    description:
      "Every client, contact, and touchpoint logged and tied to the deal it belongs to. Tenant reps track prospects and decision-makers. Landlord reps manage tenant outreach and leasing activity — all with automated follow-up reminders.",
  },
  {
    index: "02",
    title: "BUILDINGS",
    description:
      "Tenant reps track every building toured or shortlisted. Landlord reps manage their own assets and availabilities. Notes, specs, and follow-up reminders stay attached to every record automatically.",
  },
  {
    index: "03",
    title: "FINANCIAL ANALYSES",
    description:
      "Tenant reps model net effective rent and TIA scenarios for their clients. Landlord reps run economics on deal structures and concession packages. Automated alerts flag when assumptions drift.",
  },
  {
    index: "04",
    title: "SURVEYS",
    description:
      "Tenant reps generate market surveys from shortlisted buildings in seconds. Landlord reps build competitive positioning reports from the same workspace. Touchpoints log automatically as the deal moves.",
  },
  {
    index: "05",
    title: "LEASE ABSTRACTS",
    description:
      "Drop in any lease and pull structured data in seconds. Tenant reps track client obligations and expiration windows. Landlord reps monitor tenant commitments across their portfolio — critical dates trigger reminders automatically.",
  },
  {
    index: "06",
    title: "OBLIGATIONS",
    description:
      "Rent bumps, notice periods, landlord deliverables, and tenant commitments tracked across every active lease. Both sides of the deal get automated reminders before anything becomes a problem.",
  },
] as const;

export function HomeLanding({
  isAuthenticated,
  primaryCtaHref,
  secondaryCtaHref,
  workspaceName,
  workspaceDescription,
  stats,
  pipeline,
}: HomeLandingProps) {
  const lockedCardHref = "/sign-up";

  return (
    <section className="landing-home-shell relative z-10 px-0 pb-1 pt-22 sm:pb-2 sm:pt-24">
      <div aria-hidden="true" className="landing-mesh-blob landing-mesh-blob-cyan" />
      <div aria-hidden="true" className="landing-mesh-blob landing-mesh-blob-purple" />

      <div className="app-container">
        <div className="mx-auto max-w-[1240px] 2xl:max-w-[1720px] 3xl:max-w-[1880px]">
        <div className="landing-fade-up grid items-stretch gap-4 xl:min-h-[calc(100vh-10.5rem)] xl:grid-cols-[minmax(0,1fr)_400px] 2xl:gap-6 2xl:grid-cols-[minmax(0,1.08fr)_560px] 3xl:grid-cols-[minmax(0,1.04fr)_620px]">
          <div className="flex h-full min-h-full flex-col gap-4 xl:gap-5">
            <div className="space-y-4">
              <div className="landing-fade-up landing-hero-eyebrow" style={{ animationDelay: "60ms" }}>
                <span className="landing-pulse-dot" />
                <span>Commercial Real Estate Intelligence</span>
              </div>

              <div className="landing-fade-up space-y-3" style={{ animationDelay: "140ms" }}>
                <h1 className="max-w-4xl text-[clamp(36px,4.5vw,54px)] font-extrabold leading-[0.96] tracking-[-0.06em] text-[var(--text)] 2xl:max-w-[58rem] 3xl:max-w-[64rem]">
                  Commercial real estate workflows, <em className="landing-gradient-text not-italic">without the clutter.</em>
                </h1>
                <p className="max-w-3xl text-sm leading-7 text-[var(--muted)] sm:text-[15px] 2xl:max-w-[50rem] 2xl:text-[16px] 3xl:max-w-[56rem] 3xl:text-[17px]">
                  The CRE Model keeps commercial real estate CRM, documents, lease analyses, surveys, lease abstracts, and obligations in one connected workspace so brokerage teams can move faster without losing context.
                </p>
              </div>

              <div className="landing-fade-up flex flex-wrap gap-3" style={{ animationDelay: "220ms" }}>
                <Link href={primaryCtaHref} className="landing-primary-button">
                  {isAuthenticated ? "Open Workspace" : "Get Started"}
                </Link>
                <Link href={secondaryCtaHref} className="landing-secondary-button">
                  View Demo →
                </Link>
              </div>
            </div>

            <div className="landing-fade-up landing-feature-grid xl:flex-1" style={{ animationDelay: "300ms" }}>
              {FEATURE_CARDS.map((card, index) => (
                <article key={card.title} className="landing-step-card landing-feature-card h-full" style={{ animationDelay: `${360 + index * 70}ms` }}>
                  {!isAuthenticated ? (
                    <Link
                      href={lockedCardHref}
                      aria-label={`Sign up to access ${card.title}`}
                      className="absolute inset-0 z-10"
                    />
                  ) : null}
                  <p className="landing-feature-index">{card.index}</p>
                  <h2 className="landing-feature-title">{card.title}</h2>
                  <p className="landing-feature-description">{card.description}</p>
                  <div className="landing-feature-tags" aria-hidden="true">
                    <span className="landing-feature-tag landing-feature-tag-tenant">Tenant Rep</span>
                    <span className="landing-feature-tag landing-feature-tag-landlord">Landlord Rep</span>
                  </div>
                  <span className="landing-feature-arrow" aria-hidden="true">
                    →
                  </span>
                </article>
              ))}
            </div>

          </div>

          <aside className="landing-fade-up landing-right-rail flex h-full min-h-full flex-col gap-3" style={{ animationDelay: "220ms" }}>
            <section className="landing-side-card landing-workspace-card">
              {!isAuthenticated ? (
                <Link
                  href={lockedCardHref}
                  aria-label="Sign up to access the workspace"
                  className="absolute inset-0 z-10"
                />
              ) : null}
              <p className="landing-panel-label">Current Workspace</p>
              <h2 className="mt-3 text-[clamp(1.7rem,3vw,2.25rem)] font-bold tracking-[-0.05em] text-[var(--text)]">
                {workspaceName}
              </h2>
              <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{workspaceDescription}</p>
            </section>

            <section className="grid grid-cols-2 gap-3">
              {stats.map((stat, index) => (
                <article
                  key={stat.label}
                  className="landing-stat-card landing-fade-up h-full"
                  style={{ animationDelay: `${300 + index * 70}ms` }}
                >
                  {!isAuthenticated ? (
                    <Link
                      href={lockedCardHref}
                      aria-label={`Sign up to access ${stat.label}`}
                      className="absolute inset-0 z-10"
                    />
                  ) : null}
                  <p className="landing-stat-value">{stat.value}</p>
                  <p className="landing-stat-label">{stat.label}</p>
                  <p className="landing-stat-detail">{stat.detail}</p>
                </article>
              ))}
            </section>

            <section className="landing-side-card landing-pipeline-card landing-fade-up" style={{ animationDelay: "420ms" }}>
              {!isAuthenticated ? (
                <Link
                  href={lockedCardHref}
                  aria-label="Sign up to access the deal pipeline"
                  className="absolute inset-0 z-10"
                />
              ) : null}
              <div>
                <p className="landing-panel-label">Deal Pipeline</p>
                <div className="landing-pipeline-rows mt-4">
                  {pipeline.map((stage, index) => (
                    <div key={stage.label}>
                      <div className="flex items-center gap-2.5">
                        <span className="landing-pipeline-label">{stage.label}</span>
                        <div className="landing-pipeline-track">
                          <span
                            className={`landing-pipeline-fill ${pipelineToneClass(stage.tone)}`}
                            style={{
                              width: `${stage.width}%`,
                              animationDelay: `${260 + index * 120}ms`,
                            }}
                          />
                        </div>
                        <span className="landing-pipeline-count">{stage.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="landing-side-card landing-platform-activity-card landing-fade-up h-full" style={{ animationDelay: "500ms" }}>
              {!isAuthenticated ? (
                <Link
                  href={lockedCardHref}
                  aria-label="Sign up to access platform stats"
                  className="absolute inset-0 z-10"
                />
              ) : null}
              <p className="landing-platform-activity-label">PLATFORM STATS</p>
              <div className="landing-platform-activity-inner">
                <div className="landing-platform-activity-divider" aria-hidden="true" />
                <div className="landing-platform-activity-grid">
                  <article className="landing-platform-activity-stat">
                    <span className="landing-platform-activity-accent" aria-hidden="true" />
                    <p className="landing-platform-activity-value">1.2k</p>
                    <p className="landing-platform-activity-copy">Leases Parsed</p>
                  </article>
                  <article className="landing-platform-activity-stat">
                    <span className="landing-platform-activity-accent" aria-hidden="true" />
                    <p className="landing-platform-activity-value">4.8k</p>
                    <p className="landing-platform-activity-copy">Hours Saved</p>
                  </article>
                  <article className="landing-platform-activity-stat">
                    <span className="landing-platform-activity-accent" aria-hidden="true" />
                    <p className="landing-platform-activity-value">340</p>
                    <p className="landing-platform-activity-copy">Deals Closed</p>
                  </article>
                  <article className="landing-platform-activity-stat">
                    <span className="landing-platform-activity-accent" aria-hidden="true" />
                    <p className="landing-platform-activity-value">890</p>
                    <p className="landing-platform-activity-copy">Abstracts Built</p>
                  </article>
                  <article className="landing-platform-activity-stat">
                    <span className="landing-platform-activity-accent" aria-hidden="true" />
                    <p className="landing-platform-activity-value">3.4k</p>
                    <p className="landing-platform-activity-copy">Follow-Ups Sent</p>
                  </article>
                  <article className="landing-platform-activity-stat">
                    <span className="landing-platform-activity-accent" aria-hidden="true" />
                    <p className="landing-platform-activity-value">620</p>
                    <p className="landing-platform-activity-copy">Proposals Generated</p>
                  </article>
                </div>
              </div>
            </section>
          </aside>
        </div>
          <div className="landing-fade-up landing-bottom-note-wrap" style={{ animationDelay: "460ms" }}>
            <p className="landing-bottom-note">BUILT FOR BROKERS. BY BROKERS.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
