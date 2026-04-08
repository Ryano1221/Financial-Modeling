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
      setSuccess("Message sent to info@thecremodel.com. We will get back to you at the email provided.");
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
            <h1 className="heading-display !text-[clamp(2rem,5vw,3.5rem)]">Contact support</h1>
            <p className="body-lead">
              Email{" "}
              <a className="brand-link underline" href="mailto:info@thecremodel.com">
                info@thecremodel.com
              </a>{" "}
              or send a message below.
            </p>
            <p className="text-sm sm:text-base text-slate-300">
              Messages sent through this form are delivered to <strong>info@thecremodel.com</strong>, and replies go back to the email address you enter here.
            </p>
            <p className="text-sm sm:text-base text-slate-300">
              For the fastest help, tell us the active client, the module you were in, and the exact action you expected to happen.
            </p>
            <p className="text-sm sm:text-base text-slate-300">
              If the issue involved a lease, amendment, sublease, or landlord consent, include the document name and whether the problem was extraction, import, or obligation mapping.
            </p>
          </div>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="surface-card brand-panel p-5">
              <p className="heading-kicker">Helpful details</p>
              <ul className="mt-3 space-y-2 text-sm text-slate-300">
                <li>Client or workspace name</li>
                <li>Module: CRM, Buildings, Financial Analyses, Surveys, Lease Abstracts, or Obligations</li>
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
