import { REPRESENTATION_MODE_PROFILES } from "@/lib/workspace/representation-profile";

const profiles = [
  REPRESENTATION_MODE_PROFILES.tenant_rep,
  REPRESENTATION_MODE_PROFILES.landlord_rep,
];

export default function SecurityPage() {
  return (
    <main className="relative z-10 section-shell">
      <div className="app-container max-w-6xl">
        <section className="section-panel space-y-8 p-6 sm:p-10">
          <div className="space-y-3">
            <p className="heading-kicker">Security</p>
            <h1 className="heading-display !text-[clamp(2rem,5vw,3.75rem)]">Security Overview</h1>
            <p className="body-lead max-w-4xl">
              theCREmodel keeps one shared security model across tenant and landlord workflows. Representation mode changes product behavior, not authorization boundaries, data ownership, or storage rules.
            </p>
          </div>

          <section className="space-y-3">
            <h2 className="heading-section">Shared Security Boundary</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="surface-card p-4">
                <p className="heading-kicker">Authentication + Access</p>
                <p className="mt-2 text-sm text-slate-300">Protected actions rely on authenticated user context, server-side verification, and account-scoped access controls before workflows, exports, or storage operations run.</p>
              </div>
              <div className="surface-card p-4">
                <p className="heading-kicker">Workspace Isolation</p>
                <p className="mt-2 text-sm text-slate-300">Documents, deals, surveys, obligations, reminders, tasks, activities, and CRM state stay attached to the active client workspace so one account cannot read another account’s records.</p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Representation Mode Controls</h2>
            <p className="text-sm text-slate-300 sm:text-base">
              Representation mode is an adaptive UX layer. It changes onboarding, dashboards, default views, AI suggestions, reminders, templates, exports, and workflow emphasis while leaving the shared data model untouched.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Dashboard hierarchy updates that surface command metrics, grouped insights, and drill-down workspaces are presentation-only changes and do not alter authorization, workspace isolation, or storage boundaries.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              CRM intake building autocomplete and add-building actions still write into the same client-scoped building records, so this workflow change does not expand access or bypass existing workspace protections.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Shared CoStar Excel imports publish into a platform-wide market inventory source for building reference data only. They do not expose client documents, deals, surveys, obligations, or workspace-specific overrides, and upload access still requires authenticated user context.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Manual stacking-plan edits, floor and suite records, and optional economics still persist inside the same client-scoped CRM state and occupancy records, so lease economics remain governed by the existing workspace boundary and audit path.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Automatic stacking-plan updates are limited to current lease, amendment, abstract, and sublease uploads. Proposal, LOI, and counter documents remain non-authoritative for occupancy so speculative deal motion cannot overwrite live building stack data.
            </p>
            <div className="grid gap-3 xl:grid-cols-2">
              {profiles.map((profile) => (
                <article key={profile.mode} className="surface-card p-4">
                  <p className="heading-kicker">{profile.label}</p>
                  <p className="mt-2 text-sm text-slate-300">{profile.docs.securitySummary}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Shared Data + AI Controls</h2>
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300 sm:text-base">
              <li>The shared entity graph keeps companies, contacts, buildings, suites, leases, obligations, deals, proposals, analyses, surveys, activities, and tasks inside one governed architecture.</li>
              <li>The shared document system uses one client-scoped library for uploads, parsing, linking, and cross-module workflows.</li>
              <li>The shared AI orchestration layer interprets prompts differently by mode, but tool execution, audit logging, and workspace boundaries remain the same.</li>
              <li>The shared export pipeline applies one authorization path for PDF, spreadsheet, and share-link generation regardless of mode.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Operational Safeguards</h2>
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300 sm:text-base">
              <li>Production traffic is pinned to <strong>thecremodel.com</strong> through canonical-host controls.</li>
              <li>Lease uploads keep file-type checks, timeout handling, OCR guardrails, and user-safe error messaging in place before processing continues.</li>
              <li>Contact and proof endpoints continue to use same-origin application routes so browser-facing support flows stay aligned with the live production domain.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Auditability</h2>
            <p className="text-sm text-slate-300 sm:text-base">
              AI-triggered actions, workflow changes, reminders, tasks, exports, and linked-record updates are recorded in centralized logs so teams can review operational history and understand how a workspace changed over time.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Storage + Transmission</h2>
            <p className="text-sm text-slate-300 sm:text-base">
              Data is transmitted over HTTPS/TLS. Persisted records and files rely on managed encryption at rest, and account-scoped settings continue to use row-level isolation controls where supported.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Report a Concern</h2>
            <p className="text-sm text-slate-300 sm:text-base">
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
