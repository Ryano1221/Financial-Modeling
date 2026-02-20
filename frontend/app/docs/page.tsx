const FAQ_ITEMS = [
  {
    q: "Why did extraction return warnings?",
    a: "Warnings mean one or more terms were low confidence or missing in the source document. Review the scenario editor fields and confirm values before exporting.",
  },
  {
    q: "Can I upload multiple files at once?",
    a: "Yes. Drag and drop multiple PDF or DOCX files in one action. Each file is processed into its own scenario for side-by-side comparison.",
  },
  {
    q: "Why do I see fallback values?",
    a: "When a document does not clearly contain a required term, the app keeps processing and applies safe defaults so you can continue. Update those fields before final exports.",
  },
  {
    q: "Why is my logo not showing in exports?",
    a: "Sign in first, then upload your brokerage logo in Branding settings. If no logo is saved, theCREmodel branding is used automatically.",
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
                The CRE Model converts lease documents into structured scenarios, compares economics across options,
                and exports client-ready Excel and PDF deliverables.
              </p>
            </div>

            <section className="space-y-3">
              <h2 className="heading-section">Upload and Analysis Flow</h2>
              <ol className="space-y-2 text-sm sm:text-base text-slate-300 list-decimal pl-5">
                <li>Upload one or more lease or proposal files (PDF or DOCX).</li>
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
