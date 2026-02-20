export default function SecurityPage() {
  return (
    <main className="relative z-10 section-shell">
      <div className="app-container max-w-5xl">
        <section className="section-panel p-6 sm:p-10 space-y-8">
            <div className="space-y-3">
              <p className="heading-kicker">Security</p>
              <h1 className="heading-display !text-[clamp(2rem,5vw,3.75rem)]">Security Overview</h1>
              <p className="body-lead max-w-3xl">
                The CRE Model uses practical controls for authentication, tenant data separation, and private branding
                asset handling.
              </p>
            </div>

            <section className="space-y-3">
              <h2 className="heading-section">Authentication</h2>
              <p className="text-sm sm:text-base text-slate-300">
                User authentication is handled through Supabase Auth. Protected actions require a valid bearer token,
                and backend routes verify identity server-side before processing account-scoped operations.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Per-User Data Isolation (RLS)</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Persistent user settings are stored in Supabase Postgres with Row Level Security enabled. Policies are
                designed so users can only read and write rows mapped to their own authenticated identity.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Private Logo Storage</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Brokerage logos are stored in a private Supabase Storage bucket, scoped by account path. Access is
                restricted and branding retrieval is resolved per authenticated user context.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Encryption</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Data is transmitted over HTTPS/TLS in transit, and Supabase-managed data stores provide encryption at
                rest for persisted records and files.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Cross-Account Access</h2>
              <p className="text-sm sm:text-base text-slate-300">
                User data is not shared across accounts. Request handling and storage keys are account-scoped to prevent
                cross-tenant data access.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Vulnerability Reporting</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Report security concerns to{" "}
                <a className="underline decoration-white/40 hover:decoration-white" href="mailto:info@thecremodel.com">
                  info@thecremodel.com
                </a>
                .
              </p>
            </section>
        </section>
      </div>
    </main>
  );
}
