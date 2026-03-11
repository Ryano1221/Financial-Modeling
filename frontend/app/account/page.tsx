"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { signOut } from "@/lib/supabase";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";

function asText(value: unknown): string {
  return String(value || "").trim();
}

export default function AccountPage() {
  const router = useRouter();
  const [initialMode, setInitialMode] = useState<"signin" | "signup">("signin");
  const {
    ready,
    session,
    isAuthenticated,
    clients,
    activeClientId,
    setActiveClient,
    createClient,
    getDocumentsForClient,
  } = useClientWorkspace();
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState({
    name: "",
    companyType: "",
    industry: "",
    contactName: "",
    contactEmail: "",
    notes: "",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const value = new URLSearchParams(window.location.search).get("mode");
    setInitialMode(value === "signup" ? "signup" : "signin");
  }, []);

  const clientsByCreatedAt = useMemo(
    () =>
      [...clients].sort((a, b) => {
        const aTime = Date.parse(a.createdAt || "");
        const bTime = Date.parse(b.createdAt || "");
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      }),
    [clients],
  );

  if (!ready) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <p className="text-sm text-slate-300">Loading account…</p>
      </main>
    );
  }

  if (!isAuthenticated || !session) {
    return (
      <AuthPanel
        initialMode={initialMode}
        onAuthed={() => {
          router.push("/");
        }}
      />
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-4 pb-20 pt-24">
      <section className="mx-auto w-full max-w-6xl border border-white/15 bg-slate-950/70 p-6 sm:p-8">
        <p className="heading-kicker mb-2">Account</p>
        <h1 className="heading-section">Account Dashboard</h1>
        <p className="mt-2 text-sm text-slate-300">{session.user.email || "Authenticated user"}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/" className="btn-premium btn-premium-secondary text-center">
            Go to dashboard
          </Link>
          <Link href="/client" className="btn-premium btn-premium-secondary text-center">
            Client settings
          </Link>
          <Link href="/branding" className="btn-premium btn-premium-secondary text-center">
            Branding settings
          </Link>
          <button
            type="button"
            className="btn-premium btn-premium-secondary"
            onClick={() =>
              void signOut().then(() => {
                router.push("/account");
              })
            }
          >
            Sign out
          </button>
        </div>

        <section className="mt-8 border border-white/15 bg-black/35 p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="heading-kicker mb-1">Client Workspace</p>
              <h2 className="text-xl font-semibold text-white">Clients in your account</h2>
            </div>
            <p className="text-sm text-slate-300">
              {clients.length} client{clients.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3">
            {clientsByCreatedAt.length === 0 ? (
              <p className="text-sm text-slate-400">No clients yet. Create one below.</p>
            ) : (
              clientsByCreatedAt.map((client) => {
                const selected = client.id === activeClientId;
                const docCount = getDocumentsForClient(client.id).length;
                return (
                  <div
                    key={client.id}
                    className={`border px-4 py-3 ${
                      selected ? "border-cyan-300/80 bg-cyan-500/10" : "border-white/20 bg-black/25"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-medium text-white">{client.name}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {client.companyType || "Client"}{client.industry ? ` • ${client.industry}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {docCount} linked document{docCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={`btn-premium text-xs ${selected ? "btn-premium-primary" : "btn-premium-secondary"}`}
                          onClick={() => setActiveClient(client.id)}
                        >
                          {selected ? "Active client" : "Set active"}
                        </button>
                        <Link href={`/client/${client.id}`} className="btn-premium btn-premium-secondary text-xs">
                          Open client
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-5 border border-white/15 bg-black/30 p-4">
            <p className="heading-kicker mb-2">Add Client</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                className="input-premium"
                placeholder="Client name*"
                value={createForm.name}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
              />
              <input
                type="text"
                className="input-premium"
                placeholder="Company type"
                value={createForm.companyType}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, companyType: event.target.value }))}
              />
              <input
                type="text"
                className="input-premium"
                placeholder="Industry"
                value={createForm.industry}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, industry: event.target.value }))}
              />
              <input
                type="text"
                className="input-premium"
                placeholder="Contact name"
                value={createForm.contactName}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, contactName: event.target.value }))}
              />
              <input
                type="email"
                className="input-premium"
                placeholder="Contact email"
                value={createForm.contactEmail}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, contactEmail: event.target.value }))}
              />
              <textarea
                className="input-premium min-h-[84px] sm:col-span-2"
                placeholder="Notes"
                value={createForm.notes}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </div>
            {createError ? <p className="mt-2 text-xs text-red-300">{createError}</p> : null}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="btn-premium btn-premium-primary text-xs"
                onClick={() => {
                  if (!asText(createForm.name)) {
                    setCreateError("Client name is required.");
                    return;
                  }
                  const created = createClient(createForm);
                  if (!created) {
                    setCreateError("Unable to create client.");
                    return;
                  }
                  setCreateError("");
                  setCreateForm({
                    name: "",
                    companyType: "",
                    industry: "",
                    contactName: "",
                    contactEmail: "",
                    notes: "",
                  });
                }}
              >
                Create client
              </button>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
