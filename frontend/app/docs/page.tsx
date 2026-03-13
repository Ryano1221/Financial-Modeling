const FAQ_ITEMS = [
  {
    q: "Why did extraction return warnings?",
    a: "Warnings mean one or more terms were low confidence or missing in the source document. Review the scenario editor fields and confirm values before exporting.",
  },
  {
    q: "Can I upload multiple files at once?",
    a: "Yes. Drag and drop multiple PDF, DOCX, or DOC files in one action. Each file is processed into its own scenario for side-by-side comparison.",
  },
  {
    q: "Why do I see fallback values?",
    a: "When a document does not clearly contain a required term, the app keeps processing and applies safe defaults so you can continue. Update those fields before final exports.",
  },
  {
    q: "Why is my logo not showing in exports?",
    a: "Sign in first, then upload your brokerage logo in Branding settings. If no logo is saved, theCREmodel branding is used automatically.",
  },
  {
    q: "How do CRM stages fit on one screen?",
    a: "On large monitors, the CRM board expands columns to use the available width so stage lanes can be reviewed at once. On smaller screens, the board keeps horizontal scroll so cards remain readable.",
  },
  {
    q: "Where do I configure deal stages?",
    a: "Open Account dashboard, switch to Settings, then open CRM Settings for the active client. You can add, reorder, remove, and load tenant/landlord templates.",
  },
  {
    q: "What CRM settings can I control per client?",
    a: "In Account > Settings > CRM Settings you can manage stage order, toggle document-driven stage automation, and set the default Deals view (board, table, timeline, or client grouped).",
  },
  {
    q: "Where do I choose Tenant Rep vs Landlord Rep mode?",
    a: "Mode selection is required during first-time onboarding and can be changed later in Account settings. This mode changes dashboard defaults, navigation emphasis, pipeline templates, AI suggestions, and export orientation.",
  },
  {
    q: "Where should I upload files in workspace modules?",
    a: "Use the shared Document Center intake. You can upload from Document Center itself or drop files anywhere in the active workspace; both route to the same client library.",
  },
  {
    q: "Can survey entries show map pins?",
    a: "Yes. The Surveys workspace includes a location map that drops a pin for each entry with a mappable address.",
  },
];

export default function DocsPage() {
  return (
    <main className="relative z-10 section-shell">
      <div className="app-container max-w-5xl">
        <section className="section-panel p-6 sm:p-10 space-y-8">
            <div className="space-y-3">
              <p className="heading-kicker">Docs</p>
              <h1 className="heading-display !text-[clamp(2rem,5vw,3.75rem)]">Using The CRE Model</h1>
              <p className="body-lead max-w-3xl">
                The CRE Model is a client-scoped brokerage operating system that supports both Tenant Rep and
                Landlord Rep workflows on one shared architecture.
              </p>
            </div>

            <section className="space-y-3">
              <h2 className="heading-section">Brokerage OS Modules</h2>
              <ul className="space-y-2 text-sm sm:text-base text-slate-300 list-disc pl-5">
                <li>
                  <strong>CRM (Deals):</strong> Pipeline lifecycle with stages, timeline activity, tasks, linked documents, and workspace context.
                </li>
                <li>
                  <strong>Surveys:</strong> Structured survey entries, occupancy cost calculations, and client share outputs.
                </li>
                <li>
                  <strong>Financial Analyses:</strong> Lease comparison and sublease recovery workflows using client-scoped source documents.
                </li>
                <li>
                  <strong>Lease Abstract:</strong> Executed lease/amendment parsing, abstract generation, and export output.
                </li>
                <li>
                  <strong>Obligations:</strong> Lease obligation tracking, timeline visibility, and portfolio metrics.
                </li>
              </ul>
              <p className="text-sm sm:text-base text-slate-300">
                In <strong>Tenant Rep</strong> mode, emphasis is on client requirements, analyses, surveys, completed leases, and obligations.
                In <strong>Landlord Rep</strong> mode, emphasis shifts to availabilities, listing marketing, inquiry/tour/proposal pipeline, lease tracking, and reporting.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Upload and Analysis Flow</h2>
              <ol className="space-y-2 text-sm sm:text-base text-slate-300 list-decimal pl-5">
                <li>Upload one or more lease or proposal files (PDF, DOCX, or DOC).</li>
                <li>Extraction reads terms and maps them into scenario fields.</li>
                <li>Review the scenario editor and confirm or adjust values.</li>
                <li>Compare options in the matrix, charts, and scenario detail blocks.</li>
                <li>Export Excel or PDF once all scenarios are validated.</li>
              </ol>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Rent Schedule Normalization</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Rent terms from leases, LOIs, proposals, and amendments are normalized into month-based periods so every
                option can be analyzed on the same timeline. If periods overlap, are partial, or missing details, the
                app flags them for review and preserves the best available interpretation instead of blocking workflow.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">CRM Pipeline Layout</h2>
              <p className="text-sm sm:text-base text-slate-300">
                The CRM pipeline is responsive by design. Desktop layouts prioritize showing all stage columns in one
                view, while smaller displays maintain smooth horizontal scrolling to preserve deal-card readability.
              </p>
              <p className="text-sm sm:text-base text-slate-300">
                Stage definitions are configured in Account Settings under CRM Settings and then applied to the Deals module.
              </p>
              <p className="text-sm sm:text-base text-slate-300">
                Use the Account page <strong>Settings</strong> area, then open <strong>CRM Settings</strong> to edit stage order, default CRM view, and
                document-driven stage automation for the active client.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Unified Upload Flow</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Client workspaces use one upload destination: Document Center. You can upload in Document Center,
                or drop files anywhere on the active workspace screen.
                All paths ingest to the same client-scoped document library.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">AI Command Center</h2>
              <p className="text-sm sm:text-base text-slate-300">
                The Brokerage OS Command Center runs structured actions across shared entities, workflows, and documents.
                Use natural language prompts (for example, compare proposals or create workflow tasks), then review
                planned tools, execution results, and audit entries.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Survey Location Map</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Survey entries are plotted on a map using building and address fields. Click any map pin to jump to the
                corresponding survey row and edit details.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Branding Instructions</h2>
              <p className="text-sm sm:text-base text-slate-300">
                Open <strong>Branding settings</strong>, upload your brokerage logo (PNG, SVG, or JPG), and save your
                brokerage name. Saved branding is scoped to your account and is reused for future PDF exports.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="heading-section">Export Instructions</h2>
              <ul className="space-y-2 text-sm sm:text-base text-slate-300 list-disc pl-5">
                <li>
                  <strong>Excel:</strong> Exports the scenario comparison workbook with financial outputs and assumptions.
                </li>
                <li>
                  <strong>PDF:</strong> Exports the Lease Economics Comparison Deck with cover, matrix, visuals, abstracts,
                  scenario details, and disclosures.
                </li>
              </ul>
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
