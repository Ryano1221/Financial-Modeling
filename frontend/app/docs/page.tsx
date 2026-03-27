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
    a: "Editable floor and suite blocks, occupied suites, vacant suites, current lease and sublease occupancy, upcoming expirations, shortlist motion, active proposal motion, and toured suites, organized by building, floor, and suite from the same shared data model used everywhere else in the platform.",
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
            <div className="flex flex-wrap gap-3 pt-2">
              <div className="brand-badge">Shared platform architecture</div>
              <div className="brand-badge">Mode-aware workflows</div>
              <div className="brand-badge">Live on thecremodel.com</div>
            </div>
          </div>

          <section className="space-y-3">
            <h2 className="heading-section">Shared Architecture</h2>
            <p className="text-sm text-slate-300 sm:text-base">
              Both modes operate on one shared codebase, one shared entity graph, one shared document system, one shared AI orchestration layer, one shared export system, and one shared CRM architecture.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="surface-card brand-panel p-4">
                <p className="heading-kicker">Shared Graph</p>
                <p className="mt-2 text-sm text-slate-300">Companies, contacts, buildings, floors, suites, leases, obligations, deals, proposals, analyses, surveys, tasks, and activities stay connected.</p>
              </div>
              <div className="surface-card brand-panel p-4">
                <p className="heading-kicker">Shared AI</p>
                <p className="mt-2 text-sm text-slate-300">The same AI orchestration layer powers prompt interpretation, suggested actions, automation, and audit visibility in both modes.</p>
              </div>
              <div className="surface-card brand-panel p-4">
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
                    <div className="brand-panel p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Default Module</p>
                      <p className="mt-1 text-sm text-white">{profile.navigation.modules.find((module) => module.id === profile.navigation.defaultModule)?.label || profile.navigation.defaultModule}</p>
                    </div>
                    <div className="brand-panel p-3">
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
                <p className="mt-2 text-sm text-slate-300">The Deals workspace now includes a dedicated deal-room shell inspired by enterprise leasing systems: each transaction can be run through explicit Overview, Company, Updates, Listings, Tours, Negotiation, User Management, and Client View tabs instead of one long generic form.</p>
                <p className="mt-2 text-sm text-slate-300">Those deal rooms keep projected close timing, move reason, current-location constraints, access controls, curated client-view summaries, and negotiation trackers attached to the same underlying transaction record used by CRM boards and building workflows.</p>
                <p className="mt-2 text-sm text-slate-300">A dedicated Buildings module now exposes the full building and suite inventory on one shared map with filters, result lists, detail panels, and building-first workflow actions into Surveys, CRM, and Analyses.</p>
                <p className="mt-2 text-sm text-slate-300">The Buildings workspace now supports suite-level filtering, photo-forward result cards, and selected-suite handoff into Surveys so users can move from map browsing to actual option building without rekeying data.</p>
                <p className="mt-2 text-sm text-slate-300">Map selection mode can now drag-select nearby buildings, keep that building set highlighted in the results panel, and feed selected suites directly into Financial Analyses through the same scenario workflow used elsewhere in the platform.</p>
                <p className="mt-2 text-sm text-slate-300">CRM intake now supports typed building search with existing-record autofill and an add-building path when no current match exists.</p>
                <p className="mt-2 text-sm text-slate-300">Account CRM settings now include a shared CoStar Excel import path. Published `.xlsx` office inventory rows update the common building dataset used across CRM for all users, while client-scoped records and overrides remain isolated inside each workspace.</p>
                <p className="mt-2 text-sm text-slate-300">Landlord building views now include an editable stacking-plan workspace for floors and suites, with optional economics such as rate, OpEx, abatement, TI allowance, concessions, and size saved directly to the active building record.</p>
                <p className="mt-2 text-sm text-slate-300">Current lease, amendment, abstract, and sublease uploads can seed or refresh stack occupancy. Proposal, LOI, and counter uploads do not overwrite stack occupancy.</p>
                <p className="mt-2 text-sm text-slate-300">Buildings now also support deal-linked shortlist and tour workflow actions, so selected suites can move directly into shortlist, scheduled tour, and proposal-requested states without leaving the building workspace.</p>
                <p className="mt-2 text-sm text-slate-300">CRM now exposes dedicated shortlist and tour boards inside the deal workspace so teams can manage option progression and tour outcomes visually after the building-side handoff.</p>
                <p className="mt-2 text-sm text-slate-300">Those CRM boards now support inline editing for tour attendees, notes, and follow-up tasks, plus AI actions for generating a tour brief or preparing proposal-request guidance directly from the active card.</p>
                <p className="mt-2 text-sm text-slate-300">Board-level building, broker, and date filters make the shortlist and tour workspace usable for larger teams without forcing users to leave the deal record.</p>
                <p className="mt-2 text-sm text-slate-300">Shortlist and tour cards can now be dragged directly between board columns, which updates the same underlying CRM workflow records that drive the rest of the deal workspace.</p>
                <p className="mt-2 text-sm text-slate-300">Shortlist cards now support inline owner assignment and tour cards support inline assignee fields, so board responsibility can be set directly where the work is happening.</p>
                <p className="mt-2 text-sm text-slate-300">Board cards can now be selected in bulk for reassignment, which lets a lead broker rebalance shortlist ownership or tour coordination across multiple cards at once without opening every record individually.</p>
                <p className="mt-2 text-sm text-slate-300">Teams can save both deal-specific and team-wide board views for recurring broker or building slices, and team-wide views are now role-aware so shared filters can be reused without giving every user edit rights to the shared view layer.</p>
                <p className="mt-2 text-sm text-slate-300">Completed tour cards now support AI-generated post-tour recap email drafts with subject and body output, plus one-click send-to-client through the backend mail flow and one-click log-to-deal actions so the recap becomes part of real workflow follow-through.</p>
              </div>
              <div className="surface-card p-4">
                <p className="heading-kicker">AI + Next Best Actions</p>
                <p className="mt-2 text-sm text-slate-300">Side panels, prompt interpretation, suggested commands, and next best actions shift by mode without splitting the AI tool layer.</p>
              </div>
              <div className="surface-card p-4">
                <p className="heading-kicker">Reminders + Templates + Exports</p>
                <p className="mt-2 text-sm text-slate-300">Reminder timing, outreach templates, and export descriptors all reuse shared infrastructure while changing framing to match the active brokerage workflow.</p>
              </div>
              <div className="surface-card brand-panel p-4">
                <p className="heading-kicker">Production Access</p>
                <p className="mt-2 text-sm text-slate-300">Production is served from <strong>thecremodel.com</strong>. Long-running workflows can use the platform&apos;s existing direct-processing paths, while support and proof routes continue to use the same-origin application domain.</p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Core Modules</h2>
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300 sm:text-base">
              <li><strong>CRM:</strong> The mode-aware operating hub for companies or buildings, linked records, tasks, reminders, activities, AI actions, and execution workflows.</li>
              <li><strong>Deal Rooms:</strong> A transaction-first operating layer for overview summaries, listing progression, tours, negotiation tracking, access management, updates, and curated client-facing previews.</li>
              <li><strong>Buildings:</strong> A shared building browser with comprehensive map filters, suite visibility, stacking plans, and handoff actions into surveys and other workflows. Client-scoped building removals now persist across refresh and cloud sync, so deleted buildings do not repopulate from saved workspace state.</li>
              <li><strong>Surveys:</strong> Market options, shortlist management, and location intelligence using the shared record graph.</li>
              <li><strong>Financial Analyses:</strong> Lease comparison, economics, and sublease recovery on top of parsed proposal and lease data. The extractor now uses a guided intake panel with a visible file picker, core-field validation, automatic snapshot repair, and a presentation-ready comparison workspace that keeps source intake, option selection, active editing, and exports in one clean flow. Renewal and counterproposal parsing still preserves explicit carry-forward OpEx cues such as clauses that say the economics should match the existing lease structure, so retained escalations are not flattened to zero. Word proposals and counters that use section layouts like <code>PRIMARY LEASE TERM</code>, <code>RENT ABATEMENT PERIOD</code>, and <code>BASE ANNUAL NET RENTAL RATE</code> now parse option-specific term, abatement, and stepped-rent economics more reliably as well, including landlord-response or tenant-counter files that still contain the original embedded RFP pages above the response terms. Uploads from the Financial Analyses module still carry the saved document id into the scenario pipeline whether they come through the dedicated extract widget, the tab-wide drop zone, or the module document center, and successful parses automatically reopen the comparison summary. Saved workspace snapshots are repaired on reopen so stale confidence scores or outdated review flags do not kick a healthy lease back into a manual gate after refresh. Files that do not yield a dependable canonical lease no longer pretend to be parsed, so the workspace surfaces the extraction issue instead of silently parking a dead document row. Existing workspace documents can also re-parse from their saved file payload when a parsed snapshot is missing. The extraction pipeline now includes additional resilience so that errors in optional enrichment steps are isolated and do not block the core lease extraction result.</li>
              <li><strong>Document Center:</strong> Uploaded PDFs, images, and supported Word proposal files now keep a browser-local openable payload alongside cloud-synced metadata, so the same browser can reopen those files after refresh without losing document intelligence state. Intentional document removals now also persist, preventing deleted files from reappearing from stale synced workspace payloads.</li>
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
