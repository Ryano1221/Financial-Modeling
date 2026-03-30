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
            <div className="flex flex-wrap gap-3 pt-2">
              <div className="brand-badge">Shared authorization boundary</div>
              <div className="brand-badge">Client-scoped workspace isolation</div>
              <div className="brand-badge">Canonical production host</div>
            </div>
          </div>

          <section className="space-y-3">
            <h2 className="heading-section">Shared Security Boundary</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="surface-card brand-panel p-4">
                <p className="heading-kicker">Authentication + Access</p>
                <p className="mt-2 text-sm text-slate-300">Protected actions rely on authenticated user context, server-side verification, and account-scoped access controls before workflows, exports, or storage operations run.</p>
              </div>
              <div className="surface-card brand-panel p-4">
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
              The dedicated Buildings module reads shared market inventory for common building reference data, while focused-building context, stack-plan edits, suite records, and downstream workflow handoffs remain client-scoped.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Intentional document and building deletions now persist as client-scoped workspace tombstones, which prevents stale local or cloud snapshots from resurrecting records a user explicitly removed.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Suite-level selection inside Buildings can create survey rows from the active client workspace only. Those handoffs do not publish private suite economics globally and continue to inherit the same client-scoped survey storage boundary.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Financial Analysis handoff from Buildings uses the same client-scoped pending-scenario storage path as the existing analysis module, so selected suites are staged for the active workspace only and do not leak into other clients or users.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Shortlist and tour workflow records created from Buildings persist in the same client-scoped CRM workspace state as deal notes, stack edits, and reminders, so those actions stay isolated to the active client and remain covered by the existing audit path.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              The new deal-room layer stores overview metadata, current-location constraints, negotiation trackers, and client-portal settings inside the same client-scoped deal record. It does not create a second transaction store or broaden cross-client visibility.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              The dedicated CRM shortlist and tour boards are presentation and workflow-management layers over those same client-scoped records. They do not introduce a new storage boundary or a separate cross-client dataset.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Inline board edits for attendees, tour notes, and follow-up actions still write into the same client-scoped CRM workflow records, and AI tour-brief or proposal-request actions only read from the active workspace context before logging their result.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Drag-and-drop status movement on shortlist and tour boards is only a UI interaction for changing the same client-scoped workflow status fields. It does not create a separate workflow store or bypass existing deal audit history.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Inline shortlist owners and tour assignees persist inside the same client-scoped CRM workflow records as the rest of the board state, so responsibility can be updated without creating a second assignment system or expanding access boundaries.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Saved board views can now be stored either for the active deal or as team-wide client views. Team-wide views still only persist reusable filters for the current client workspace and do not publish private CRM slices across clients or accounts.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Team-wide board views are now role-aware. Users without a sharing-capable role can still load applicable shared views for their client team, but they cannot overwrite or delete the shared view definitions.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Client Access and Client View toggles in the deal room are presentation controls only. They determine which curated transaction summary is exposed to approved client contacts; they do not bypass authentication, change workspace ownership, or reveal internal-only notes by default.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Bulk reassignment on shortlist and tour cards updates the same underlying client-scoped workflow records one time per selected card. It does not create hidden secondary queues or bypass the normal audit history.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              AI-generated post-tour recap drafts remain workspace-bound until a user explicitly sends them. The send action now goes through an authenticated backend route, and logging a recap into deal activity writes a new timeline event inside the same deal record and follows the existing audit path.
            </p>
            <p className="text-sm text-slate-300 sm:text-base">
              Automatic stacking-plan updates are limited to current lease, amendment, abstract, and sublease uploads. Proposal, LOI, and counter documents remain non-authoritative for occupancy so speculative deal motion cannot overwrite live building stack data.
            </p>
            <div className="grid gap-3 xl:grid-cols-2">
              {profiles.map((profile) => (
                <article key={profile.mode} className="surface-card brand-panel p-4">
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
              <li>Openable file payloads for supported uploads can be cached locally in the originating browser to preserve reopen behavior after refresh, while cloud sync continues to store compact document metadata rather than broadening cross-client file exposure.</li>
              <li>When a Financial Analyses document retains a local file payload but is missing a parsed snapshot, the app can re-normalize that file inside the authenticated workspace flow to restore comparison inputs without expanding the storage boundary beyond that browser and client workspace. The same scoped rule now applies whether the document entered through the extract widget or the tab-wide drag-and-drop ingestion path.</li>
              <li>Financial Analyses intake now requires validated core lease fields before a document is treated as parsed, and saved extraction snapshots are automatically repaired on reopen so stale confidence or outdated review flags do not reintroduce bad scenarios or unnecessary manual gates. The presentation-ready comparison workspace still operates inside the same authenticated client workspace rather than splitting document actions into a separate unsecured flow.</li>
              <li>The simplified CRM landing page is a presentation-layer change only. The start-here flow, compact priority queue, and expandable advanced workspace still read and write the same client-scoped CRM records, deal boards, reminders, and building intelligence data.</li>
              <li>The shared AI orchestration layer interprets prompts differently by mode, but tool execution, audit logging, and workspace boundaries remain the same.</li>
              <li>The shared export pipeline applies one authorization path for PDF, spreadsheet, and share-link generation regardless of mode.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="heading-section">Operational Safeguards</h2>
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300 sm:text-base">
              <li>Production traffic is pinned to <strong>thecremodel.com</strong> through canonical-host controls.</li>
              <li>Lease uploads keep file-type checks, timeout handling, OCR guardrails, and user-safe error messaging in place before processing continues.</li>
              <li>The Financial Analyses extractor now validates RSF, term, and rent schedule coverage before auto-adding a scenario, which reduces the chance of incomplete lease math entering downstream reports.</li>
              <li>DOCX proposal normalization now also handles option-driven Word layouts with heading-based parsing, embedded-RFP landlord response files, and bounded rent-step reconstruction, which improves extraction coverage without widening document access beyond the existing authenticated upload path.</li>
              <li>Normalization guardrails preserve explicit carry-forward economics cues, so clauses that point back to the existing lease structure can be modeled without letting speculative proposal language overwrite unrelated protected records.</li>
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
              <a className="brand-link underline" href="mailto:info@thecremodel.com">
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
