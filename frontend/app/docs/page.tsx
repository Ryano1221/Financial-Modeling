const FAQ_ITEMS = [
  {
    q: "Where should I start in each module?",
    a: "Every major workspace now leads with one primary action first. Upload or select documents in analysis, survey, lease abstract, and obligations pages. Create the opportunity first in CRM.",
  },
  {
    q: "Do uploads still go to the same client library?",
    a: "Yes. Files dropped on a module page still save into the active client document library and then feed that module's workflow automatically.",
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
              The CRE Model is structured around guided workflows. Each workspace surfaces one primary action first,
              then reveals deeper controls only when you need them.
            </p>
          </div>

          <section className="grid gap-4 lg:grid-cols-3">
            <article className="surface-card p-5 space-y-2">
              <p className="heading-kicker">Primary Action</p>
              <h2 className="text-xl text-white">Start Here</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Analysis, Surveys, Lease Abstracts, and Obligations begin with document intake. CRM begins with deal creation.
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
                <h3 className="text-lg text-white">Financial Analyses</h3>
                <ol className="list-decimal pl-5 text-sm sm:text-base text-slate-300 space-y-2">
                  <li>Upload or select lease / proposal documents.</li>
                  <li>Review extracted terms and scenarios.</li>
                  <li>Run analysis and export only after validation.</li>
                </ol>
              </article>
              <article className="surface-card p-5 space-y-3">
                <h3 className="text-lg text-white">Surveys</h3>
                <ol className="list-decimal pl-5 text-sm sm:text-base text-slate-300 space-y-2">
                  <li>Upload flyers, brochures, or floorplans.</li>
                  <li>Confirm extracted survey rows.</li>
                  <li>Export a clean client-ready survey.</li>
                </ol>
              </article>
              <article className="surface-card p-5 space-y-3">
                <h3 className="text-lg text-white">Lease Abstracts</h3>
                <ol className="list-decimal pl-5 text-sm sm:text-base text-slate-300 space-y-2">
                  <li>Upload the executed lease or amendment stack.</li>
                  <li>Confirm controlling terms and overrides.</li>
                  <li>Export the abstract package.</li>
                </ol>
              </article>
              <article className="surface-card p-5 space-y-3">
                <h3 className="text-lg text-white">Obligations and CRM</h3>
                <ol className="list-decimal pl-5 text-sm sm:text-base text-slate-300 space-y-2">
                  <li>Create the deal or ingest the next obligation document.</li>
                  <li>Review risk, stage, and next steps.</li>
                  <li>Open detailed editors only when necessary.</li>
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
