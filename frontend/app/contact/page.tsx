import type { Metadata } from "next";
import { REPRESENTATION_MODE_PROFILES } from "@/lib/workspace/representation-profile";

export const metadata: Metadata = {
  title: "Contact The CRE Model",
  description:
    "Contact The CRE Model for support with commercial real estate CRM workflows, lease analysis, document intake, marketing flyers, lease abstracts, obligations, branded exports, and workspace sync.",
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "Contact The CRE Model",
    description:
      "Support for The CRE Model commercial real estate CRM and lease analysis workspace.",
    url: "https://thecremodel.com/contact",
  },
};

const profiles = [
  REPRESENTATION_MODE_PROFILES.tenant_rep,
  REPRESENTATION_MODE_PROFILES.landlord_rep,
];

const SUPPORT_CHECKLIST = [
  "Workspace or client name",
  "Module or page you were using",
  "What you clicked, uploaded, or changed",
  "What you expected to happen",
  "What happened instead",
  "Whether you were signed in or had signed out manually",
  "Whether a Personal Info name, email, or password change failed",
  "Whether the footer sync state said Online, Sign in to sync, or Local",
  "Any file names, deal names, or timestamps involved",
  "Whether Open or Apply failed on a different signed-in device after the document appeared in the workspace",
  "Whether deleting a source document left a linked obligation visible in the obligation repository",
  "Whether a CRM client or prospect appeared in the CRM selector, account settings, linked pipeline deal, and expected pipeline stage",
  "Whether the issue affected documents, analyses, CRM, marketing flyers, abstracts, or obligations",
  "Whether Marketing generated the right lease or sublease wording for tenant rep or landlord rep mode",
  "Whether Marketing missed a visible term, suite photo, or floorplan from an uploaded flyer",
  "Whether saved Marketing settings loaded the expected style, colors, broker info, and floorplan preference",
  "Whether a marketing PDF downloaded, shared, or saved to the client workspace correctly",
  "For obligation imports, whether the missing item was an expiration, notice deadline, renewal option, termination right, or saved document Apply result",
  "Whether the problem appeared in Excel export, PDF export, or both",
  "Whether the shared client logo or branding asset appeared incorrectly",
] as const;

export default function ContactPage() {
  return (
    <main className="marketing-page-shell">
      <div className="app-container">
        <section className="marketing-page-panel mx-auto max-w-[1100px] space-y-8">
          <div className="space-y-4">
            <p className="heading-kicker">Contact</p>
            <h1 className="heading-display !text-[clamp(2.4rem,5vw,4.5rem)]">Support for the connected workspace.</h1>
            <p className="body-lead max-w-4xl text-[var(--muted)]">
              Email <a className="brand-link underline" href="mailto:info@thecremodel.com">info@thecremodel.com</a> for support with thecremodel.com, including document intake, account cloud sync, deal flow, branded exports, and workspace access from another device.
            </p>
          </div>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <article className="marketing-card">
              <p className="heading-kicker">Helpful Details</p>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-[var(--muted)]">
                {SUPPORT_CHECKLIST.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <div className="grid gap-4">
              {profiles.map((profile) => (
                <article key={profile.mode} className="marketing-card">
                  <p className="heading-kicker">{profile.label}</p>
                  <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{profile.docs.contactSummary}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <article className="marketing-card">
              <p className="heading-kicker">Account And Access</p>
              <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                If sign-in fails, a device signs out before 30 days, or a workspace does not appear on another device, tell us whether you used a password or an emailed sign-in link, which device you were on, and whether the footer changed to Online after login.
              </p>
            </article>
            <article className="marketing-card">
              <p className="heading-kicker">CRM, Exports, And Security</p>
              <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                For CRM pipeline regressions, prospect stage movement, client selector issues, obligation timeline dates, export regressions, marketing flyer generation, or security concerns, use the same inbox and clearly mark whether the issue affected a newly created client or prospect, flyer output, lease abstract output, the shared client logo, or account security so it can be prioritized with the right internal context.
              </p>
            </article>
          </section>
        </section>
      </div>
    </main>
  );
}
