"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientDocumentCenter } from "@/components/workspace/ClientDocumentCenter";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function formatCreatedAt(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString();
}

interface ClientWorkspacePageProps {
  routeClientId?: string | null;
}

export function ClientWorkspacePage({ routeClientId = null }: ClientWorkspacePageProps) {
  const router = useRouter();
  const {
    ready,
    session,
    isAuthenticated,
    clients,
    activeClient,
    activeClientId,
    setActiveClient,
    createClient,
  } = useClientWorkspace();

  const [query, setQuery] = useState("");
  const [createForm, setCreateForm] = useState({
    name: "",
    companyType: "",
    industry: "",
    contactName: "",
    contactEmail: "",
    brokerage: "",
    notes: "",
  });
  const [createError, setCreateError] = useState("");

  const requestedClientId = asText(routeClientId);

  const requestedClient = useMemo(
    () => clients.find((client) => client.id === requestedClientId) ?? null,
    [clients, requestedClientId],
  );

  useEffect(() => {
    if (!ready || !requestedClientId || !requestedClient) return;
    if (requestedClient.id !== activeClientId) {
      setActiveClient(requestedClient.id);
    }
  }, [ready, requestedClientId, requestedClient, activeClientId, setActiveClient]);

  const filteredClients = useMemo(() => {
    const needle = asText(query).toLowerCase();
    if (!needle) return clients;
    return clients.filter((client) => {
      const haystack = `${client.name} ${client.companyType} ${client.industry} ${client.contactName} ${client.contactEmail} ${client.brokerage}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [clients, query]);

  const currentClient = requestedClient ?? activeClient;
  const routeClientMissing = Boolean(requestedClientId) && !requestedClient;

  if (!ready) {
    return (
      <main className="relative z-10 app-container pt-24 sm:pt-28 pb-14 md:pb-20">
        <p className="text-sm text-slate-300">Loading client workspace...</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="relative z-10 app-container pt-24 sm:pt-28 pb-14 md:pb-20">
        <section className="mx-auto w-full max-w-3xl border border-white/20 bg-slate-950/70 p-6">
          <p className="heading-kicker mb-2">Client Workspace</p>
          <h1 className="heading-section mb-2">Sign in to access clients</h1>
          <p className="text-sm text-slate-300 mb-4">
            Client workspaces are available for authenticated accounts.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/account?mode=signin" className="btn-premium btn-premium-secondary">
              Sign in
            </Link>
            <Link href="/account?mode=signup" className="btn-premium btn-premium-primary">
              Create account
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="relative z-10 app-container pt-24 sm:pt-28 pb-14 md:pb-20 space-y-6">
      <section className="mx-auto w-full max-w-6xl border border-white/15 bg-black/25 p-4 sm:p-5">
        <p className="heading-kicker mb-2">Client Workspace</p>
        <h1 className="heading-section mb-2">Manage Client Workspaces</h1>
        <p className="text-sm text-slate-300">
          Select a client to open their workspace and document library.
        </p>
        <p className="mt-2 text-xs text-slate-400">{session?.user?.email || "Authenticated account"}</p>
      </section>

      <section className="mx-auto w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 border border-white/15 bg-black/25 p-4 sm:p-5">
          <div className="flex items-end justify-between gap-3">
            <p className="heading-kicker">Existing Clients</p>
            <p className="text-xs text-slate-400">{clients.length} total</p>
          </div>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="input-premium mt-3"
            placeholder="Search clients"
          />
          <div className="mt-3 max-h-80 overflow-y-auto border border-white/15 bg-black/20 p-2 space-y-2">
            {filteredClients.length === 0 ? (
              <p className="px-2 py-3 text-sm text-slate-400">No matching clients.</p>
            ) : (
              filteredClients.map((client) => {
                const selected = currentClient?.id === client.id;
                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => {
                      setActiveClient(client.id);
                      router.push(`/client/${encodeURIComponent(client.id)}`);
                    }}
                    className={`w-full border px-3 py-3 text-left transition-colors ${
                      selected
                        ? "border-cyan-300 bg-cyan-500/20 text-cyan-100"
                        : "border-white/20 bg-black/25 text-slate-200 hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm">{client.name}</p>
                        <p className="text-xs text-slate-400">
                          {client.companyType || "Company"}
                          {client.industry ? ` · ${client.industry}` : ""}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {client.contactName || "No contact"}
                          {client.contactEmail ? ` · ${client.contactEmail}` : ""}
                        </p>
                      </div>
                      <p className="text-[11px] text-slate-500 shrink-0">
                        {formatCreatedAt(client.createdAt)}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-5 border border-white/15 bg-black/25 p-4 sm:p-5">
          <p className="heading-kicker mb-2">Create Client</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={createForm.name}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Client name*"
              className="input-premium"
            />
            <input
              type="text"
              value={createForm.companyType}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, companyType: event.target.value }))}
              placeholder="Company type"
              className="input-premium"
            />
            <input
              type="text"
              value={createForm.industry}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, industry: event.target.value }))}
              placeholder="Industry"
              className="input-premium"
            />
            <input
              type="text"
              value={createForm.brokerage}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, brokerage: event.target.value }))}
              placeholder="Brokerage"
              className="input-premium"
            />
            <input
              type="text"
              value={createForm.contactName}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, contactName: event.target.value }))}
              placeholder="Contact name"
              className="input-premium"
            />
            <input
              type="email"
              value={createForm.contactEmail}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, contactEmail: event.target.value }))}
              placeholder="Contact email"
              className="input-premium"
            />
            <textarea
              value={createForm.notes}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Notes"
              className="input-premium min-h-[84px] sm:col-span-2"
            />
          </div>
          {createError ? <p className="mt-2 text-xs text-red-300">{createError}</p> : null}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="btn-premium btn-premium-primary"
              onClick={() => {
                const name = asText(createForm.name);
                if (!name) {
                  setCreateError("Client name is required.");
                  return;
                }
                const created = createClient({
                  name,
                  companyType: createForm.companyType,
                  industry: createForm.industry,
                  contactName: createForm.contactName,
                  contactEmail: createForm.contactEmail,
                  brokerage: createForm.brokerage,
                  notes: createForm.notes,
                });
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
                  brokerage: "",
                  notes: "",
                });
                router.push(`/client/${encodeURIComponent(created.id)}`);
              }}
            >
              Create Client
            </button>
          </div>
        </div>
      </section>

      {routeClientMissing ? (
        <section className="mx-auto w-full max-w-6xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm text-amber-100">
            The requested client workspace was not found. Select another client or create one.
          </p>
        </section>
      ) : null}

      {currentClient ? (
        <ClientDocumentCenter />
      ) : (
        <section className="mx-auto w-full max-w-6xl border border-white/15 bg-black/25 p-4">
          <p className="text-sm text-slate-300">
            Select an existing client or create one to open the document library.
          </p>
        </section>
      )}
    </main>
  );
}
