"use client";

import { useMemo, useState } from "react";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";

function asText(value: unknown): string {
  return String(value || "").trim();
}

export function ClientWorkspaceGate() {
  const { isAuthenticated, clients, activeClient, createClient, setActiveClient } = useClientWorkspace();
  const [name, setName] = useState("");
  const [companyType, setCompanyType] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const needsSelection = useMemo(() => isAuthenticated && !activeClient, [isAuthenticated, activeClient]);
  if (!needsSelection) return null;

  return (
    <div className="border border-white/20 bg-slate-950/50 p-5">
      <p className="heading-kicker mb-2">Client Workspace Required</p>
      <h2 className="heading-section mb-2">Select or Create a Client</h2>
      <p className="text-sm text-slate-300 mb-4">
        Every analysis, document, survey, lease abstract, and obligation is stored under a client workspace.
      </p>

      {clients.length > 0 ? (
        <div className="mb-4 border border-white/15 bg-black/25 p-3">
          <p className="text-xs text-slate-400 mb-2">Existing Clients</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {clients.map((client) => (
              <button
                key={client.id}
                type="button"
                className="btn-premium btn-premium-secondary text-left"
                onClick={() => setActiveClient(client.id)}
              >
                {client.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="border border-white/15 bg-black/25 p-3">
        <p className="text-xs text-slate-400 mb-2">Create New Client</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-premium"
            placeholder="Client name*"
          />
          <input
            type="text"
            value={companyType}
            onChange={(e) => setCompanyType(e.target.value)}
            className="input-premium"
            placeholder="Company type"
          />
          <input
            type="text"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="input-premium"
            placeholder="Contact name"
          />
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className="input-premium"
            placeholder="Contact email"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input-premium min-h-[84px] sm:col-span-2"
            placeholder="Notes"
          />
        </div>
        {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="btn-premium btn-premium-primary"
            onClick={() => {
              if (!asText(name)) {
                setError("Client name is required.");
                return;
              }
              const created = createClient({
                name,
                companyType,
                contactName,
                contactEmail,
                notes,
              });
              if (!created) {
                setError("Unable to create client.");
                return;
              }
              setError("");
              setName("");
              setCompanyType("");
              setContactName("");
              setContactEmail("");
              setNotes("");
            }}
          >
            Create and Open Workspace
          </button>
        </div>
      </div>
    </div>
  );
}
