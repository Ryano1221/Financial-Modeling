const FAQ_ITEMS = [
  {
    q: "Where should I start in each module?",
    a: "Each module still has its own destination, but the top of the page now shows connected items, next actions, AI suggestions, and workflow links so you can see what belongs together.",
  },
  {
    q: "Do uploads still go to the same client library?",
    a: "Yes. Files dropped inside a module still save into the active client document library and then feed the relevant workflow automatically.",
  },
  {
    q: "Where are advanced controls now?",
    a: "Advanced fields, editors, document associations, and full tables are still available, but they live in expandable workflow sections so the first screen is easier to understand.",
  },
  {
    q: "How do CRM stages work?",
    a: "Open Account > Settings > CRM Settings for the active client. Stage order, stage automation, and default Deals view are managed there.",
  },
  {
    q: "What changes between Tenant Rep and Landlord Rep mode?",
    a: "The architecture stays shared, but module emphasis, defaults, terminology, stage templates, AI guidance, and dashboards adapt to the selected representation mode.",
  },
];

export default function DocsPage() {
  return (
    <main className="relative z-10 section-shell">
      <div className="app-container max-w-5xl">
        <section className="section-panel p-6 sm:p-10 space-y-8">
          <div className="space-y-3">
            <p className="heading-kicker">Docs</p>
            <h1 className="heading-display !text-[clamp(2rem,5vw,3.75rem)]">Platform Guide</h1>
            <p className="body-lead max-w-3xl">
              The CRE Model keeps its module structure, but now makes relationships between CRM, Surveys, Financial
              Analyses, Lease Abstracts, Obligations, and Documents much easier to understand.
            </p>
          </div>

          <section className="grid gap-4 lg:grid-cols-3">
            <article className="surface-card p-5 space-y-2">
              <p className="heading-kicker">Primary Action</p>
              <h2 className="text-xl text-white">Start Here</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Each module leads with one clear action first. Connected-item panels, flow indicators, and summary strips help you move to the next relevant module without getting lost.
              </p>
            </article>
            <article className="surface-card p-5 space-y-2">
              <p className="heading-kicker">Workflow</p>
              <h2 className="text-xl text-white">Review Second</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Once intake is complete, open the workflow sections for review tables, editors, document links, and timeline management.
              </p>
            </article>
            <article className="surface-card p-5 space-y-2">
              <p className="heading-kicker">Output</p>
              <h2 className="text-xl text-white">Export Last</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Export controls stay available, but the platform now encourages validation before PDF, Excel, or share-link delivery.
              </p>
            </article>
          </section>

          <section className="space-y-4">
            <h2 className="heading-section">Module Pattern</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <article className="surface-card p-5 space-y-3">
                <h3 className="text-lg text-white">CRM and Deals</h3>
                <ol className="list-decimal pl-5 text-sm sm:text-base text-slate-300 space-y-2">
                  <li>Start with the company, relationship, deal stage, and next follow-up.</li>
                  <li>Use connected-item counts to jump into Surveys, Analyses, Lease Abstracts, Obligations, or Documents.</li>
                  <li>Track expirations, buildings, suites, and linked documents without leaving the CRM context.</li>
                </ol>
              </article>
              <article className="surface-card p-5 space-y-3">
                <h3 className="text-lg text-white">Surveys and Analyses</h3>
                <ol className="list-decimal pl-5 text-sm sm:text-base text-slate-300 space-y-2">
                  <li>Surveys connect market options, flyers, and floorplans back to the active relationship and deal.</li>
                  <li>Financial Analyses connect proposals and lease terms into pricing comparison and negotiation support.</li>
                  <li>Flow indicators show the path from client to survey to analysis to lease.</li>
                </ol>
              </article>
              <article className="surface-card p-5 space-y-3">
                <h3 className="text-lg text-white">Lease Abstracts, Obligations, and Documents</h3>
                <ol className="list-decimal pl-5 text-sm sm:text-base text-slate-300 space-y-2">
                  <li>Lease files feed abstracts, obligations, and the document hub together.</li>
                  <li>Expiration timelines and notice signals stay visible near the top of the module.</li>
                  <li>Document linkage panels show where each file is already being used.</li>
                </ol>
              </article>
              <article className="surface-card p-5 space-y-3">
                <h3 className="text-lg text-white">Relationship Intelligence</h3>
                <ol className="list-decimal pl-5 text-sm sm:text-base text-slate-300 space-y-2">
                  <li>Markets, submarkets, buildings, floors, suites, companies, and expirations are surfaced visually.</li>
                  <li>Next Actions and AI Suggestions turn relationship context into guided workflow steps.</li>
                  <li>The architecture stays shared while the UI makes cross-module relationships obvious.</li>
                </ol>
              </article>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Representation Mode</h2>
            <p className="text-sm sm:text-base text-slate-300">
              Tenant Rep mode emphasizes clients, deals, analyses, surveys, lease abstracts, and obligations.
              Landlord Rep mode emphasizes properties, availabilities, proposals, tours, and reporting.
            </p>
            <p className="text-sm sm:text-base text-slate-300">
              The design system, auth, document intelligence, AI orchestration, and export architecture remain shared.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">FAQ</h2>
            <div className="space-y-3">
              {FAQ_ITEMS.map((item) => (
                <article key={item.q} className="surface-card p-4 sm:p-5">
                  <h3 className="text-base sm:text-lg font-semibold text-white">{item.q}</h3>
                  <p className="mt-2 text-sm sm:text-base text-slate-300">{item.a}</p>
                </article>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
