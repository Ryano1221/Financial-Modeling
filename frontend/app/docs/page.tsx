import { REPRESENTATION_MODE_PROFILES } from "@/lib/workspace/representation-profile";

const FAQ_ITEMS = [
  {
    q: "Is this one platform or two separate products?",
    a: "One platform. Tenant Rep and Landlord Rep run on the same shared entity graph, document intelligence layer, AI orchestration layer, export system, and CRM architecture.",
  },
  {
    q: "What changes when I switch representation mode?",
    a: "The platform adapts onboarding, navigation emphasis, dashboard composition, default CRM views, AI suggestions, reminders, templates, next best actions, and export framing without changing the underlying records.",
  },
  {
    q: "What is the default CRM view in each mode?",
    a: "Tenant Rep opens the CRM in a client-grouped company hub view. Landlord Rep opens the CRM in a building-first stacking-plan workspace built from shared building, suite, lease, sublease, deal, and obligation records.",
  },
  {
    q: "What does the landlord stacking plan show?",
    a: "Editable floor and suite blocks, occupied suites, vacant suites, current lease and sublease occupancy, upcoming expirations, active proposal motion, and toured suites, organized by building, floor, and suite from the same shared data model used everywhere else in the platform.",
  },
  {
    q: "How does AI adapt by mode?",
    a: "Tenant Rep AI biases toward companies, prospects, requirements, surveys, analyses, and obligations. Landlord Rep AI biases toward buildings, suites, availabilities, tours, proposals, expirations, and ownership reporting.",
  },
  {
    q: "Do exports use different systems in each mode?",
    a: "No. Exports use one shared pipeline, but the framing shifts by mode: tenant outputs are advisory and client-facing, while landlord outputs are operational and ownership-facing.",
  },
];

const profiles = [
  REPRESENTATION_MODE_PROFILES.tenant_rep,
  REPRESENTATION_MODE_PROFILES.landlord_rep,
];

