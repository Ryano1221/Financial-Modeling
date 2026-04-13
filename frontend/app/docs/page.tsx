import type { Metadata } from "next";
import { REPRESENTATION_MODE_PROFILES } from "@/lib/workspace/representation-profile";

export const metadata: Metadata = {
  title: "Commercial Real Estate CRM Docs",
  description:
    "The CRE Model docs for commercial real estate CRM, document intake, lease analysis, proposal workflows, marketing flyers, lease abstracts, obligations, and cross-device workspace sync.",
  alternates: { canonical: "/docs" },
  openGraph: {
    title: "The CRE Model Docs",
    description:
      "Commercial real estate CRM and lease analysis documentation for connected brokerage workflows.",
    url: "https://thecremodel.com/docs",
  },
};

const profiles = [
  REPRESENTATION_MODE_PROFILES.tenant_rep,
  REPRESENTATION_MODE_PROFILES.landlord_rep,
];

const FAQ_ITEMS = [
  {
    q: "What lives in the connected workspace?",
    a: "Documents, financial analyses, CRM records, marketing flyers, lease abstracts, obligations, and deal movement all stay tied to the same workspace instead of being split across separate tools.",
  },
  {
    q: "What changes when I sign in?",
    a: "The structure stays the same, but the workspace card, stats, pipeline, and saved progress hydrate from your authenticated account and sync to cloud-backed storage so you can resume on another device.",
  },
  {
    q: "Can one workspace hold the full deal lifecycle?",
    a: "Yes. The platform is designed to keep intake, comparison, negotiation, abstracting, obligation tracking, and follow-up connected inside one operating surface.",
  },
  {
    q: "How do I get into the live workspace?",
    a: "Use Get Started if you are new, or Open Workspace once you are signed in. The demo remains available from the same landing page without changing the overall layout.",
  },
  {
    q: "Where does saved progress live?",
    a: "Signed-in workspace state persists in cloud-backed account storage so document records, original file payloads, parsed Apply payloads, connected records, and module progress restore after you sign in from any phone, tablet, or computer.",
  },
  {
    q: "How do I know sync is working?",
    a: "The footer shows a small live state: Online means the signed-in workspace is using cloud sync, Sign in to sync means the browser is signed out, and Local means the signed-in browser could not reach cloud storage.",
  },
  {
    q: "How long do I stay signed in?",
    a: "A device stays signed in for up to 30 days of workspace use unless you choose Sign out from the account page first. Personal Info settings let signed-in users update their name, email, and password.",
  },
  {
    q: "Can I move from documents into analyses, CRM, or obligations?",
    a: "Yes. Module handoffs are designed around one active workspace so saved parsed records can keep moving forward from any signed-in device without re-uploading the source document. Lease obligation intake carries critical notice, renewal, and termination dates from parsed rights clauses into the obligation timeline, including when the lease is applied from the saved document library. Deleting a source lease document also removes its single-source obligation record, or detaches the deleted file when other source documents still support the obligation.",
  },
  {
    q: "Do new CRM clients and prospects enter the pipeline?",
    a: "Yes. Creating a CRM client, tenant, or prospect profile also creates the first linked pipeline deal and keeps the profile visible in the CRM selector, account client settings, board, table, and grouped CRM views. The profile Prospect Stage uses the same stage list as the pipeline and moves the linked deal when it changes.",
  },
  {
    q: "Are marketing flyer and lease abstract exports client-ready?",
    a: "Yes. Marketing flyers and lease abstract exports are generated as branded presentation outputs with structured summary sections, detail views, and review visibility so they stay aligned with the financial analysis export standard.",
  },
  {
    q: "Does each client need more than one logo?",
    a: "No. Each client uses one shared logo asset that carries through PDF covers and branded client-facing exports so branding stays consistent instead of diverging by output type.",
  },
] as const;

export default function DocsPage() {
  return (
    <main className="marketing-page-shell">
      <div className="app-container">
        <section className="marketing-page-panel mx-auto max-w-[1200px] space-y-8">
          <div className="space-y-4">
            <p className="heading-kicker">Docs</p>
            <h1 className="heading-display !text-[clamp(2.4rem,5vw,4.9rem)]">
              One workspace for the full commercial real estate workflow.
            </h1>
            <p className="body-lead max-w-4xl text-[var(--muted)]">
              theCREmodel is built around a single connected workspace so source documents, analyses, CRM context, marketing flyers, lease abstracts, and obligations stay aligned from intake through execution.
            </p>
            <div className="flex flex-wrap gap-3">
              <div className="brand-badge">Connected workspace</div>
              <div className="brand-badge">Auth-aware landing</div>
              <div className="brand-badge">Live on thecremodel.com</div>
            </div>
          </div>

          <section className="grid gap-4 lg:grid-cols-3">
            <article className="marketing-card">
              <p className="heading-kicker">Capture</p>
              <h2 className="mt-3 text-2xl font-bold tracking-[-0.04em] text-[var(--text)]">Start from the source record</h2>
              <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                Bring in leases, proposals, flyers, amendments, and related files so the rest of the workflow inherits real workspace context and keeps both the source file and parsed Apply payload available across signed-in devices. Lease uploads and saved document Apply actions surface expiration, notice, renewal, and termination rights for obligation tracking, while marketing intake can generate branded lease or sublease flyers.
              </p>
            </article>
            <article className="marketing-card">
              <p className="heading-kicker">Connect</p>
              <h2 className="mt-3 text-2xl font-bold tracking-[-0.04em] text-[var(--text)]">Keep every module in sync</h2>
              <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                Documents, parsed terms, CRM records, profile selectors, newly created pipeline deals, marketing flyers, lease abstracts, and obligations stay associated with the same active workspace and sync through account-backed cloud storage instead of branching into device-local copies. Deleted source documents are also pruned from linked obligation records so stale repository items do not reappear.
              </p>
            </article>
            <article className="marketing-card">
              <p className="heading-kicker">Deliver</p>
              <h2 className="mt-3 text-2xl font-bold tracking-[-0.04em] text-[var(--text)]">Move the next action clearly</h2>
              <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                The landing screen surfaces current workspace context, core counts, pipeline movement, recent activity, and branded export paths so teams know what to do next without interface clutter.
              </p>
            </article>
          </section>

          <section className="space-y-4">
            <h2 className="heading-section">Representation Modes</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {profiles.map((profile) => (
                <article key={profile.mode} className="marketing-card">
                  <p className="heading-kicker">{profile.label}</p>
                  <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{profile.summary}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="brand-panel p-4">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">Default Module</p>
                      <p className="mt-2 text-sm text-[var(--text)]">
                        {profile.navigation.modules.find((module) => module.id === profile.navigation.defaultModule)?.label || profile.navigation.defaultModule}
                      </p>
                    </div>
                    <div className="brand-panel p-4">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">Operating Focus</p>
                      <p className="mt-2 text-sm text-[var(--text)]">{profile.crm.operatingLayerFocus}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="heading-section">FAQ</h2>
            <div className="grid gap-4">
              {FAQ_ITEMS.map((item) => (
                <article key={item.q} className="marketing-card">
                  <h3 className="text-xl font-bold tracking-[-0.03em] text-[var(--text)]">{item.q}</h3>
                  <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{item.a}</p>
                </article>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
