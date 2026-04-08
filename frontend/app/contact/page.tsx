import { REPRESENTATION_MODE_PROFILES } from "@/lib/workspace/representation-profile";

const profiles = [
  REPRESENTATION_MODE_PROFILES.tenant_rep,
  REPRESENTATION_MODE_PROFILES.landlord_rep,
];

export default function ContactPage() {
  return (
    <main className="relative z-10 section-shell">
      <div className="app-container max-w-4xl">
        <section className="section-panel p-6 sm:p-10 space-y-8">
          <div className="space-y-3">
            <p className="heading-kicker">Contact</p>
            <h1 className="heading-display !text-[clamp(2rem,5vw,3.5rem)]">Contact support</h1>
            <p className="body-lead">
              Email{" "}
              <a className="brand-link underline" href="mailto:info@thecremodel.com">
                info@thecremodel.com
              </a>{" "}
              for support.
            </p>
            <p className="text-sm sm:text-base text-slate-300">
              Include the active client, the module you were in, and the exact action you expected to happen so we can trace the issue quickly.
            </p>
            <p className="text-sm sm:text-base text-slate-300">
              If the issue was with an export, include whether it was Excel or PDF and whether it came from Financial Analyses, Surveys, or Lease Abstracts.
            </p>
            <p className="text-sm sm:text-base text-slate-300">
              If the issue involved a lease, amendment, sublease, or landlord consent, include the document name and whether the problem was extraction, import, or obligation mapping.
            </p>
            <p className="text-sm sm:text-base text-slate-300">
              If a scanned PDF spent a long time processing before failing, mention that it was image-only or non-searchable so we can trace the OCR path directly.
            </p>
          </div>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="surface-card brand-panel p-5">
              <p className="heading-kicker">Helpful details</p>
              <ul className="mt-3 space-y-2 text-sm text-slate-300">
                <li>Client or workspace name</li>
                <li>Module: CRM, Buildings, Financial Analyses, Surveys, Lease Abstracts, or Obligations</li>
                <li>Whether the issue was in the Excel export, PDF export, or on-screen review</li>
                <li>Whether the top bar showed cloud sync or LOCAL MODE</li>
                <li>How many files were in the upload batch when it failed</li>
                <li>Whether the editor was open or still in review mode</li>
                <li>What you clicked or uploaded</li>
                <li>What you expected to happen</li>
                <li>What happened instead</li>
              </ul>
            </div>
            <div className="grid gap-4">
              {profiles.map((profile) => (
                <div key={profile.mode} className="surface-card brand-panel p-5">
                  <p className="heading-kicker">{profile.label}</p>
                  <p className="mt-2 text-sm text-slate-300">{profile.docs.contactSummary}</p>
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
