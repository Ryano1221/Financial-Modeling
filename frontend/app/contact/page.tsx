"use client";

import { FormEvent, useMemo, useState } from "react";
import { fetchApiProxy } from "@/lib/api";
import { REPRESENTATION_MODE_PROFILES } from "@/lib/workspace/representation-profile";

const profiles = [
  REPRESENTATION_MODE_PROFILES.tenant_rep,
  REPRESENTATION_MODE_PROFILES.landlord_rep,
];

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value.trim());
}

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return (
      !loading &&
      name.trim().length >= 2 &&
      isValidEmail(email) &&
      message.trim().length >= 10 &&
      message.trim().length <= 5000
    );
  }, [name, email, message, loading]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuccess(null);
    setError(null);

    if (!canSubmit) {
      setError("Please complete all fields with valid values.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetchApiProxy("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const detail =
          payload && typeof payload === "object" && "detail" in payload
            ? String((payload as { detail: unknown }).detail || "").trim()
            : "";
        throw new Error(detail || "We couldn't submit your message right now. Please try again.");
      }
      setSuccess("Message sent. We will get back to you at the email provided.");
      setName("");
      setEmail("");
      setMessage("");
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err ?? "");
      setError(text || "Unable to send message.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative z-10 section-shell">
      <div className="app-container max-w-4xl">
        <section className="section-panel p-6 sm:p-10 space-y-8">
            <div className="space-y-3">
              <p className="heading-kicker">Contact</p>
              <h1 className="heading-display !text-[clamp(2rem,5vw,3.5rem)]">Contact Support</h1>
              <p className="body-lead">
                Email support directly at{" "}
                <a className="brand-link underline" href="mailto:info@thecremodel.com">
                  info@thecremodel.com
                </a>{" "}
                or send a message below.
              </p>
              <p className="text-sm sm:text-base text-slate-300">
                For the fastest help, include your representation mode, active client workspace, current module, and the workflow you were trying to complete.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <div className="brand-badge">Support routed through thecremodel.com</div>
                <div className="brand-badge">Mode-aware troubleshooting</div>
                <div className="brand-badge">Docs and security in sync</div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {profiles.map((profile) => (
                  <div key={profile.mode} className="surface-card brand-panel p-4">
                    <p className="heading-kicker">{profile.label}</p>
                    <p className="mt-2 text-sm text-slate-300">{profile.docs.contactSummary}</p>
                  </div>
                ))}
              </div>
              <div className="surface-card brand-panel space-y-2 p-4">
                <p className="heading-kicker">Include These Details</p>
                <p className="text-sm text-slate-300">1. Your screen size, browser, and whether the issue happened on desktop or mobile.</p>
                <p className="text-sm text-slate-300">2. The active module, workspace, and record involved, such as company, deal, building, floor, or suite.</p>
                <p className="text-sm text-slate-300">3. If it is a dashboard issue, note whether it happened in the command metrics strip, the insights section, or the drill-down workspace.</p>
                <p className="text-sm text-slate-300">4. Any AI prompt, export action, reminder trigger, or workflow step that led to the issue.</p>
                <p className="text-sm text-slate-300">5. For upload issues, note the file type, whether extraction completed, and whether the document was saved without extraction.</p>
                <p className="text-sm text-slate-300">6. For Austin inventory or map issues, include the building name or address and whether the issue was in the map, stacking plan, inventory list, or detail panel.</p>
                <p className="text-sm text-slate-300">7. For Buildings tab issues, include the filters in use, the selected building, whether you were trying to add it to Surveys or another module, and whether the right-side result list stayed in sync with the map.</p>
                <p className="text-sm text-slate-300">8. If the issue involved suite selection, include the building, floor filter, suite status filter, selected suites, and whether the suites were added to Surveys correctly.</p>
                <p className="text-sm text-slate-300">9. If the issue involved map drag-selection, include whether selection mode was on, how many buildings were expected, and whether the selection-only view matched the map box.</p>
                <p className="text-sm text-slate-300">10. For shared CoStar import issues, include the workbook filename, whether the upload completed, and which building rows did or did not appear afterward.</p>
                <p className="text-sm text-slate-300">11. For CRM intake issues, mention the building text you typed, whether an autofill suggestion appeared, and whether you were trying to add a new building.</p>
                <p className="text-sm text-slate-300">12. For stacking-plan or Financial Analyses handoff issues, include the building, floor, suite, whether the row came from a current lease or sublease upload or a manual edit, and whether the selected suites opened correctly in Financial Analyses.</p>
                <p className="text-sm text-slate-300">13. For extraction or financial-analysis mismatches, include the metric that looked wrong, whether the document referenced the existing lease structure, and the page or clause where that carry-forward term appeared.</p>
                <p className="text-sm text-slate-300">14. For shortlist or tour workflow issues, include the deal, building, floor, suite, the action you took in Buildings or CRM, and whether the shortlist entry or tour status updated where you expected.</p>
                <p className="text-sm text-slate-300">15. If the issue was in the new CRM shortlist or tour boards, include the column you expected the item to appear in and whether moving it changed the linked deal stage correctly.</p>
                <p className="text-sm text-slate-300">16. If the issue involved the new board filters, include the building filter, broker filter, date filter, and which cards should have remained visible.</p>
                <p className="text-sm text-slate-300">17. If the issue was in a deal room tab, include the deal name, which tab you were in, and whether the problem was in Overview, Company, Updates, Listings, Tours, Negotiation, User Management, or Client View.</p>
                <p className="text-sm text-slate-300">18. For deal-room summary issues, include the projected close date, current-location fields, move reason, or deal source you expected to see saved.</p>
                <p className="text-sm text-slate-300">19. For negotiation tracker issues, include the negotiation line label, status, target value, latest value, and whether the update disappeared after refresh.</p>
                <p className="text-sm text-slate-300">20. For deal-room access or client-view issues, include which internal or client member was affected, whether Client Access was on, and whether the curated client summary looked right.</p>
                <p className="text-sm text-slate-300">21. If the issue involved AI tour briefs or AI proposal-request actions, include the exact card you used, the prompt or button clicked, and the response you expected to see.</p>
                <p className="text-sm text-slate-300">22. If a follow-up task created from a tour card looked wrong, include the task title, expected due date, and the tour record it should have come from.</p>
                <p className="text-sm text-slate-300">23. If drag-and-drop on the shortlist or tour boards did not work, include which card you dragged, the origin column, the target column, and whether the status changed after drop.</p>
                <p className="text-sm text-slate-300">24. If a saved board view loaded the wrong slice, include the deal, saved view name, expected building or broker filter, and the date window you expected.</p>
                <p className="text-sm text-slate-300">25. If a post-tour recap draft looked off, include the completed tour card, attendees, notes, and the specific subject or body text you expected the AI draft to reflect.</p>
                <p className="text-sm text-slate-300">26. If shortlist owner or tour assignee updates did not stick, include the card, the expected owner or assignee, and whether the change disappeared after refresh or deal switch.</p>
                <p className="text-sm text-slate-300">27. If a team-wide saved board view showed the wrong cards, include whether it was saved as deal-only or team-wide, the active deal, and the exact building, people, and date filters expected.</p>
                <p className="text-sm text-slate-300">28. If Send to Client or Log to Deal Activity on a recap draft misbehaved, include the deal, tour card, client email on file, and whether the issue happened before or after the AI draft was generated.</p>
                <p className="text-sm text-slate-300">29. If team-wide view permissions looked wrong, include your signed-in email, expected role, expected team, and whether the view should have been editable or read-only.</p>
                <p className="text-sm text-slate-300">30. If bulk reassignment changed the wrong cards, include how many shortlist or tour cards were selected, the owner or assignee applied, and whether the visible filter slice matched the selected set.</p>
                <p className="text-sm text-slate-300">31. If backend recap sending failed, include the client email on file, whether you were signed in, and whether the AI draft generated correctly before the send action was attempted.</p>
              </div>
            </div>

            <form onSubmit={onSubmit} className="surface-card p-4 sm:p-6 space-y-4">
              <label className="block">
                <span className="text-xs sm:text-sm text-slate-300">Name</span>
                <input
                  className="input-premium mt-1"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  maxLength={120}
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs sm:text-sm text-slate-300">Email</span>
                <input
                  className="input-premium mt-1"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  maxLength={320}
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs sm:text-sm text-slate-300">Message</span>
                <textarea
                  className="textarea-premium mt-1 min-h-[160px]"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="How can we help?"
                  maxLength={5000}
                  required
                />
              </label>

              <button type="submit" className="btn-premium btn-premium-secondary" disabled={!canSubmit}>
                {loading ? "Sending..." : "Send message"}
              </button>

              {success ? <p className="text-sm text-emerald-300">{success}</p> : null}
              {error ? <p className="text-sm text-red-300">{error}</p> : null}
            </form>
        </section>
      </div>
    </main>
  );
}
