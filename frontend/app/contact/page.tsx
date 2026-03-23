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
                <a className="underline decoration-white/40 hover:decoration-white" href="mailto:info@thecremodel.com">
                  info@thecremodel.com
                </a>{" "}
                or send a message below.
              </p>
              <p className="text-sm sm:text-base text-slate-300">
                For the fastest help, include your representation mode, active client workspace, current module, and the workflow you were trying to complete.
              </p>
              <div className="grid gap-3 lg:grid-cols-2">
                {profiles.map((profile) => (
                  <div key={profile.mode} className="surface-card p-4">
                    <p className="heading-kicker">{profile.label}</p>
                    <p className="mt-2 text-sm text-slate-300">{profile.docs.contactSummary}</p>
                  </div>
                ))}
              </div>
              <div className="surface-card space-y-2 p-4">
                <p className="heading-kicker">Include These Details</p>
                <p className="text-sm text-slate-300">1. Your screen size, browser, and whether the issue happened on desktop or mobile.</p>
                <p className="text-sm text-slate-300">2. The active module, workspace, and record involved, such as company, deal, building, floor, or suite.</p>
                <p className="text-sm text-slate-300">3. If it is a dashboard issue, note whether it happened in the command metrics strip, the insights section, or the drill-down workspace.</p>
                <p className="text-sm text-slate-300">4. Any AI prompt, export action, reminder trigger, or workflow step that led to the issue.</p>
                <p className="text-sm text-slate-300">5. For upload issues, note the file type, whether extraction completed, and whether the document was saved without extraction.</p>
                <p className="text-sm text-slate-300">6. For Austin inventory or map issues, include the building name or address and whether the issue was in the map, stacking plan, inventory list, or detail panel.</p>
                <p className="text-sm text-slate-300">7. For shared CoStar import issues, include the workbook filename, whether the upload completed, and which building rows did or did not appear afterward.</p>
                <p className="text-sm text-slate-300">8. For CRM intake issues, mention the building text you typed, whether an autofill suggestion appeared, and whether you were trying to add a new building.</p>
                <p className="text-sm text-slate-300">9. For stacking-plan issues, include the building, floor, suite, whether the row came from a current lease or sublease upload or a manual edit, and which economics such as rate, OpEx, abatement, TI allowance, concessions, or size were affected.</p>
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
