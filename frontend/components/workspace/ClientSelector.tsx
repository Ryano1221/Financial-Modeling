"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";

function asText(value: unknown): string {
  return String(value || "").trim();
}

export function ClientSelector() {
  const {
    isAuthenticated,
    clients,
    activeClient,
    activeClientId,
    setActiveClient,
    createClient,
  } = useClientWorkspace();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [createForm, setCreateForm] = useState({
    name: "",
    companyType: "",
    contactName: "",
    contactEmail: "",
    notes: "",
  });
  const [createError, setCreateError] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
        setShowCreate(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = asText(query).toLowerCase();
    if (!needle) return clients;
    return clients.filter((client) => {
      const haystack = `${client.name} ${client.companyType} ${client.industry} ${client.contactName} ${client.contactEmail} ${client.brokerage}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [clients, query]);

  if (!isAuthenticated) return null;

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`btn-premium text-xs sm:text-sm ${activeClient ? "btn-premium-secondary" : "btn-premium-primary"}`}
      >
        {activeClient ? `Client: ${activeClient.name}` : "Select Client"}
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-[min(92vw,30rem)] border border-white/20 bg-black/95 p-4 shadow-2xl backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="heading-kicker">Client Workspace</p>
            <button
              type="button"
              className="btn-premium btn-premium-secondary text-xs"
              onClick={() => setShowCreate((prev) => !prev)}
            >
              {showCreate ? "Hide Create" : "Create New"}
            </button>
          </div>

          <div className="mt-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clients"
              className="input-premium w-full"
            />
          </div>

          <div className="mt-3 max-h-52 overflow-y-auto border border-white/15 bg-black/30 p-2">
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-400 px-1 py-2">No matching clients.</p>
            ) : (
              filtered.map((client) => {
                const selected = client.id === activeClientId;
                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => {
                      setActiveClient(client.id);
                      setOpen(false);
                      setShowCreate(false);
                    }}
                    className={`w-full text-left border px-3 py-2 transition-colors ${
                      selected
                        ? "border-cyan-300 bg-cyan-500/20 text-cyan-100"
                        : "border-white/20 text-slate-200 hover:bg-white/5"
                    }`}
                  >
                    <p className="text-sm">{client.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {client.companyType || "Company"}
                    </p>
                  </button>
                );
              })
            )}
          </div>

          {showCreate ? (
            <div className="mt-3 border border-white/15 bg-black/25 p-3">
              <p className="heading-kicker mb-2">Create Client</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Client name*"
                  className="input-premium"
                />
                <input
                  type="text"
                  value={createForm.companyType}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, companyType: e.target.value }))}
                  placeholder="Company type"
                  className="input-premium"
                />
                <input
                  type="text"
                  value={createForm.contactName}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, contactName: e.target.value }))}
                  placeholder="Contact name"
                  className="input-premium"
                />
                <input
                  type="email"
                  value={createForm.contactEmail}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, contactEmail: e.target.value }))}
                  placeholder="Contact email"
                  className="input-premium"
                />
                <textarea
                  value={createForm.notes}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Notes"
                  className="input-premium sm:col-span-2 min-h-[84px]"
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
                      contactName: "",
                      contactEmail: "",
                      notes: "",
                    });
                    setOpen(false);
                    setShowCreate(false);
                  }}
                >
                  Create Client
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
