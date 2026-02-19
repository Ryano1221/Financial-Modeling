"use client";

import { useState, useCallback } from "react";
import type { NormalizerResponse, BackendCanonicalLease } from "@/lib/types";

const REVIEW_FIELDS: { key: keyof BackendCanonicalLease; label: string; type?: "number" | "text"; placeholder?: string }[] = [
  { key: "building_name", label: "Building name", type: "text", placeholder: "e.g. Capital View Center" },
  { key: "suite", label: "Suite", type: "text", placeholder: "e.g. 220" },
  { key: "floor", label: "Floor (optional)", type: "text", placeholder: "e.g. 2" },
  { key: "address", label: "Street address", type: "text", placeholder: "e.g. 123 Main St, City, State" },
  { key: "rsf", label: "RSF", type: "number" },
  { key: "commencement_date", label: "Commencement date", type: "text" },
  { key: "expiration_date", label: "Expiration date", type: "text" },
  { key: "term_months", label: "Term (months)", type: "number" },
  { key: "free_rent_months", label: "Free rent (months)", type: "number" },
  { key: "ti_allowance_psf", label: "TI allowance ($/SF)", type: "number" },
  { key: "opex_psf_year_1", label: "Opex year 1 ($/SF/yr)", type: "number" },
  { key: "opex_growth_rate", label: "Opex growth rate", type: "number" },
  { key: "parking_count", label: "Parking spaces", type: "number" },
  { key: "parking_rate_monthly", label: "Parking $/space/month", type: "number" },
  { key: "discount_rate_annual", label: "Discount rate (e.g. 0.08)", type: "number" },
];

interface NormalizeReviewCardProps {
  data: NormalizerResponse;
  onConfirm: (canonical: BackendCanonicalLease) => void;
  onCancel: () => void;
}

export function NormalizeReviewCard({ data, onConfirm, onCancel }: NormalizeReviewCardProps) {
  const [edited, setEdited] = useState<BackendCanonicalLease>(() => ({ ...data.canonical_lease }));

  const update = useCallback((key: keyof BackendCanonicalLease, value: string | number) => {
    setEdited((prev) => ({ ...prev, [key]: key === "rsf" || key === "term_months" || key === "free_rent_months" || key === "parking_count" ? Number(value) : key === "ti_allowance_psf" || key === "opex_psf_year_1" || key === "opex_growth_rate" || key === "parking_rate_monthly" || key === "discount_rate_annual" ? Number(value) : value }));
  }, []);

  const handleConfirm = useCallback(() => {
    const payload = { ...edited };
    const b = (payload.building_name ?? "").toString().trim();
    const su = (payload.suite ?? "").toString().trim();
    const fl = (payload.floor ?? "").toString().trim();
    if (b && su) payload.premises_name = `${b} Suite ${su}`;
    else if (b && fl) payload.premises_name = `${b} Floor ${fl}`;
    else if (su) payload.premises_name = `Suite ${su}`;
    else if (fl) payload.premises_name = `Floor ${fl}`;
    onConfirm(payload);
  }, [edited, onConfirm]);

  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 space-y-4 shadow-[0_16px_38px_rgba(180,83,9,0.15)]">
      <p className="text-sm font-medium text-amber-100">
        Review & confirm — some fields were missing or low confidence. Edit as needed, then confirm to add this option.
      </p>
      {data.warnings.length > 0 && (
        <ul className="text-xs text-amber-100/90 list-disc list-inside space-y-0.5">
          {data.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {data.clarification_questions.length > 0 && (
        <p className="text-xs text-slate-300">{data.clarification_questions[0]}</p>
      )}
      {data.extraction_summary && (
        <div className="rounded-lg border border-slate-300/25 bg-slate-900/35 p-3 text-xs text-slate-300 space-y-1">
          <p>
            <span className="text-slate-400">Document type:</span>{" "}
            {data.extraction_summary.document_type_detected || "unknown"}
          </p>
          {data.extraction_summary.sections_searched.length > 0 && (
            <p>
              <span className="text-slate-400">Sections searched:</span>{" "}
              {data.extraction_summary.sections_searched.join(", ")}
            </p>
          )}
        </div>
      )}
      <div className="grid gap-3 max-h-80 overflow-y-auto">
        {REVIEW_FIELDS.map(({ key, label, type, placeholder }) => {
          const val = edited[key];
          const displayVal = val === undefined || val === null ? "" : String(val);
          const conf = data.field_confidence[key as string];
          return (
            <label key={key} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-300 w-48 shrink-0">{label}</span>
              <input
                type={type === "number" ? "number" : "text"}
                value={displayVal}
                onChange={(e) => update(key, type === "number" ? e.target.valueAsNumber : e.target.value)}
                placeholder={placeholder}
                className="input-premium flex-1 min-w-[120px] py-1.5 px-2 text-sm"
              />
              {conf !== undefined && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/30 text-slate-300">
                  {Math.round(conf * 100)}%
                </span>
              )}
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          onClick={handleConfirm}
          className="btn-premium btn-premium-success"
        >
          Confirm & add option
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-premium btn-premium-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
