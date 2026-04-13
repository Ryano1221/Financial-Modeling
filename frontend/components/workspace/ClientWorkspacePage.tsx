"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClientLogoUploader } from "@/components/ClientLogoUploader";
import { ClientDocumentCenter } from "@/components/workspace/ClientDocumentCenter";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { LANDLORD_REP_MODE, TENANT_REP_MODE } from "@/lib/workspace/representation-mode";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function formatCreatedAt(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString();
}

const ACCEPTED_LOGO_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/svg+xml"]);

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read logo file."));
    reader.readAsDataURL(file);
  });
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
    representationMode,
    setActiveClient,
    setRepresentationMode,
    createClient,
    updateClient,
    removeClient,
  } = useClientWorkspace();

  const [query, setQuery] = useState("");
  const [createForm, setCreateForm] = useState({
    name: "",
    companyType: "",
    contactName: "",
    contactEmail: "",
    website: "",
    notes: "",
  });
  const [editForm, setEditForm] = useState({
    name: "",
    companyType: "",
    contactName: "",
    contactEmail: "",
    website: "",
    notes: "",
  });
  const [createLogoDataUrl, setCreateLogoDataUrl] = useState<string | null>(null);
  const [createLogoFileName, setCreateLogoFileName] = useState<string | null>(null);
  const [createLogoUploading, setCreateLogoUploading] = useState(false);
  const [createLogoError, setCreateLogoError] = useState<string | null>(null);
  const [clientLogoUploading, setClientLogoUploading] = useState(false);
  const [clientLogoError, setClientLogoError] = useState<string | null>(null);
  const [createError, setCreateError] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editError, setEditError] = useState("");
  const [showCreateClientForm, setShowCreateClientForm] = useState(false);

  const requestedClientId = asText(routeClientId);

  const requestedClient = useMemo(
    () => clients.find((client) => client.id === requestedClientId) ?? null,
    [clients, requestedClientId],
  );
  const currentClient = requestedClient ?? activeClient;
  const currentClientId = currentClient?.id ?? null;
  const routeClientMissing = Boolean(requestedClientId) && !requestedClient;

  useEffect(() => {
    if (!ready || !requestedClientId || !requestedClient) return;
    if (requestedClient.id !== activeClientId) {
      setActiveClient(requestedClient.id);
    }
  }, [ready, requestedClientId, requestedClient, activeClientId, setActiveClient]);

  useEffect(() => {
    if (!currentClientId) {
      setShowCreateClientForm(true);
      return;
    }
    setShowCreateClientForm(false);
  }, [currentClientId]);

  useEffect(() => {
    if (!currentClient) return;
    setEditForm({
      name: currentClient.name,
      companyType: currentClient.companyType,
      contactName: currentClient.contactName,
      contactEmail: currentClient.contactEmail,
      website: currentClient.website || "",
      notes: currentClient.notes,
    });
    setEditStatus("");
    setEditError("");
  }, [currentClient]);

  const validateLogoFile = useCallback((file: File): string | null => {
    const mime = (file.type || "").toLowerCase();
    if (!ACCEPTED_LOGO_MIME.has(mime)) return "Client logo must be PNG, SVG, or JPG.";
    if (file.size > 1_500_000) return "Client logo must be 1.5MB or smaller.";
    return null;
  }, []);

  const uploadCreateClientLogo = useCallback(async (file: File) => {
    const validationError = validateLogoFile(file);
    if (validationError) {
      setCreateLogoError(validationError);
      return;
    }
    setCreateLogoUploading(true);
    setCreateLogoError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      setCreateLogoDataUrl(dataUrl || null);
      setCreateLogoFileName(file.name || null);
    } catch (err) {
      setCreateLogoError(String((err as Error)?.message || "Unable to upload client logo."));
    } finally {
      setCreateLogoUploading(false);
    }
  }, [validateLogoFile]);

  const clearCreateClientLogo = useCallback(() => {
    setCreateLogoDataUrl(null);
    setCreateLogoFileName(null);
    setCreateLogoError(null);
  }, []);

  const uploadSelectedClientLogo = useCallback(async (file: File) => {
    if (!currentClient) return;
    const validationError = validateLogoFile(file);
    if (validationError) {
      setClientLogoError(validationError);
      return;
    }
    setClientLogoUploading(true);
    setClientLogoError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      updateClient(currentClient.id, {
        logoDataUrl: dataUrl || "",
        logoFileName: file.name || "",
      });
    } catch (err) {
      setClientLogoError(String((err as Error)?.message || "Unable to upload client logo."));
    } finally {
      setClientLogoUploading(false);
    }
  }, [currentClient, updateClient, validateLogoFile]);

  const clearSelectedClientLogo = useCallback(() => {
    if (!currentClient) return;
    updateClient(currentClient.id, { logoDataUrl: "", logoFileName: "" });
    setClientLogoError(null);
  }, [currentClient, updateClient]);

  const saveSelectedClientDetails = useCallback(() => {
    if (!currentClient) return;
    const name = asText(editForm.name);
    if (!name) {
      setEditError("Client name is required.");
      setEditStatus("");
      return;
    }
    updateClient(currentClient.id, {
      name,
      companyType: editForm.companyType,
      contactName: editForm.contactName,
      contactEmail: editForm.contactEmail,
      website: editForm.website,
      notes: editForm.notes,
    });
    setEditError("");
    setEditStatus("Client details saved.");
  }, [currentClient, editForm, updateClient]);

  const deleteSelectedClient = useCallback(() => {
    if (!currentClient) return;
    const confirmed = window.confirm(
      `Delete ${currentClient.name}? This removes the client workspace and its linked deals/documents from this account.`,
    );
    if (!confirmed) return;
    removeClient(currentClient.id);
    router.push("/client");
  }, [currentClient, removeClient, router]);

  const filteredClients = useMemo(() => {
    const needle = asText(query).toLowerCase();
    if (!needle) return clients;
    return clients.filter((client) => {
      const haystack = `${client.name} ${client.companyType} ${client.industry} ${client.contactName} ${client.contactEmail} ${client.website || ""} ${client.brokerage}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [clients, query]);

  const showingCreateClientForm = showCreateClientForm || !currentClient;

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
        <section className="mx-auto w-full max-w-[96vw] border border-white/20 bg-slate-950/70 p-6">
          <p className="heading-kicker mb-2">Client Workspace</p>
          <h1 className="heading-section mb-2">Sign in to access clients</h1>
          <p className="text-sm text-slate-300 mb-4">
            Client workspaces are available for authenticated accounts.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/sign-in" className="btn-premium btn-premium-secondary">
              Sign in
            </Link>
            <Link href="/sign-up" className="btn-premium btn-premium-primary">
              Create account
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (!representationMode) {
    return (
      <main className="relative z-10 app-container pt-24 sm:pt-28 pb-14 md:pb-20">
        <section className="mx-auto w-full max-w-[96vw] border border-white/20 bg-slate-950/70 p-6">
          <p className="heading-kicker mb-2">Client Workspace</p>
          <h1 className="heading-section mb-2">Choose Representation Mode</h1>
          <p className="text-sm text-slate-300 mb-4">
            Select your operating side before managing client workspaces.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button type="button" className="btn-premium btn-premium-secondary" onClick={() => setRepresentationMode(TENANT_REP_MODE)}>
              Tenant Rep
            </button>
            <button type="button" className="btn-premium btn-premium-secondary" onClick={() => setRepresentationMode(LANDLORD_REP_MODE)}>
              Landlord Rep
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="relative z-10 app-container pt-24 sm:pt-28 pb-14 md:pb-20 space-y-6">
      <section className="mx-auto w-full max-w-[96vw] border border-white/15 bg-black/25 p-4 sm:p-5">
        <p className="heading-kicker mb-2">Client Workspace</p>
        <h1 className="heading-section mb-2">Manage Client Workspaces</h1>
        <p className="text-sm text-slate-300">
          Select a client to open their workspace and document library.
        </p>
        <p className="mt-2 text-xs text-slate-400">{session?.user?.email || "Authenticated account"}</p>
      </section>

      <section className="mx-auto w-full max-w-[96vw] grid grid-cols-1 lg:grid-cols-12 gap-4">
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
                        </p>
                        {client.logoDataUrl ? (
                          <p className="text-[11px] text-cyan-300 mt-1">Logo configured</p>
                        ) : null}
                        <p className="text-xs text-slate-500 mt-1">
                          {client.contactName || "No contact"}
                          {client.contactEmail ? ` · ${client.contactEmail}` : ""}
                          {client.website ? ` · ${client.website}` : ""}
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
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="heading-kicker mb-2">{showingCreateClientForm ? "Create Client" : "Client Branding"}</p>
              <p className="text-sm text-slate-300">
                {showingCreateClientForm
                  ? "Set one shared client logo that carries into PDF covers and branded export output."
                  : "This client uses one shared logo across PDF covers and branded export output."}
              </p>
            </div>
            {currentClient ? (
              <button
                type="button"
                className="btn-premium btn-premium-secondary text-xs"
                onClick={() => {
                  setCreateError("");
                  setClientLogoError(null);
                  setShowCreateClientForm((prev) => !prev);
                }}
              >
                {showingCreateClientForm ? "Back To Selected Client" : "Create Another Client"}
              </button>
            ) : null}
          </div>

          {showingCreateClientForm ? (
            <>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                <input
                  type="url"
                  value={createForm.website}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, website: event.target.value }))}
                  placeholder="Website (optional)"
                  className="input-premium sm:col-span-2"
                />
                <textarea
                  value={createForm.notes}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="Notes"
                  className="input-premium min-h-[84px] sm:col-span-2"
                />
              </div>
              <div className="mt-3">
                <ClientLogoUploader
                  logoDataUrl={createLogoDataUrl}
                  fileName={createLogoFileName}
                  uploading={createLogoUploading}
                  error={createLogoError}
                  onUpload={uploadCreateClientLogo}
                  onClear={clearCreateClientLogo}
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
                      contactName: createForm.contactName,
                      contactEmail: createForm.contactEmail,
                      website: createForm.website,
                      notes: createForm.notes,
                      logoDataUrl: createLogoDataUrl || undefined,
                      logoFileName: createLogoFileName || undefined,
                    });
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
                      website: "",
                      notes: "",
                    });
                    clearCreateClientLogo();
                    setShowCreateClientForm(false);
                    router.push(`/client/${encodeURIComponent(created.id)}`);
                  }}
                >
                  Create Client
                </button>
              </div>
            </>
          ) : currentClient ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Selected Client</span>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                    className="input-premium mt-2"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Company Type</span>
                  <input
                    type="text"
                    value={editForm.companyType}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, companyType: event.target.value }))}
                    className="input-premium mt-2"
                    placeholder="Company type"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Contact</span>
                  <input
                    type="text"
                    value={editForm.contactName}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, contactName: event.target.value }))}
                    className="input-premium mt-2"
                    placeholder="Contact name"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Email</span>
                  <input
                    type="email"
                    value={editForm.contactEmail}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, contactEmail: event.target.value }))}
                    className="input-premium mt-2"
                    placeholder="Contact email"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Website</span>
                  <input
                    type="url"
                    value={editForm.website}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, website: event.target.value }))}
                    className="input-premium mt-2"
                    placeholder="Website (optional)"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Notes</span>
                  <textarea
                    value={editForm.notes}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, notes: event.target.value }))}
                    className="input-premium mt-2 min-h-[84px]"
                    placeholder="Notes"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  {editStatus ? <p className="text-xs text-cyan-200">{editStatus}</p> : null}
                  {editError ? <p className="text-xs text-red-300">{editError}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-premium btn-premium-secondary border-red-400/50 text-red-200 hover:border-red-300 hover:text-red-100"
                    onClick={deleteSelectedClient}
                  >
                    Delete Client
                  </button>
                  <button type="button" className="btn-premium btn-premium-primary" onClick={saveSelectedClientDetails}>
                    Save Client Details
                  </button>
                </div>
              </div>
              <ClientLogoUploader
                logoDataUrl={currentClient.logoDataUrl || null}
                fileName={currentClient.logoFileName || null}
                uploading={clientLogoUploading}
                error={clientLogoError}
                onUpload={uploadSelectedClientLogo}
                onClear={clearSelectedClientLogo}
              />
            </div>
          ) : null}
        </div>
      </section>

      {routeClientMissing ? (
        <section className="mx-auto w-full max-w-[96vw] border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm text-amber-100">
            The requested client workspace was not found. Select another client or create one.
          </p>
        </section>
      ) : null}

      {currentClient ? (
        <ClientDocumentCenter />
      ) : (
        <section className="mx-auto w-full max-w-[96vw] border border-white/15 bg-black/25 p-4">
          <p className="text-sm text-slate-300">
            Select an existing client or create one to open the document library.
          </p>
        </section>
      )}
    </main>
  );
}
