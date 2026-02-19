/**
 * Centralized formatting for all monetary values, percentages, PSF, RSF, dates.
 * Never display raw numbers in the UI — use these helpers everywhere.
 */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

const USD_DECIMALS = (decimals: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

const NUMBER = (decimals: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/** Format as USD. Default 0 decimals. Returns "$0" for null/undefined. */
export function formatCurrency(
  value: number | null | undefined,
  opts?: { decimals?: number }
): string {
  if (value == null || Number.isNaN(value)) return "$0";
  const decimals = opts?.decimals ?? 0;
  if (decimals === 0) return USD.format(value);
  return USD_DECIMALS(decimals).format(value);
}

/** Format as USD per SF. Default 2 decimals. Returns "$0.00 / SF" for null/undefined. */
export function formatCurrencyPerSF(
  value: number | null | undefined,
  decimals: number = 2
): string {
  if (value == null || Number.isNaN(value)) return "$0.00 / SF";
  return `${formatCurrency(value, { decimals })} / SF`;
}

/** Format decimal as percent (0.05 → "5.00%"). Multiply by 100 when abs(value) <= 1. Default 2 decimals. */
export function formatPercent(
  value: number | null | undefined,
  optsOrDecimals?: { decimals?: number } | number
): string {
  if (value == null || Number.isNaN(value)) return "0.00%";
  const decimals = typeof optsOrDecimals === "number" ? optsOrDecimals : (optsOrDecimals?.decimals ?? 2);
  const pct = Math.abs(value) <= 1 ? value * 100 : value;
  return `${NUMBER(decimals).format(pct)}%`;
}

/** Format number with thousand separators. Default 0 decimals. */
export function formatNumber(
  value: number | null | undefined,
  opts?: { decimals?: number }
): string {
  if (value == null || Number.isNaN(value)) return NUMBER(0).format(0);
  const decimals = opts?.decimals ?? 0;
  return NUMBER(decimals).format(value);
}

/** Format number with commas and " RSF" suffix (e.g. "12,345 RSF"). */
export function formatRSF(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0 RSF";
  return `${formatNumber(value, { decimals: 0 })} RSF`;
}

/** Format date as dd/mm/yyyy. Accepts Date, YYYY-MM-DD, or dd/mm/yyyy inputs. */
export function formatDateISO(value: string | Date | null | undefined): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${d}/${m}/${y}`;
  }
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const yyyy = isoMatch[1];
    const mm = String(Number(isoMatch[2])).padStart(2, "0");
    const dd = String(Number(isoMatch[3])).padStart(2, "0");
    return `${dd}/${mm}/${yyyy}`;
  }
  const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const dd = String(Number(dmyMatch[1])).padStart(2, "0");
    const mm = String(Number(dmyMatch[2])).padStart(2, "0");
    const yyyy = dmyMatch[3];
    return `${dd}/${mm}/${yyyy}`;
  }
  return "";
}

/** Format months count (e.g. 60 → "60 months"). Default "0 months" for null/undefined. */
export function formatMonths(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0 months";
  const n = Math.round(value);
  return `${formatNumber(n, { decimals: 0 })} months`;
}

/** In development, warn once on load. Reminder to use formatters for all numeric/date display. */
if (typeof process !== "undefined" && process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  const key = "__formatWarnOnce";
  if (!(window as unknown as { [key: string]: boolean })[key]) {
    (window as unknown as { [key: string]: boolean })[key] = true;
    console.warn(
      "[format] Use formatCurrency, formatPercent, formatNumber, formatRSF, formatDateISO, formatMonths from @/lib/format for all monetary, percentage, PSF, RSF, and date display. Do not render raw numbers."
    );
  }
}
