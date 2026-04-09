import { REPRESENTATION_MODE_PROFILES } from "@/lib/workspace/representation-profile";

const profiles = [
  REPRESENTATION_MODE_PROFILES.tenant_rep,
  REPRESENTATION_MODE_PROFILES.landlord_rep,
];

export default function SecurityPage() {
  return (
    <main className="relative z-10 section-shell">
      <div className="app-container max-w-6xl">
        <section className="section-panel space-y-8 p-6 sm:p-10">
          <div className="space-y-3">
            <p className="heading-kicker">Security</p>
            <h1 className="heading-display !text-[clamp(2rem,5vw,3.75rem)]">Security overview</h1>
            <p className="body-lead max-w-4xl">
              theCREmodel keeps the product simple at the surface while maintaining one shared security boundary underneath every module.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <div className="brand-badge">Client-scoped workspace isolation</div>
              <div className="brand-badge">Authenticated protected actions</div>
              <div className="brand-badge">Canonical production host</div>
            </div>
          </div>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="surface-card p-5">
              <p className="heading-kicker">Authentication</p>
              <p className="mt-2 text-sm text-slate-300">Protected workflows, storage actions, and client-facing exports run with authenticated user context, including account-scoped cloud workspace persistence that restores saved workspace state only inside that signed-in user account across devices. Users can authenticate with a password or a secure emailed sign-in link.</p>
            </div>
            <div className="surface-card p-5">
              <p className="heading-kicker">Workspace Isolation</p>
              <p className="mt-2 text-sm text-slate-300">Documents, deals, surveys, obligations, and linked records stay attached to the active client workspace, including executed subleases and attached consent packages.</p>
            </div>
            <div className="surface-card p-5">
              <p className="heading-kicker">Controlled Deletion</p>
              <p className="mt-2 text-sm text-slate-300">Intentional document and building deletions persist so removed records do not silently reappear from stale sync state.</p>
            </div>
            <div className="surface-card p-5">
              <p className="heading-kicker">Browser Storage</p>
              <p className="mt-2 text-sm text-slate-300">Large source-file payloads are cached in browser-managed document storage instead of relying on one oversized localStorage entry, and local fallback now acts as a recovery cache for the same signed-in account while cloud sync remains the source used to restore records on another device.</p>
            </div>
            <div className="surface-card p-5">
              <p className="heading-kicker">Bounded OCR</p>
              <p className="mt-2 text-sm text-slate-300">Image-only lease PDFs use a bounded OCR-aware intake path so authenticated lease submission stays responsive, while deeper extraction checks are intentionally capped for OCR-heavy files instead of scanning every page synchronously.</p>
            </div>
            <div className="surface-card p-5">
              <p className="heading-kicker">Production Host</p>
              <p className="mt-2 text-sm text-slate-300">Production traffic is served from <strong>thecremodel.com</strong> with same-origin support and proof routes.</p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="heading-section">How simplification affects security</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="surface-card p-5">
                <p className="heading-kicker">Presentation changes</p>
                <p className="mt-2 text-sm text-slate-300">The cleaner landing pages, simpler module shells, and on-demand editors are presentation changes only. They do not expand data access or introduce a second storage path.</p>
              </div>
              <div className="surface-card p-5">
                <p className="heading-kicker">Integrated workflows</p>
                <p className="mt-2 text-sm text-slate-300">Cross-module handoffs still stay inside the same client workspace, so surveys, analyses, CRM records, lease abstracts, obligations, and their exported client deliverables remain connected without weakening isolation or crossing between signed-in accounts. Context-aware document actions reuse that same scoped workspace instead of creating a second import path.</p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="heading-section">Representation modes</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {profiles.map((profile) => (
                <article key={profile.mode} className="surface-card brand-panel p-5">
                  <p className="heading-kicker">{profile.label}</p>
                  <p className="mt-2 text-sm text-slate-300">{profile.docs.securitySummary}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Report a concern</h2>
            <p className="text-sm text-slate-300 sm:text-base">
              Email{" "}
              <a className="brand-link underline" href="mailto:info@thecremodel.com">
                info@thecremodel.com
              </a>{" "}
              for security questions or vulnerability reports.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              The Contact page points users to the same inbox, so operational issues and security follow-up both stay centered on the core support channel.
            </p>
          </section>
        </section>
      </div>
    </main>
  );
}
