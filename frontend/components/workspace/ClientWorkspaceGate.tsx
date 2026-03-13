"use client";

import { useMemo, useState } from "react";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import {
  LANDLORD_REP_MODE,
  TENANT_REP_MODE,
  representationModeLabel,
} from "@/lib/workspace/representation-mode";

function asText(value: unknown): string {
  return String(value || "").trim();
}

export function ClientWorkspaceGate() {
  const {
    ready,
    isAuthenticated,
    clients,
    activeClient,
    representationMode,
    createClient,
    setActiveClient,
    setRepresentationMode,
  } = useClientWorkspace();
  const [name, setName] = useState("");
  const [companyType, setCompanyType] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const needsMode = useMemo(
    () => ready && isAuthenticated && !representationMode,
    [ready, isAuthenticated, representationMode],
  );
  const needsClient = useMemo(
    () => ready && isAuthenticated && !activeClient,
    [ready, isAuthenticated, activeClient],
  );
  const needsSelection = needsMode || needsClient;
  if (!needsSelection) return null;

  return (
    <div className="border border-white/20 bg-slate-950/50 p-5">
      <p className="heading-kicker mb-2">Workspace Onboarding</p>
      <h2 className="heading-section mb-2">
        {needsMode ? "Choose Your Representation Mode" : "Select or Create a Client"}
      </h2>
      <p className="text-sm text-slate-300 mb-4">
        Representation mode is a core workspace setting and controls defaults across dashboards, pipelines, AI actions, and exports.
      </p>

      <div className="mb-4 border border-white/15 bg-black/25 p-3">
        <p className="text-xs text-slate-400 mb-2">Representation Mode</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            className={`border px-3 py-3 text-left ${
              representationMode === TENANT_REP_MODE
                ? "border-cyan-300 bg-cyan-500/15 text-cyan-100"
                : "border-white/20 bg-black/25 text-slate-200 hover:bg-white/5"
            }`}
            onClick={() => setRepresentationMode(TENANT_REP_MODE)}
          >
            <p className="text-sm font-medium">Tenant Rep</p>
            <p className="mt-1 text-xs text-slate-300">
              Requirement-driven deals, surveys, financial analyses, lease abstracts, and obligations.
            </p>
          </button>
          <button
            type="button"
            className={`border px-3 py-3 text-left ${
              representationMode === LANDLORD_REP_MODE
                ? "border-cyan-300 bg-cyan-500/15 text-cyan-100"
                : "border-white/20 bg-black/25 text-slate-200 hover:bg-white/5"
            }`}
            onClick={() => setRepresentationMode(LANDLORD_REP_MODE)}
          >
            <p className="text-sm font-medium">Landlord Rep</p>
            <p className="mt-1 text-xs text-slate-300">
              Listing-driven deals, availabilities, marketing workflows, lease tracking, and reporting.
            </p>
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Current selection: <span className="text-slate-200">{representationModeLabel(representationMode)}</span>
        </p>
      </div>

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
                disabled={!representationMode}
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
            disabled={!representationMode}
          />
          <input
            type="text"
            value={companyType}
            onChange={(e) => setCompanyType(e.target.value)}
            className="input-premium"
            placeholder="Company type"
            disabled={!representationMode}
          />
          <input
            type="text"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="input-premium"
            placeholder="Contact name"
            disabled={!representationMode}
          />
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className="input-premium"
            placeholder="Contact email"
            disabled={!representationMode}
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input-premium min-h-[84px] sm:col-span-2"
            placeholder="Notes"
            disabled={!representationMode}
          />
        </div>
        {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="btn-premium btn-premium-primary"
            disabled={!representationMode}
            onClick={() => {
              if (!representationMode) {
                setError("Select Tenant Rep or Landlord Rep first.");
                return;
              }
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
