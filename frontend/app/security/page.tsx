export default function SecurityPage() {
  return (
    <main className="relative z-10 section-shell">
      <div className="app-container max-w-5xl">
        <section className="section-panel p-6 sm:p-10 space-y-8">
          <div className="space-y-3">
            <p className="heading-kicker">Security</p>
            <h1 className="heading-display !text-[clamp(2rem,5vw,3.75rem)]">Security Overview</h1>
            <p className="body-lead max-w-3xl">
              The CRE Model keeps account access, client scoping, document handling, and AI-assisted workflows inside one controlled system.
            </p>
          </div>

          <section className="grid gap-4 lg:grid-cols-3">
            <article className="surface-card p-5 space-y-2">
              <p className="heading-kicker">Access</p>
              <h2 className="text-xl text-white">Authenticated</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Protected actions require authenticated user context and server-side authorization checks.
              </p>
            </article>
            <article className="surface-card p-5 space-y-2">
              <p className="heading-kicker">Data</p>
              <h2 className="text-xl text-white">Account Scoped</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Workspace settings, documents, branding, deals, surveys, abstracts, and obligations stay bound to the active account and client scope.
              </p>
            </article>
            <article className="surface-card p-5 space-y-2">
              <p className="heading-kicker">Transport</p>
              <h2 className="text-xl text-white">Encrypted</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Data is protected over HTTPS/TLS in transit and persisted in encrypted managed storage.
              </p>
            </article>
          </section>

          <section className="space-y-4">
            <h2 className="heading-section">Core Controls</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <article className="surface-card p-5 space-y-2">
                <h3 className="text-lg text-white">Authentication and isolation</h3>
                <p className="text-sm sm:text-base text-slate-300">
                  Supabase Auth handles identity, and Row Level Security protects persisted user settings and account-scoped records.
                </p>
              </article>
              <article className="surface-card p-5 space-y-2">
                <h3 className="text-lg text-white">Client workspace boundaries</h3>
                <p className="text-sm sm:text-base text-slate-300">
                  Documents, CRM records, lease abstracts, surveys, and obligations remain tied to the active client workspace to prevent cross-client leakage.
                </p>
              </article>
              <article className="surface-card p-5 space-y-2">
                <h3 className="text-lg text-white">Private branding assets</h3>
                <p className="text-sm sm:text-base text-slate-300">
                  Brokerage branding and logo assets are stored privately and resolved per authenticated account context.
                </p>
              </article>
              <article className="surface-card p-5 space-y-2">
                <h3 className="text-lg text-white">Auditable AI actions</h3>
                <p className="text-sm sm:text-base text-slate-300">
                  AI-assisted actions, workflow transitions, and entity updates are logged so teams can review what changed and why.
                </p>
              </article>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Interface Simplification</h2>
            <p className="text-sm sm:text-base text-slate-300">
              The redesigned UI changes how information is grouped and revealed, but it does not weaken authentication,
              authorization, workspace isolation, or account-scoped persistence.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Vulnerability Reporting</h2>
            <p className="text-sm sm:text-base text-slate-300">
              Report security concerns to <a className="underline decoration-white/40 hover:decoration-white" href="mailto:info@thecremodel.com">info@thecremodel.com</a>.
            </p>
          </section>
        </section>
      </div>
    </main>
  );
}
