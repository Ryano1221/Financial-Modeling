import { REPRESENTATION_MODE_PROFILES } from "@/lib/workspace/representation-profile";

const profiles = [
  REPRESENTATION_MODE_PROFILES.tenant_rep,
  REPRESENTATION_MODE_PROFILES.landlord_rep,
];

const FAQ_ITEMS = [
  {
    q: "Is this one platform or separate tools?",
    a: "One platform. Documents, CRM, financial analyses, surveys, lease abstracts, buildings, and obligations all stay tied to the same client workspace.",
  },
  {
    q: "Where should a new user start?",
    a: "Start with the active client, then open the module that matches the task at hand. The product now emphasizes one primary action per workspace instead of multiple competing panels.",
  },
  {
    q: "Does the scenario editor open automatically in Financial Analyses?",
    a: "No. The selected option stays in review mode until you explicitly open the scenario editor, so you can compare options without the full edit panel taking over by default.",
  },
  {
    q: "Where does my workspace save when I am signed in?",
    a: "Signed-in workspaces are saved under that user account in cloud storage, so switching accounts does not reuse another user’s active client, documents, or saved records.",
  },
  {
    q: "Can I upload more than one proposal at a time?",
    a: "Yes. Financial Analyses and the document library support batch uploads, and browser-side source caching no longer depends on a single localStorage record that can fail on the second proposal.",
  },
  {
    q: "Can Obligations parse signed subleases and landlord consents?",
    a: "Yes. Obligations now treats executed subleases, landlord consents, and attached backup lease exhibits as one intake flow, while prioritizing the controlling sublease terms for dates, rent, and obligation tracking.",
  },
  {
    q: "What happens with scanned executed leases that do not have selectable text?",
    a: "If a scanned lease has a readable Basic Lease Information page, the platform now uses a faster OCR-first extraction path for the controlling lease terms so large image-only PDFs do not spend minutes in a slower fallback route before failing.",
  },
  {
    q: "How do I contact support?",
    a: "Use the Contact page or email info@thecremodel.com directly. Contact form submissions are routed to that same inbox so support stays in one place.",
  },
  {
    q: "Do Survey and Lease Abstract exports match the Financial Analysis presentation style?",
    a: "Yes. Survey and Lease Abstract exports now follow the same branded hierarchy, logo treatment, print formatting, and client-ready polish used by Financial Analysis deliverables.",
  },
  {
    q: "What changes when I switch representation mode?",
    a: "The product language, defaults, and workflow emphasis change. The underlying records, security boundary, and connected data model do not.",
  },
];

export default function DocsPage() {
  return (
    <main className="relative z-10 section-shell">
      <div className="app-container max-w-6xl">
        <section className="section-panel space-y-8 p-6 sm:p-10">
          <div className="space-y-3">
            <p className="heading-kicker">Docs</p>
            <h1 className="heading-display !text-[clamp(2rem,5vw,3.75rem)]">How theCREmodel works</h1>
            <p className="body-lead max-w-4xl">
              theCREmodel is built to feel simple on first use: pick the active client, open the right module, complete the task, and keep everything connected without re-entering data.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <div className="brand-badge">One connected workspace</div>
              <div className="brand-badge">Simplified first-time flow</div>
              <div className="brand-badge">Live on thecremodel.com</div>
            </div>
          </div>

          <section className="grid gap-4 lg:grid-cols-3">
            <div className="surface-card p-5">
              <p className="heading-kicker">Step 1</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Start with the source record</h2>
              <p className="mt-2 text-sm text-slate-300">Open the active client, building, deal, lease, or survey document first so the rest of the workflow stays in context.</p>
            </div>
            <div className="surface-card p-5">
              <p className="heading-kicker">Step 2</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Work in one module at a time</h2>
              <p className="mt-2 text-sm text-slate-300">Each section is now trimmed to its clearest primary use so a new user can move through the platform without hunting for the next action.</p>
            </div>
            <div className="surface-card p-5">
              <p className="heading-kicker">Step 3</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Deliver from the same workspace</h2>
              <p className="mt-2 text-sm text-slate-300">Exports, sharing, and follow-up stay tied to the same underlying records, so the workflow remains easy to understand.</p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="heading-section">Core Modules</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <article className="surface-card p-5">
                <p className="heading-kicker">Financial Analyses</p>
                <p className="mt-2 text-sm text-slate-300">Upload the source lease or proposal, review the strongest options, and export the comparison from one workspace.</p>
              </article>
              <article className="surface-card p-5">
                <p className="heading-kicker">CRM</p>
                <p className="mt-2 text-sm text-slate-300">Manage the active client, deal pipeline, reminders, and next follow-up without exposing the whole operating layer at once.</p>
              </article>
              <article className="surface-card p-5">
                <p className="heading-kicker">Buildings</p>
                <p className="mt-2 text-sm text-slate-300">Browse buildings, review suites, and push good options into Surveys, CRM, or Financial Analyses from one active building context.</p>
              </article>
              <article className="surface-card p-5">
                <p className="heading-kicker">Surveys</p>
                <p className="mt-2 text-sm text-slate-300">Keep the survey table, map, editor, and occupancy cost view together so market options are easy to compare, then export branded Excel and PDF packages that match Financial Analysis output quality.</p>
              </article>
              <article className="surface-card p-5">
                <p className="heading-kicker">Lease Abstracts</p>
                <p className="mt-2 text-sm text-slate-300">Parse the controlling lease terms and produce a clean abstract from the saved document set, including institutional-grade workbook and PDF deliverables for client-facing review.</p>
              </article>
              <article className="surface-card p-5">
                <p className="heading-kicker">Obligations</p>
                <p className="mt-2 text-sm text-slate-300">Track deadlines, notices, current leases, amendments, signed subleases, and scanned executed lease packages from the same connected client record.</p>
              </article>
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="brand-panel p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Default Module</p>
                      <p className="mt-1 text-sm text-white">{profile.navigation.modules.find((module) => module.id === profile.navigation.defaultModule)?.label || profile.navigation.defaultModule}</p>
                    </div>
                    <div className="brand-panel p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Default CRM View</p>
                      <p className="mt-1 text-sm text-white">{profile.crm.viewLabels[profile.crm.defaultDealsView]}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
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