export default function DocsPage() {
  return (
    <main className="relative z-10 section-shell">
      <div className="app-container max-w-6xl">
        <section className="section-panel space-y-8 p-6 sm:p-10">
          <div className="space-y-3">
            <p className="heading-kicker">Docs</p>
            <h1 className="heading-display !text-[clamp(2rem,5vw,3.75rem)]">Using theCREmodel</h1>
            <p className="body-lead max-w-4xl">
              theCREmodel is one AI-native commercial real estate operating system that adapts to tenant-side and landlord-side brokerage work through a shared representation mode profile layer.
            </p>
          </div>

          <section className="space-y-3">
            <h2 className="heading-section">Shared Architecture</h2>
            <p className="text-sm text-slate-300 sm:text-base">
              Both modes operate on one shared codebase, one shared entity graph, one shared document system, one shared AI orchestration layer, one shared export system, and one shared CRM architecture.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="surface-card p-4">
                <p className="heading-kicker">Shared Graph</p>
                <p className="mt-2 text-sm text-slate-300">Companies, contacts, buildings, floors, suites, leases, obligations, deals, proposals, analyses, surveys, tasks, and activities stay connected.</p>
              </div>
              <div className="surface-card p-4">
                <p className="heading-kicker">Shared AI</p>
                <p className="mt-2 text-sm text-slate-300">The same AI orchestration layer powers prompt interpretation, suggested actions, automation, and audit visibility in both modes.</p>
              </div>
              <div className="surface-card p-4">
                <p className="heading-kicker">Shared Exports</p>
                <p className="mt-2 text-sm text-slate-300">PDFs, spreadsheets, reports, and share links all use the same export pipeline with mode-aware framing.</p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="heading-section">Representation Modes</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {profiles.map((profile) => (
                <article key={profile.mode} className="surface-card space-y-4 p-5 sm:p-6">
                  <div>
                    <p className="heading-kicker">{profile.label}</p>
                    <p className="mt-2 text-sm text-slate-300 sm:text-base">{profile.summary}</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Default Module</p>
                      <p className="mt-1 text-sm text-white">{profile.navigation.modules.find((module) => module.id === profile.navigation.defaultModule)?.label || profile.navigation.defaultModule}</p>
                    </div>
                    <div className="border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Default CRM View</p>
                      <p className="mt-1 text-sm text-white">{profile.crm.viewLabels[profile.crm.defaultDealsView]}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Workflow Emphasis</p>
                    <ul className="mt-2 space-y-2 text-sm text-slate-300">
                      {profile.crm.dashboardWidgets.slice(0, 4).map((widget) => (
                        <li key={widget.id}>• {widget.label}: {widget.description}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-400">AI Suggestions</p>
                    <ul className="mt-2 space-y-2 text-sm text-slate-300">
                      {profile.ai.suggestedPrompts.slice(0, 3).map((prompt) => (
                        <li key={prompt}>• {prompt}</li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Mode-Aware Surfaces</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="surface-card p-4">
                <p className="heading-kicker">Onboarding + Navigation</p>
                <p className="mt-2 text-sm text-slate-300">Onboarding steps, module order, module labels, and workspace defaults are seeded by the active representation mode profile.</p>
              </div>
              <div className="surface-card p-4">
                <p className="heading-kicker">Dashboards + CRM</p>
                <p className="mt-2 text-sm text-slate-300">Tenant dashboards center companies and relationships. Landlord dashboards center buildings, suites, vacancies, tours, proposals, and downtime risk.</p>
                <p className="mt-2 text-sm text-slate-300">Dashboards are organized into Command Metrics, grouped Insights, and a Drill-Down Workspace so the highest-priority information appears first without removing any detail.</p>
                <p className="mt-2 text-sm text-slate-300">CRM intake now supports typed building search with existing-record autofill and an add-building path when no current match exists.</p>
                <p className="mt-2 text-sm text-slate-300">Account CRM settings now include a shared CoStar Excel import path. Published `.xlsx` office inventory rows update the common building dataset used across CRM for all users, while client-scoped records and overrides remain isolated inside each workspace.</p>
                <p className="mt-2 text-sm text-slate-300">Landlord building views now include an editable stacking-plan workspace for floors and suites, with optional economics such as rate, OpEx, abatement, TI allowance, concessions, and size saved directly to the active building record.</p>
                <p className="mt-2 text-sm text-slate-300">Current lease, amendment, abstract, and sublease uploads can seed or refresh stack occupancy. Proposal, LOI, and counter uploads do not overwrite stack occupancy.</p>
              </div>
              <div className="surface-card p-4">
                <p className="heading-kicker">AI + Next Best Actions</p>
                <p className="mt-2 text-sm text-slate-300">Side panels, prompt interpretation, suggested commands, and next best actions shift by mode without splitting the AI tool layer.</p>
              </div>
              <div className="surface-card p-4">
                <p className="heading-kicker">Reminders + Templates + Exports</p>
                <p className="mt-2 text-sm text-slate-300">Reminder timing, outreach templates, and export descriptors all reuse shared infrastructure while changing framing to match the active brokerage workflow.</p>
              </div>
              <div className="surface-card p-4">
                <p className="heading-kicker">Production Access</p>
                <p className="mt-2 text-sm text-slate-300">Production is served from <strong>thecremodel.com</strong>. Long-running workflows can use the platform&apos;s existing direct-processing paths, while support and proof routes continue to use the same-origin application domain.</p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Core Modules</h2>
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300 sm:text-base">
              <li><strong>CRM:</strong> The mode-aware operating hub for companies or buildings, linked records, tasks, reminders, activities, AI actions, and execution workflows.</li>
              <li><strong>Surveys:</strong> Market options, shortlist management, and location intelligence using the shared record graph.</li>
              <li><strong>Financial Analyses:</strong> Lease comparison, economics, and sublease recovery on top of parsed proposal and lease data.</li>
              <li><strong>Lease Abstracts:</strong> Shared lease parsing and abstracting workflows that feed both tenant and landlord operations.</li>
              <li><strong>Obligations / Reporting:</strong> Lease deadlines, notices, expiration risk, and reporting outputs, framed by representation mode.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">FAQ</h2>
            <div className="space-y-3">
              {FAQ_ITEMS.map((item) => (
                <article key={item.q} className="surface-card p-4 sm:p-5">
                  <h3 className="text-base font-semibold text-white sm:text-lg">{item.q}</h3>
                  <p className="mt-2 text-sm text-slate-300 sm:text-base">{item.a}</p>
                </article>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
