"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PlatformSection } from "@/components/platform/PlatformShell";
import { MarketingFlyerPreview } from "@/components/marketing/MarketingFlyerPreview";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { ClientDocumentPicker } from "@/components/workspace/ClientDocumentPicker";
import {
  buildDefaultMarketingForm,
  canGenerateMarketingFlyer,
  countRequiredMarketingFields,
  generateMarketingCopy,
  mapCanonicalLeaseToMarketingForm,
  marketingOfferLabel,
} from "@/lib/marketing/engine";
import { extractMarketingDocument, type MarketingExtractedFields } from "@/lib/marketing/extraction";
import { buildMarketingShareLink } from "@/lib/marketing/share";
import type {
  MarketingAutoFilledFields,
  MarketingBroker,
  MarketingFlyerForm,
  MarketingFlyerSnapshot,
  MarketingGeneratedCopy,
  MarketingLayoutStyle,
  MarketingMediaAsset,
} from "@/lib/marketing/types";
import { getDisplayErrorMessage } from "@/lib/api";
import type { ClientWorkspaceDocument, DocumentNormalizeSnapshot, RepresentationMode } from "@/lib/workspace/types";
import { normalizeWorkspaceDocument } from "@/lib/workspace/ingestion";
import { toDocumentNormalizeSnapshot } from "@/lib/workspace/document-cloud-payloads";

type MarketingExportBranding = {
  brokerageName?: string;
  clientName?: string;
  preparedBy?: string;
  reportDate?: string;
  brokerageLogoDataUrl?: string | null;
  clientLogoDataUrl?: string | null;
  primaryColor?: string;
  secondaryColor?: string;
  disclaimer?: string;
};

interface MarketingWorkspaceProps {
  clientId: string;
  clientName?: string | null;
  representationMode?: RepresentationMode | null;
  pendingDocumentImport?: ClientWorkspaceDocument | null;
  onPendingDocumentImportHandled?: () => void;
  exportBranding?: MarketingExportBranding;
}

const ACCEPTED_DOCUMENT_TYPES = ".pdf,.doc,.docx,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,image/png,image/jpeg";
const REQUIRED_FIELDS: Array<keyof MarketingFlyerForm> = ["building_name", "address", "suite_number", "rsf"];

function asText(value: unknown): string {
  return String(value || "").trim();
}

