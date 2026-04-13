import type { Metadata } from "next";
import { REPRESENTATION_MODE_PROFILES } from "@/lib/workspace/representation-profile";

export const metadata: Metadata = {
  title: "Security For Commercial Real Estate Workspaces",
  description:
    "Security details for The CRE Model, including authenticated commercial real estate CRM workspace boundaries, cloud document sync, parsed lease payloads, and client-scoped records.",
  alternates: { canonical: "/security" },
  openGraph: {
    title: "The CRE Model Security",
    description:
      "Authenticated workspace boundaries and cloud sync controls for commercial real estate CRM and lease analysis workflows.",
    url: "https://thecremodel.com/security",
  },
};

const profiles = [
  REPRESENTATION_MODE_PROFILES.tenant_rep,
  REPRESENTATION_MODE_PROFILES.landlord_rep,
];

const SECURITY_PILLARS = [
  {
    title: "Authenticated workspace boundaries",
    body: "Protected actions and saved workspace state run under authenticated user context so connected records remain scoped to the signed-in account.",
  },
  {
    title: "User-controlled credentials",
    body: "Signed-in users can update their account name, email, and password from Personal Info while changes continue through the authenticated Supabase user endpoint.",
  },
  {
    title: "Connected data without cross-account bleed",
    body: "Documents, analyses, CRM records, marketing flyers, lease abstracts, and obligations stay tied to the same workspace graph without leaking across users or clients.",
  },
  {
    title: "CRM pipeline linkage",
    body: "New CRM client, tenant, and prospect profiles create linked pipeline deals, stay available in CRM selectors and account client settings, and use controlled stage changes to keep profile status aligned with pipeline movement.",
  },
  {
    title: "Client-scoped branding assets",
    body: "Each client logo is stored once under that client workspace and reused across presentation outputs so branding changes do not fork into mismatched copies.",
  },
  {
    title: "Controlled sync and recovery",
    body: "Signed-in workspace state is persisted in cloud-backed storage and can be restored from any device without silently reviving stale or deleted records.",
  },
  {
    title: "Deletion-aware obligations",
    body: "When a saved source document is deleted, linked obligation repository records are pruned with it so removed lease files do not keep stale deadline records alive.",
  },
  {
    title: "Cross-device parsed document payloads",
    body: "Original file payloads and parsed document snapshots sync separately from the main workspace record so Open and Apply can work on another signed-in device without relying on browser-only file caches.",
  },
  {
    title: "Thirty day device sessions",
    body: "Signed-in devices keep their workspace session for up to 30 days of use unless the user signs out, while backend requests still require authenticated tokens.",
  },
  {
    title: "Visible sync state",
    body: "The footer keeps sync visibility compact with Online, Sign in to sync, and Local states so users can confirm whether the workspace is cloud-connected before switching devices.",
  },
  {
    title: "Bounded document processing",
    body: "OCR-heavy and image-only documents use bounded intake behavior so extraction remains responsive while still protecting the broader workflow and downstream exports.",
  },
  {
    title: "Reviewable obligation events",
    body: "Notice, renewal, and termination dates pulled from lease rights clauses stay attached to the client-scoped obligation record and saved document snapshot so teams can review deadlines before relying on the timeline.",
  },
  {
    title: "Review-aware client outputs",
    body: "Marketing flyers and lease abstract exports preserve analyst review status and source-document context so client-ready packages do not silently hide unresolved extraction issues.",
  },
  {
    title: "White-label marketing output",
    body: "Generated lease and sublease flyers use account branding and saved workspace context instead of hardcoded brokerage identity, while extracted flyer photos and floorplans stay scoped to the generated workspace document and share link.",
  },
  {
    title: "Canonical production host",
    body: "Production traffic is served from thecremodel.com so public pages, authenticated pages, and support flows stay aligned on the same origin.",
  },
  {
    title: "Support visibility for incidents",
    body: "Security questions and operational issues flow through the same monitored support channel so reports can be triaged quickly with workspace context.",
  },
] as const;

export default function SecurityPage() {
  return (
    <main className="marketing-page-shell">
      <div className="app-container">
        <section className="marketing-page-panel mx-auto max-w-[1200px] space-y-8">
          <div className="space-y-4">
            <p className="heading-kicker">Security</p>
            <h1 className="heading-display !text-[clamp(2.4rem,5vw,4.7rem)]">Protected by design, not added as an afterthought.</h1>
            <p className="body-lead max-w-4xl text-[var(--muted)]">
              theCREmodel keeps the public experience clean while preserving authenticated workspace boundaries, cross-device cloud persistence, and a single connected security model across documents, analytics, CRM, marketing flyers, abstracts, and obligations.
            </p>
            <div className="flex flex-wrap gap-3">
              <div className="brand-badge">Authenticated protected actions</div>
              <div className="brand-badge">Workspace isolation</div>
              <div className="brand-badge">thecremodel.com</div>
            </div>
          </div>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {SECURITY_PILLARS.map((pillar) => (
              <article key={pillar.title} className="marketing-card">
                <p className="heading-kicker">Security Pillar</p>
                <h2 className="mt-3 text-2xl font-bold tracking-[-0.04em] text-[var(--text)]">{pillar.title}</h2>
                <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{pillar.body}</p>
              </article>
            ))}
          </section>

          <section className="space-y-4">
            <h2 className="heading-section">Representation Mode Coverage</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {profiles.map((profile) => (
                <article key={profile.mode} className="marketing-card">
                  <p className="heading-kicker">{profile.label}</p>
                  <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{profile.docs.securitySummary}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="marketing-card">
            <p className="heading-kicker">Report A Concern</p>
            <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
              Email <a className="brand-link underline" href="mailto:info@thecremodel.com">info@thecremodel.com</a> for security questions, suspicious behavior, or vulnerability reports.
            </p>
            <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
              Include the workspace or client name, the page involved, the action you took, and any timestamps or screenshots that will help reproduce the issue quickly.
            </p>
          </section>
        </section>
      </div>
    </main>
  );
}
