"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { signOut } from "@/lib/supabase";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import {
  LANDLORD_REP_MODE,
  TENANT_REP_MODE,
  representationModeLabel,
} from "@/lib/workspace/representation-mode";
import {
  LANDLORD_REP_DEAL_STAGES,
  TENANT_REP_DEAL_STAGES,
  getDefaultDealStagesForMode,
  type DealsViewMode,
} from "@/lib/workspace/types";

function asText(value: unknown): string {
  return String(value || "").trim();
}

type AccountSection = "dashboard" | "settings";
type SettingsPanel = "general" | "crm";

export default function AccountPage() {
  const router = useRouter();
  const [initialMode, setInitialMode] = useState<"signin" | "signup">("signin");
  const {
    ready,
    session,
    isAuthenticated,
    representationMode,
    clients,
    activeClientId,
    dealStages,
    crmSettings,
    setActiveClient,
    setRepresentationMode,
    setDealStages,
    setCrmSettings,
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
  const [stageDraftList, setStageDraftList] = useState<string[]>([]);
  const [newStageDraft, setNewStageDraft] = useState("");
  const [stageError, setStageError] = useState("");
  const [stageStatus, setStageStatus] = useState("");
  const [crmSettingsStatus, setCrmSettingsStatus] = useState("");
  const [activeSection, setActiveSection] = useState<AccountSection>("dashboard");
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<SettingsPanel>("general");
  const settingsRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = new URLSearchParams(window.location.search);
    const value = search.get("mode");
    const section = search.get("section");
    const settings = search.get("settings");
    const legacyTab = search.get("tab");
    setInitialMode(value === "signup" ? "signup" : "signin");
    if (section === "settings" || legacyTab === "crm") {
      setActiveSection("settings");
    } else {
      setActiveSection("dashboard");
    }
    if (settings === "crm" || legacyTab === "crm") {
      setActiveSettingsPanel("crm");
    } else {
      setActiveSettingsPanel("general");
    }
  }, []);

  useEffect(() => {
    if (activeSection !== "settings") return;
    const target = settingsRef.current;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeSection, activeSettingsPanel]);

  useEffect(() => {
    setStageDraftList([...dealStages]);
    setNewStageDraft("");
    setStageError("");
    setStageStatus("");
    setCrmSettingsStatus("");
  }, [dealStages, activeClientId]);

  const clientsByCreatedAt = useMemo(
    () =>
      [...clients].sort((a, b) => {
        const aTime = Date.parse(a.createdAt || "");
        const bTime = Date.parse(b.createdAt || "");
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      }),
    [clients],
  );
  const activeClient = useMemo(
    () => clients.find((client) => client.id === activeClientId) || null,
    [clients, activeClientId],
  );
  const defaultModeStages = useMemo(
    () => [...getDefaultDealStagesForMode(representationMode)],
    [representationMode],
  );

  function addStage() {
    const next = asText(newStageDraft);
    if (!next) {
      setStageError("Enter a stage name before adding.");
      return;
    }
    if (stageDraftList.some((item) => item.toLowerCase() === next.toLowerCase())) {
      setStageError("That stage already exists.");
      return;
    }
    setStageDraftList((prev) => [...prev, next]);
    setNewStageDraft("");
    setStageError("");
    setStageStatus("Stage added. Save stages to apply.");
  }

  function updateStageAt(index: number, value: string) {
    setStageDraftList((prev) => prev.map((stage, stageIndex) => (stageIndex === index ? value : stage)));
    setStageError("");
  }

  function moveStage(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= stageDraftList.length) return;
    setStageDraftList((prev) => {
      const copy = [...prev];
      const [entry] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, entry);
      return copy;
    });
    setStageError("");
    setStageStatus("Stage order changed. Save stages to apply.");
  }

  function removeStage(index: number) {
    setStageDraftList((prev) => prev.filter((_, stageIndex) => stageIndex !== index));
    setStageError("");
    setStageStatus("Stage removed. Save stages to apply.");
  }

  function saveStageSettings() {
    if (!activeClient) return;
    const parsed = Array.from(
      new Set(
        stageDraftList
          .map((item) => asText(item))
          .filter(Boolean),
      ),
    );
    if (parsed.length === 0) {
      setStageError("At least one stage is required.");
      return;
    }
    setDealStages(parsed, activeClient.id);
    setStageDraftList(parsed);
    setStageError("");
    setStageStatus(`Saved ${parsed.length} stage${parsed.length === 1 ? "" : "s"} for ${activeClient.name}.`);
  }

  function applyStageTemplate(stages: readonly string[], label: string) {
    setStageDraftList([...stages]);
    setStageError("");
    setStageStatus(`${label} template loaded. Save stages to apply.`);
  }

  function saveCrmToggle(checked: boolean) {
    if (!activeClient) return;
    setCrmSettings({ autoStageFromDocuments: checked }, activeClient.id);
    setCrmSettingsStatus(`Auto stage updates ${checked ? "enabled" : "disabled"} for ${activeClient.name}.`);
  }

  function saveDefaultView(nextView: DealsViewMode) {
    if (!activeClient) return;
    setCrmSettings({ defaultDealsView: nextView }, activeClient.id);
    setCrmSettingsStatus(`Default CRM view set to ${nextView.replace("_", " ")} for ${activeClient.name}.`);
  }

  function openAccountSection(section: AccountSection, settingsPanel?: SettingsPanel) {
    setActiveSection(section);
    if (settingsPanel) {
      setActiveSettingsPanel(settingsPanel);
    }
    const search = new URLSearchParams();
    if (section === "settings") {
      search.set("section", "settings");
      search.set("settings", settingsPanel || activeSettingsPanel);
    }
    router.replace(search.toString() ? `/account?${search.toString()}` : "/account", { scroll: false });
  }

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
            Go to workspace
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

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            className={`btn-premium text-center ${activeSection === "dashboard" ? "btn-premium-primary" : "btn-premium-secondary"}`}
            onClick={() => openAccountSection("dashboard")}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={`btn-premium text-center ${activeSection === "settings" ? "btn-premium-primary" : "btn-premium-secondary"}`}
            onClick={() => openAccountSection("settings", activeSettingsPanel)}
          >
            Settings
          </button>
        </div>

        {activeSection === "dashboard" ? (
        <section className="mt-6 border border-white/15 bg-black/35 p-4 sm:p-5">
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
        ) : (
        <section ref={settingsRef} className="mt-6 border border-white/15 bg-black/35 p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="heading-kicker mb-1">Settings</p>
              <h2 className="text-xl font-semibold text-white">Account settings</h2>
            </div>
            <p className="text-xs text-slate-400">Choose a settings area for this account.</p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={`btn-premium text-center ${activeSettingsPanel === "general" ? "btn-premium-primary" : "btn-premium-secondary"}`}
              onClick={() => openAccountSection("settings", "general")}
            >
              General
            </button>
            <button
              type="button"
              className={`btn-premium text-center ${activeSettingsPanel === "crm" ? "btn-premium-primary" : "btn-premium-secondary"}`}
              onClick={() => openAccountSection("settings", "crm")}
            >
              CRM settings
            </button>
          </div>

          {activeSettingsPanel === "general" ? (
            <div className="mt-5 space-y-5">
              <section className="border border-white/15 bg-black/30 p-4 sm:p-5">
                <p className="heading-kicker mb-2">Representation Mode</p>
                <p className="text-sm text-slate-300 mb-3">
                  This core account mode controls dashboard defaults, module emphasis, CRM stages, AI guidance, and exports.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRepresentationMode(TENANT_REP_MODE)}
                    className={`border px-3 py-3 text-left ${
                      representationMode === TENANT_REP_MODE
                        ? "border-cyan-300 bg-cyan-500/15 text-cyan-100"
                        : "border-white/20 bg-black/25 text-slate-200 hover:bg-white/5"
                    }`}
                  >
                    <p className="text-sm font-medium">Tenant Rep</p>
                    <p className="mt-1 text-xs text-slate-300">Client requirements, surveys, analyses, and obligation tracking.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRepresentationMode(LANDLORD_REP_MODE)}
                    className={`border px-3 py-3 text-left ${
                      representationMode === LANDLORD_REP_MODE
                        ? "border-cyan-300 bg-cyan-500/15 text-cyan-100"
                        : "border-white/20 bg-black/25 text-slate-200 hover:bg-white/5"
                    }`}
                  >
                    <p className="text-sm font-medium">Landlord Rep</p>
                    <p className="mt-1 text-xs text-slate-300">Availabilities, listing pipeline, tours, proposals, and reporting.</p>
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Current mode: <span className="text-slate-200">{representationModeLabel(representationMode)}</span>
                </p>
                {!representationMode ? (
                  <p className="mt-1 text-xs text-amber-200">Select a mode to complete onboarding and unlock mode-specific defaults.</p>
                ) : null}
              </section>

              <section className="border border-white/15 bg-black/30 p-4 sm:p-5">
                <p className="heading-kicker mb-2">More Settings</p>
                <p className="text-sm text-slate-300 mb-3">
                  Additional account setup remains available in the dedicated workspace pages while we keep CRM controls here.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link href="/client" className="btn-premium btn-premium-secondary text-center">
                    Client settings page
                  </Link>
                  <Link href="/branding" className="btn-premium btn-premium-secondary text-center">
                    Branding settings page
                  </Link>
                </div>
              </section>
            </div>
          ) : (
            <section
              id="crm-settings"
              className="mt-5 border border-cyan-300/40 bg-cyan-500/10 p-4"
            >
              <p className="heading-kicker mb-2">CRM Settings</p>
              {activeClient ? (
                <>
                  <p className="text-xs text-slate-300 mb-3">
                    Configure CRM workflow defaults for <span className="text-white">{activeClient.name}</span>.
                  </p>
                  <div className="border border-white/15 bg-black/35 p-4">
                    <p className="heading-kicker mb-2">Deal Pipeline Stages</p>
                    <p className="text-xs text-slate-300 mb-3">
                      Build your stage list in order. This controls board columns and available stage values in deals.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-premium btn-premium-secondary text-xs"
                        onClick={() => applyStageTemplate(TENANT_REP_DEAL_STAGES, "Tenant Rep")}
                      >
                        Tenant template
                      </button>
                      <button
                        type="button"
                        className="btn-premium btn-premium-secondary text-xs"
                        onClick={() => applyStageTemplate(LANDLORD_REP_DEAL_STAGES, "Landlord Rep")}
                      >
                        Landlord template
                      </button>
                      <button
                        type="button"
                        className="btn-premium btn-premium-secondary text-xs"
                        onClick={() => applyStageTemplate(defaultModeStages, "Current mode")}
                      >
                        Current mode template
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <input
                        type="text"
                        className="input-premium"
                        placeholder="Add a stage (for example: Proposal Requested)"
                        value={newStageDraft}
                        onChange={(event) => setNewStageDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          addStage();
                        }}
                      />
                      <button type="button" className="btn-premium btn-premium-secondary text-xs" onClick={addStage}>
                        Add stage
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {stageDraftList.length === 0 ? (
                        <p className="text-xs text-slate-400">No stages yet. Add at least one stage.</p>
                      ) : (
                        stageDraftList.map((stage, index) => (
                          <div key={`${index}-${stage}`} className="border border-white/15 bg-black/25 p-2">
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:items-center">
                              <p className="text-xs text-slate-400">{index + 1}</p>
                              <input
                                type="text"
                                className="input-premium"
                                value={stage}
                                onChange={(event) => updateStageAt(index, event.target.value)}
                              />
                              <div className="flex flex-wrap gap-1">
                                <button
                                  type="button"
                                  className="btn-premium btn-premium-secondary text-[11px] px-2 py-1"
                                  onClick={() => moveStage(index, -1)}
                                  disabled={index === 0}
                                >
                                  Up
                                </button>
                                <button
                                  type="button"
                                  className="btn-premium btn-premium-secondary text-[11px] px-2 py-1"
                                  onClick={() => moveStage(index, 1)}
                                  disabled={index === stageDraftList.length - 1}
                                >
                                  Down
                                </button>
                                <button
                                  type="button"
                                  className="btn-premium btn-premium-danger text-[11px] px-2 py-1"
                                  onClick={() => removeStage(index)}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  {stageError ? <p className="mt-2 text-xs text-red-300">{stageError}</p> : null}
                  {stageStatus ? <p className="mt-2 text-xs text-cyan-200">{stageStatus}</p> : null}
                  <div className="mt-3 flex justify-end">
                    <button type="button" className="btn-premium btn-premium-secondary text-xs" onClick={saveStageSettings}>
                      Save stage settings
                    </button>
                  </div>
                  <div className="mt-5 border border-white/15 bg-black/35 p-4">
                    <p className="heading-kicker mb-2">Helpful CRM Defaults</p>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <label className="block border border-white/15 bg-black/25 p-3">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">Stage automation</span>
                        <p className="mt-2 text-xs text-slate-300">
                          Auto-advance deal stages when linked documents imply progression (for example proposal, LOI, lease).
                        </p>
                        <div className="mt-3">
                          <input
                            type="checkbox"
                            checked={crmSettings.autoStageFromDocuments}
                            onChange={(event) => saveCrmToggle(event.target.checked)}
                          />
                          <span className="ml-2 text-xs text-slate-200">
                            {crmSettings.autoStageFromDocuments ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </label>
                      <label className="block border border-white/15 bg-black/25 p-3">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">Default CRM view</span>
                        <p className="mt-2 text-xs text-slate-300">
                          Choose which CRM view opens first in the Deals module for this client.
                        </p>
                        <select
                          className="input-premium mt-3"
                          value={crmSettings.defaultDealsView}
                          onChange={(event) => saveDefaultView(event.target.value as DealsViewMode)}
                        >
                          <option value="board">Board</option>
                          <option value="table">Table</option>
                          <option value="timeline">Timeline</option>
                          <option value="client_grouped">Client grouped</option>
                        </select>
                      </label>
                    </div>
                    {crmSettingsStatus ? <p className="mt-3 text-xs text-cyan-200">{crmSettingsStatus}</p> : null}
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-400">Select an active client on the dashboard to edit CRM settings.</p>
              )}
            </section>
          )}
        </section>
        )}
      </section>
    </main>
  );
}