function toAsset(file: File): Promise<MarketingMediaAsset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: `asset-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name,
        dataUrl: String(reader.result || ""),
      });
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function fieldLabel(key: keyof MarketingFlyerForm): string {
  const labels: Partial<Record<keyof MarketingFlyerForm, string>> = {
    building_name: "Building name",
    address: "Address",
    suite_number: "Suite number",
    rsf: "RSF",
    floor: "Floor",
    availability: "Availability",
    lease_type: "Lease type",
    rate: "Rate",
    opex: "OPEX",
    term_expiration: "Term expiration",
    suite_features: "Suite features",
    building_features: "Building features",
  };
  return labels[key] || key;
}

function normalizeHexColor(value: string, fallback: string): string {
  const raw = asText(value);
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
}

function marketingFieldText(value: unknown): string {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("\n");
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.round(value));
  return asText(value);
}

function buildSnapshot(input: {
  form: MarketingFlyerForm;
  copy: MarketingGeneratedCopy;
  photos: MarketingMediaAsset[];
  floorplan: MarketingMediaAsset | null;
  branding?: MarketingExportBranding;
}): MarketingFlyerSnapshot {
  return {
    form: input.form,
    copy: input.copy,
    photos: input.photos,
    floorplan: input.floorplan,
    logoDataUrl: input.branding?.brokerageLogoDataUrl || input.branding?.clientLogoDataUrl || null,
    generatedAtIso: new Date().toISOString(),
    disclaimer: input.branding?.disclaimer || "",
  };
}

function snapshotHtml(snapshot: MarketingFlyerSnapshot): string {
  const payload = JSON.stringify(snapshot).replace(/</g, "\\u003c");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Marketing Flyer</title>
<style>
body{margin:0;background:#111;font-family:Arial,Helvetica,sans-serif}.page{width:8.5in;min-height:11in;margin:0 auto 24px;background:#fff;color:#111;box-sizing:border-box;padding:.45in;page-break-after:always}.k{font-size:10px;text-transform:uppercase;letter-spacing:.2em;color:${snapshot.form.primary_color}}h1{font-size:42px;line-height:.96;margin:18px 0 24px;letter-spacing:-.04em}.hero,.photo,.floor{border:1px solid #ddd;background:#f3f3f3;display:flex;align-items:center;justify-content:center;color:#777;text-transform:uppercase;letter-spacing:.12em}.hero{height:6.7in}.photo{height:2.5in}.floor{height:5in}.grid{display:grid;gap:14px}.g2{grid-template-columns:1fr 1fr}.details{grid-template-columns:1fr 1fr 1fr}.box{border:1px solid #ddd;padding:12px}.label{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:#666}.value{font-weight:700;margin-top:5px}.bullet{border-left:4px solid ${snapshot.form.secondary_color};padding-left:12px;margin:12px 0;font-size:16px;line-height:1.5}.footer{margin-top:18px;border-top:1px solid #ddd;padding-top:10px;font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#666;display:flex;justify-content:space-between;gap:16px}.logo{max-height:.6in;max-width:1.7in;object-fit:contain}.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}@media print{body{background:#fff}.page{margin:0;box-shadow:none}}
</style></head><body>
<script>window.__SNAPSHOT__=${payload};</script>
${[1,2,3,4,5].map((page) => {
  const f = snapshot.form;
  const photo = (i: number, cls = "photo") => snapshot.photos[i]?.dataUrl ? `<img src="${snapshot.photos[i].dataUrl}" class="${cls}" style="width:100%;object-fit:cover">` : `<div class="${cls}">Photo</div>`;
  const footer = `<div class="footer"><span>${snapshot.disclaimer || "Information deemed reliable; tenant and landlord to verify all terms."}</span><span>Page ${page}</span></div>`;
  if (page === 1) return `<section class="page"><div class="top"><div><div class="k">${marketingOfferLabel(f.lease_type)}</div><h1>${snapshot.copy.headline}</h1></div>${snapshot.logoDataUrl ? `<img class="logo" src="${snapshot.logoDataUrl}">` : ""}</div>${photo(0, "hero")}<h2>${f.building_name}</h2><p>${f.address}</p><h2>Suite ${f.suite_number}</h2>${footer}</section>`;
  if (page === 2) return `<section class="page"><div class="k">Suite Details</div><h1>The essentials at a glance.</h1><div class="grid details">${[
    ["RSF", f.rsf], ["Rate", f.rate], ["Availability", f.availability], ["Term", f.term_expiration], ["Floor", f.floor], ["OPEX", f.opex],
  ].map(([label, value]) => `<div class="box"><div class="label">${label}</div><div class="value">${value || "-"}</div></div>`).join("")}</div><div class="grid g2" style="margin-top:24px">${photo(1)}${photo(2)}</div>${footer}</section>`;
  if (page === 3) return `<section class="page"><div class="k">Suite Features</div><h1>Built for fast review.</h1>${snapshot.copy.suite_bullets.map((b) => `<div class="bullet">${b}</div>`).join("")}<div class="grid g2" style="margin-top:24px">${photo(3)}${photo(0)}</div>${footer}</section>`;
  if (page === 4) return `<section class="page"><div class="k">Building Features</div><h1>A setting that supports the deal.</h1>${snapshot.copy.building_bullets.map((b) => `<div class="bullet">${b}</div>`).join("")}${photo(0, "hero")}${footer}</section>`;
  return `<section class="page"><div class="k">Floorplan And Contacts</div><h1>Review the layout, then reach out.</h1>${f.include_floorplan && snapshot.floorplan?.dataUrl ? `<img src="${snapshot.floorplan.dataUrl}" class="floor" style="width:100%;object-fit:contain">` : `<div class="floor">${f.include_floorplan ? "Floorplan" : "Floorplan hidden"}</div>`}<div class="grid g2" style="margin-top:18px">${[f.broker, ...f.co_brokers].filter((b) => b.name || b.email || b.phone).slice(0,3).map((b) => `<div class="box"><strong>${b.name || "Broker"}</strong><p>${b.email || ""}</p><p>${b.phone || ""}</p></div>`).join("")}</div>${footer}</section>`;
}).join("")}
</body></html>`;
}

