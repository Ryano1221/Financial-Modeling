export default function SecurityPage() {
  return (
    <main className="relative z-10 section-shell">
      <div className="app-container max-w-5xl">
        <section className="section-panel p-6 sm:p-10 space-y-8">
            <div className="space-y-3">
              <p className="heading-kicker">Security</p>
              <h1 className="heading-display !text-[clamp(2rem,5vw,3.75rem)]">Security Overview</h1>
              <p className="body-lead max-w-3xl">
                The CRE Model applies practical controls for authentication, client-workspace isolation, document
                handling, and auditable AI-assisted workflows.
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
              <h2 className="heading-section">Client Workspace Isolation</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Platform records are tied to an active client workspace. Documents, deals, surveys, abstracts, and
                obligations are loaded and persisted with client-specific identifiers to prevent cross-client leakage.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Representation Mode Controls</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Tenant Rep and Landlord Rep are account-scoped operating modes. Mode selection changes workflow defaults
                and interface emphasis, but does not weaken account authorization boundaries or data isolation controls.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Interface Updates</h2>
              <p className="text-sm sm:text-base text-slate-300">
                CRM layout improvements, navigation ordering, and module naming updates (for example Lease Abstract)
                are client-side presentation changes. Authentication checks, account-scoped authorization, and
                data-isolation controls remain unchanged.
              </p>
              <p className="text-sm sm:text-base text-slate-300">
                CRM Settings (stage order, stage automation toggle, and default CRM view) are handled in Account
                Settings for the active client, and follow the same account-scoped access controls.
              </p>
              <p className="text-sm sm:text-base text-slate-300">
                The Account page Settings area writes CRM configuration to the active client scope only.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Single Intake Surface</h2>
              <p className="text-sm sm:text-base text-slate-300">
                File ingestion is centralized to one shared Document Center library. Whether a file is uploaded in
                Document Center, or dropped anywhere in the active workspace,
                ingestion follows the same account-scoped processing controls.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Auditability and AI Actions</h2>
              <p className="text-sm sm:text-base text-slate-300">
                System activity, entity changes, and AI-triggered actions are captured in centralized logs for traceable
                workflow history and operational review.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Map Geocoding</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Survey map pins are generated from location text fields (for example building and address) using
                client-side geocoding. Account authorization and data-isolation controls remain unchanged.
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