function FieldShell({
  label,
  field,
  autoFilled,
  required,
  children,
}: {
  label: string;
  field: keyof MarketingFlyerForm;
  autoFilled: MarketingAutoFilledFields;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between gap-2 text-xs uppercase tracking-[0.14em] text-slate-300">
        <span>{label}{required ? " *" : ""}</span>
        {autoFilled[field] ? <span className="border border-cyan-300/40 bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-100">Auto-filled</span> : null}
      </span>
      {children}
    </label>
  );
}

export function MarketingWorkspace({
  clientId,
  clientName,
  representationMode,
  pendingDocumentImport,
  onPendingDocumentImportHandled,
  exportBranding,
}: MarketingWorkspaceProps) {
  const { activeClient, session, registerDocument } = useClientWorkspace();
  const defaultForm = useMemo(() => buildDefaultMarketingForm({
    representationMode,
    brokerName: exportBranding?.preparedBy || session?.user?.name || "",
    brokerEmail: session?.user?.email || "",
    primaryColor: exportBranding?.primaryColor,
    secondaryColor: exportBranding?.secondaryColor,
  }), [exportBranding?.preparedBy, exportBranding?.primaryColor, exportBranding?.secondaryColor, representationMode, session?.user?.email, session?.user?.name]);
  const [form, setForm] = useState<MarketingFlyerForm>(defaultForm);
  const [autoFilled, setAutoFilled] = useState<MarketingAutoFilledFields>({});
  const [summary, setSummary] = useState("Drop a lease, flyer, or proposal to auto-fill.");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [photos, setPhotos] = useState<MarketingMediaAsset[]>([]);
  const [floorplan, setFloorplan] = useState<MarketingMediaAsset | null>(null);
  const [snapshot, setSnapshot] = useState<MarketingFlyerSnapshot>(() =>
    buildSnapshot({ form: defaultForm, copy: generateMarketingCopy(defaultForm), photos: [], floorplan: null, branding: exportBranding }),
  );
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const photosInputRef = useRef<HTMLInputElement | null>(null);
  const floorplanInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      lease_type: defaultForm.lease_type,
      broker: {
        ...prev.broker,
        name: prev.broker.name || defaultForm.broker.name,
        email: prev.broker.email || defaultForm.broker.email,
      },
      primary_color: normalizeHexColor(prev.primary_color, defaultForm.primary_color),
      secondary_color: normalizeHexColor(prev.secondary_color, defaultForm.secondary_color),
    }));
  }, [defaultForm]);

  const generatedDocumentName = useMemo(() => {
    const suite = asText(form.suite_number) ? `Suite ${form.suite_number}` : "Suite";
    return `${marketingOfferLabel(form.lease_type)} Flyer - ${suite}`;
  }, [form.lease_type, form.suite_number]);

  const setField = useCallback(<K extends keyof MarketingFlyerForm>(key: K, value: MarketingFlyerForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setAutoFilled((prev) => ({ ...prev, [key]: false }));
  }, []);

  const countFound = useCallback((fields: MarketingAutoFilledFields) => (
    Object.values(fields).filter(Boolean).length
  ), []);

  const applySnapshot = useCallback((normalize: DocumentNormalizeSnapshot | null | undefined, docName: string) => {
    const canonical = normalize?.canonical_lease || null;
    if (!canonical) {
      setSummary(`We found 0 fields from ${docName}. Review the form and fill required fields manually.`);
      return;
    }
    setForm((prev) => {
      const mapped = mapCanonicalLeaseToMarketingForm({ canonical, currentForm: prev, representationMode });
      setAutoFilled((current) => ({ ...current, ...mapped.autoFilled }));
      const found = countFound(mapped.autoFilled);
      setSummary(`We found ${found} field${found === 1 ? "" : "s"} from ${docName}. Review and generate when ready.`);
      return mapped.form;
    });
  }, [countFound, representationMode]);

  const applyMarketingFields = useCallback((fields: MarketingExtractedFields | null, docName: string): boolean => {
    if (!fields) return false;
    const mapped: Array<[keyof MarketingFlyerForm, unknown]> = [
      ["building_name", fields.building_name],
      ["address", fields.address],
      ["suite_number", fields.suite_number],
      ["rsf", fields.rsf],
      ["floor", fields.floor],
      ["availability", fields.availability],
      ["rate", fields.rate],
      ["opex", fields.opex],
      ["term_expiration", fields.term_expiration],
      ["suite_features", fields.suite_features],
      ["building_features", fields.building_features],
    ];
    const found: MarketingAutoFilledFields = {};
    setForm((prev) => {
      const next = { ...prev };
      for (const [key, raw] of mapped) {
        const value = marketingFieldText(raw);
        if (!value) continue;
        next[key] = value as never;
        found[key] = true;
      }
      next.lease_type = defaultForm.lease_type;
      if (fields.lease_type && fields.lease_type === defaultForm.lease_type) {
        found.lease_type = true;
      }
      return next;
    });
    const foundCount = countFound(found);
    setAutoFilled((prev) => ({ ...prev, ...found }));
    setSummary(`We found ${foundCount} field${foundCount === 1 ? "" : "s"} from ${docName}. Review and generate when ready.`);
    return foundCount > 0;
  }, [countFound, defaultForm.lease_type]);

  const handleDocumentFiles = useCallback(async (files: FileList | File[] | null | undefined) => {
    const file = Array.from(files ?? [])[0];
    if (!file || reading) return;
    setReading(true);
    setError("");
    setStatus("Reading document...");
    try {
      const marketingFields = await extractMarketingDocument(file);
      const appliedMarketingFields = applyMarketingFields(marketingFields, file.name);
      let normalize = null;
      if (!appliedMarketingFields && /\.(pdf|docx|doc)$/i.test(file.name)) {
        normalize = await normalizeWorkspaceDocument(file);
      }
      const saved = await registerDocument({
        clientId: activeClient?.id || clientId,
        name: file.name,
        file,
        sourceModule: "marketing",
        normalize,
        parsed: Boolean(normalize?.canonical_lease),
      });
      const snapshotValue = saved?.normalizeSnapshot || toDocumentNormalizeSnapshot(normalize);
      if (!appliedMarketingFields) {
        applySnapshot(snapshotValue, file.name);
      }
      if (/^image\//i.test(file.type)) {
        const asset = await toAsset(file);
        setPhotos((prev) => [asset, ...prev].slice(0, 4));
      }
      setStatus("Document intake complete.");
    } catch (err) {
      setError(getDisplayErrorMessage(err));
      setSummary("We could not auto-fill from that document. Fill the required fields manually and generate when ready.");
    } finally {
      setReading(false);
    }
  }, [activeClient?.id, applyMarketingFields, applySnapshot, clientId, reading, registerDocument]);

  useEffect(() => {
    if (!pendingDocumentImport) return;
    applySnapshot(pendingDocumentImport.normalizeSnapshot, pendingDocumentImport.name);
    onPendingDocumentImportHandled?.();
  }, [applySnapshot, onPendingDocumentImportHandled, pendingDocumentImport]);

  const addPhotos = useCallback(async (files: FileList | File[] | null | undefined) => {
    const next = await Promise.all(Array.from(files ?? []).slice(0, 4).map(toAsset));
    setPhotos((prev) => [...prev, ...next].slice(0, 4));
  }, []);

  const addFloorplan = useCallback(async (files: FileList | File[] | null | undefined) => {
    const file = Array.from(files ?? [])[0];
    if (!file) return;
    setFloorplan(await toAsset(file));
  }, []);

  const generate = useCallback(async () => {
    if (!canGenerateMarketingFlyer(form)) return;
    setError("");
    setStatus("Polishing flyer copy and rendering preview...");
    const copy = generateMarketingCopy(form);
    const nextSnapshot = buildSnapshot({ form, copy, photos, floorplan, branding: exportBranding });
    setSnapshot(nextSnapshot);
    try {
      await registerDocument({
        clientId: activeClient?.id || clientId,
        name: `${generatedDocumentName} - ${new Date().toLocaleDateString()}`,
        type: "flyers",
        building: form.building_name,
        address: form.address,
        suite: form.suite_number,
        parsed: true,
        sourceModule: "marketing",
      });
      setStatus("Generated and saved to workspace documents.");
    } catch (err) {
      setStatus("Generated preview. Workspace auto-save could not complete.");
      setError(getDisplayErrorMessage(err));
    }
  }, [activeClient?.id, clientId, exportBranding, floorplan, form, generatedDocumentName, photos, registerDocument]);

  const downloadPdf = useCallback(() => {
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) {
      setError("Popup was blocked. Allow popups to print or save the flyer PDF.");
      return;
    }
    popup.document.write(snapshotHtml(snapshot));
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 400);
  }, [snapshot]);

  const downloadPng = useCallback(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2550;
    canvas.height = 3300;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = form.primary_color;
    ctx.font = "bold 48px Arial";
    ctx.fillText(marketingOfferLabel(form.lease_type).toUpperCase(), 140, 170);
    ctx.fillStyle = "#111111";
    ctx.font = "bold 124px Arial";
    const headline = snapshot.copy.headline || generatedDocumentName;
    headline.match(/.{1,28}(\s|$)/g)?.slice(0, 3).forEach((line, index) => ctx.fillText(line.trim(), 140, 340 + index * 130));
    const hero = snapshot.photos[0]?.dataUrl;
    if (hero) {
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = hero;
      });
      if (img.width > 0) ctx.drawImage(img, 140, 740, 2270, 1680);
    } else {
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(140, 740, 2270, 1680);
      ctx.fillStyle = "#777";
      ctx.font = "40px Arial";
      ctx.fillText("HERO PHOTO", 1020, 1580);
    }
    ctx.fillStyle = "#111";
    ctx.font = "bold 72px Arial";
    ctx.fillText(form.building_name || "Building name", 140, 2600);
    ctx.font = "44px Arial";
    ctx.fillText(form.address || "Property address", 140, 2680);
    ctx.font = "bold 84px Arial";
    ctx.fillText(`Suite ${form.suite_number || "-"}`, 140, 2835);
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${generatedDocumentName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "marketing-flyer"}.png`;
    link.click();
  }, [form.address, form.building_name, form.lease_type, form.primary_color, form.suite_number, generatedDocumentName, snapshot.copy.headline, snapshot.photos]);

  const copyShareLink = useCallback(async () => {
    try {
      const link = buildMarketingShareLink(snapshot);
      await navigator.clipboard.writeText(link);
      setStatus("Share link copied.");
    } catch (err) {
      setError(getDisplayErrorMessage(err));
    }
  }, [snapshot]);

  const readyCount = countRequiredMarketingFields(form);
  const canGenerate = canGenerateMarketingFlyer(form);
  const requiredClass = (key: keyof MarketingFlyerForm) => (
    REQUIRED_FIELDS.includes(key) && !asText(form[key])
      ? "border-amber-300/60 bg-amber-400/10"
      : "border-white/15 bg-black/25"
  );
  const inputClass = (key: keyof MarketingFlyerForm) => `input-premium ${requiredClass(key)}`;

  const renderBrokerFields = (broker: MarketingBroker, onChange: (patch: Partial<MarketingBroker>) => void) => (
    <div className="grid gap-2 sm:grid-cols-3">
      <input className="input-premium" value={broker.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Name" />
      <input className="input-premium" value={broker.email} onChange={(e) => onChange({ email: e.target.value })} placeholder="Email" />
      <input className="input-premium" value={broker.phone} onChange={(e) => onChange({ phone: e.target.value })} placeholder="Phone" />
    </div>
  );

  return (
    <PlatformSection
      kicker="Marketing"
      title={`${marketingOfferLabel(form.lease_type)} Flyer Generator`}
      description={`${clientName || activeClient?.name || "Workspace"} can turn a lease, flyer, proposal, or manual suite details into a print-ready branded flyer.`}
      maxWidthClassName="max-w-[98vw]"
      actions={
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-premium btn-premium-secondary" onClick={downloadPdf}>Download PDF</button>
          <button type="button" className="btn-premium btn-premium-secondary" onClick={downloadPng}>Download PNG</button>
          <button type="button" className="btn-premium btn-premium-secondary" onClick={copyShareLink}>Copy share link</button>
        </div>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.82fr)_minmax(0,1.18fr)]">
        <section className="min-w-0 border border-cyan-100/15 bg-[linear-gradient(180deg,rgba(13,27,48,0.72),rgba(9,19,35,0.88))] p-4">
          <input ref={documentInputRef} type="file" accept={ACCEPTED_DOCUMENT_TYPES} className="hidden" onChange={(e) => void handleDocumentFiles(e.target.files)} />
          <div
            role="button"
            tabIndex={0}
            onClick={() => documentInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") documentInputRef.current?.click();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              void handleDocumentFiles(event.dataTransfer.files);
            }}
            className={`flex min-h-[152px] cursor-pointer flex-col items-center justify-center border border-dashed p-5 text-center transition ${dragActive ? "border-cyan-200 bg-cyan-400/10" : "border-cyan-200/35 bg-black/20"} ${reading ? "animate-pulse" : ""}`}
          >
            <p className="text-base font-semibold text-white">{reading ? "Reading document..." : "Drop a lease, flyer, or proposal to auto-fill"}</p>
            <p className="mt-2 text-xs text-slate-400">PDF, DOCX, PNG, JPG</p>
          </div>
          <div className="mt-3 border border-cyan-200/20 bg-cyan-400/10 p-3 text-sm text-cyan-50">
            {summary} <span className="text-cyan-200">{readyCount}/4 required fields ready.</span>
          </div>
          {status ? <p className="mt-3 text-sm text-slate-300">{status}</p> : null}
          {error ? <p className="mt-3 border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</p> : null}
          <div className="mt-4">
            <ClientDocumentPicker
              buttonLabel="Select saved lease, flyer, or proposal"
              allowedTypes={["leases", "sublease documents", "proposals", "flyers", "floorplans", "other"]}
              onSelectDocument={(doc) => applySnapshot(doc.normalizeSnapshot, doc.name)}
            />
          </div>

          <div className="mt-6 space-y-6">
            <div>
              <p className="heading-kicker mb-3">Property Details</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldShell label="Building name" field="building_name" autoFilled={autoFilled} required>
                  <input className={inputClass("building_name")} value={form.building_name} onChange={(e) => setField("building_name", e.target.value)} />
                </FieldShell>
                <FieldShell label="Address" field="address" autoFilled={autoFilled} required>
                  <input className={inputClass("address")} value={form.address} onChange={(e) => setField("address", e.target.value)} />
                </FieldShell>
                <FieldShell label="Suite number" field="suite_number" autoFilled={autoFilled} required>
                  <input className={inputClass("suite_number")} value={form.suite_number} onChange={(e) => setField("suite_number", e.target.value)} />
                </FieldShell>
                <FieldShell label="RSF" field="rsf" autoFilled={autoFilled} required>
                  <input type="number" min="0" className={inputClass("rsf")} value={form.rsf} onChange={(e) => setField("rsf", e.target.value)} />
                </FieldShell>
                <FieldShell label="Floor" field="floor" autoFilled={autoFilled}>
                  <input className={inputClass("floor")} value={form.floor} onChange={(e) => setField("floor", e.target.value)} />
                </FieldShell>
                <FieldShell label="Availability" field="availability" autoFilled={autoFilled}>
                  <input className={inputClass("availability")} value={form.availability} onChange={(e) => setField("availability", e.target.value)} placeholder="Immediately or date" />
                </FieldShell>
              </div>
            </div>

            <div>
              <p className="heading-kicker mb-3">Deal Terms</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldShell label="Lease type" field="lease_type" autoFilled={autoFilled}>
                  <select className="input-premium" value={form.lease_type} onChange={(e) => setField("lease_type", e.target.value as MarketingFlyerForm["lease_type"])}>
                    <option>Direct Lease</option>
                    <option>Sublease</option>
                  </select>
                </FieldShell>
                <FieldShell label="Rate" field="rate" autoFilled={autoFilled}>
                  <input className="input-premium" value={form.rate} onChange={(e) => setField("rate", e.target.value)} placeholder="$42.00/SF NNN" />
                </FieldShell>
                <FieldShell label="OPEX" field="opex" autoFilled={autoFilled}>
                  <input className="input-premium" value={form.opex} onChange={(e) => setField("opex", e.target.value)} placeholder="$30.22" />
                </FieldShell>
                <FieldShell label="Term expiration" field="term_expiration" autoFilled={autoFilled}>
                  <input type="date" className="input-premium" value={form.term_expiration} onChange={(e) => setField("term_expiration", e.target.value)} />
                </FieldShell>
              </div>
            </div>

            {(["suite_features", "building_features"] as const).map((key) => (
              <div key={key}>
                <p className="heading-kicker mb-3">{fieldLabel(key)}</p>
                <FieldShell label={fieldLabel(key)} field={key} autoFilled={autoFilled}>
                  <textarea
                    className="input-premium min-h-[120px]"
                    value={form[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    placeholder={key === "suite_features" ? "Private offices, conference room, plug-and-play furniture..." : "Amenities, access, parking, nearby services..."}
                  />
                </FieldShell>
              </div>
            ))}

            <div>
              <p className="heading-kicker mb-3">Media</p>
              <input ref={photosInputRef} type="file" accept="image/png,image/jpeg" multiple className="hidden" onChange={(e) => void addPhotos(e.target.files)} />
              <input ref={floorplanInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => void addFloorplan(e.target.files)} />
              <div className="grid gap-3 sm:grid-cols-2">
                <button type="button" className="border border-dashed border-cyan-200/30 bg-black/20 p-4 text-left text-sm text-slate-200" onClick={() => photosInputRef.current?.click()}>
                  Upload up to 4 suite photos <span className="block text-xs text-slate-400">{photos.length}/4 selected</span>
                </button>
                <button type="button" className="border border-dashed border-cyan-200/30 bg-black/20 p-4 text-left text-sm text-slate-200" onClick={() => floorplanInputRef.current?.click()}>
                  Upload floorplan image <span className="block text-xs text-slate-400">{floorplan ? floorplan.name : "Optional"}</span>
                </button>
              </div>
            </div>

            <div>
              <p className="heading-kicker mb-3">Broker Info</p>
              {renderBrokerFields(form.broker, (patch) => setForm((prev) => ({ ...prev, broker: { ...prev.broker, ...patch } })))}
              <div className="mt-3 space-y-2">
                {form.co_brokers.map((broker, index) => (
                  <div key={index}>
                    {renderBrokerFields(broker, (patch) =>
                      setForm((prev) => ({
                        ...prev,
                        co_brokers: prev.co_brokers.map((existing, i) => i === index ? { ...existing, ...patch } : existing),
                      }))
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="btn-premium btn-premium-secondary text-xs"
                  disabled={form.co_brokers.length >= 2}
                  onClick={() => setForm((prev) => ({ ...prev, co_brokers: [...prev.co_brokers, { name: "", email: "", phone: "" }].slice(0, 2) }))}
                >
                  Add co-broker
                </button>
              </div>
            </div>

            <div>
              <p className="heading-kicker mb-3">Flyer Style</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <select className="input-premium" value={form.layout_style} onChange={(e) => setField("layout_style", e.target.value as MarketingLayoutStyle)}>
                  <option>Classic</option>
                  <option>Modern</option>
                  <option>Minimal</option>
                </select>
                <input type="color" className="h-12 w-full border border-white/15 bg-black/25 p-1" value={form.primary_color} onChange={(e) => setField("primary_color", e.target.value)} />
                <input type="color" className="h-12 w-full border border-white/15 bg-black/25 p-1" value={form.secondary_color} onChange={(e) => setField("secondary_color", e.target.value)} />
              </div>
              <label className="mt-3 flex items-center gap-3 text-sm text-slate-200">
                <input type="checkbox" checked={form.include_floorplan} onChange={(e) => setField("include_floorplan", e.target.checked)} />
                Include floorplan
              </label>
            </div>

            <button
              type="button"
              className="btn-premium btn-premium-primary w-full"
              disabled={!canGenerate || reading}
              onClick={() => void generate()}
              title={!canGenerate ? "Building, address, suite, and RSF are required." : undefined}
            >
              Generate Flyer
            </button>
          </div>
        </section>

        <section className="min-w-0 border border-cyan-100/15 bg-[linear-gradient(180deg,rgba(4,10,18,0.76),rgba(9,19,35,0.88))] p-4">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="heading-kicker">Live Flyer Preview</p>
              <h3 className="text-lg text-white">{generatedDocumentName}</h3>
            </div>
            <p className="text-xs text-slate-400">Preview updates each time Generate is clicked.</p>
          </div>
          <div className="max-h-[calc(100vh-220px)] overflow-auto pr-2">
            <MarketingFlyerPreview snapshot={snapshot} />
          </div>
        </section>
      </div>
    </PlatformSection>
  );
}
