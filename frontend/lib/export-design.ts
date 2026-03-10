import type ExcelJS from "exceljs";
import { EXCEL_THEME as BASE_EXCEL_THEME } from "@/lib/excel-style-constants";

export const EXCEL_THEME = BASE_EXCEL_THEME;

export const EXPORT_BRAND = {
  name: "The CRE Model",
  excel: {
    colors: {
      black: EXCEL_THEME.colors.black,
      white: EXCEL_THEME.colors.white,
      text: EXCEL_THEME.colors.text,
      secondaryText: EXCEL_THEME.colors.secondaryText,
      border: EXCEL_THEME.colors.border,
      mutedFill: EXCEL_THEME.colors.mutedFill,
      sectionRule: EXCEL_THEME.colors.sectionRule,
      accent: "FF1F2937",
    },
    numberFormats: {
      currency0: EXCEL_THEME.numberFormats.currency0,
      currency2: EXCEL_THEME.numberFormats.currency2,
      percent2: EXCEL_THEME.numberFormats.percent2,
      integer: EXCEL_THEME.numberFormats.integer,
      date: "mm.dd.yyyy",
    },
  },
  pdf: {
    colors: {
      ink: "#0f172a",
      subtext: "#475569",
      border: "#d1d5db",
      mutedFill: "#f8fafc",
      panelFill: "#f1f5f9",
      accent: "#111827",
    },
    fonts: {
      family: "Aptos, Calibri, Arial, sans-serif",
    },
  },
} as const;

export interface ExportFileNameOptions {
  kind: "xlsx" | "pdf";
  brokerageName?: string | null;
  clientName?: string | null;
  reportDate?: string | null;
  excelDescriptor: string;
  pdfDescriptor: string;
}

export interface SharedExportBranding {
  brokerageName?: string | null;
  clientName?: string | null;
  reportDate?: string | null;
  preparedBy?: string | null;
}

export interface ResolvedExportBranding {
  brokerageName: string;
  clientName: string;
  reportDate: string;
  preparedBy: string;
}

export function formatDateMmDdYyyy(dateValue: Date): string {
  const month = `${dateValue.getMonth() + 1}`.padStart(2, "0");
  const day = `${dateValue.getDate()}`.padStart(2, "0");
  return `${month}.${day}.${dateValue.getFullYear()}`;
}

export function normalizeDateMmDdYyyy(raw: string | null | undefined): string {
  const source = String(raw ?? "").trim();
  if (!source) return "";
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(source)) return source;
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    const [year, month, day] = source.split("-");
    return `${month}.${day}.${year}`;
  }
  return "";
}

export function sanitizeFileNamePart(raw: string | null | undefined, fallback: string): string {
  const base = String(raw ?? "").trim() || fallback;
  return base
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96) || fallback;
}

export function buildPlatformExportFileName(options: ExportFileNameOptions): string {
  const reportDate = normalizeDateMmDdYyyy(options.reportDate) || formatDateMmDdYyyy(new Date());
  const brokerage = sanitizeFileNamePart(options.brokerageName, "Brokerage");
  const client = sanitizeFileNamePart(options.clientName, "Client");
  const descriptor = options.kind === "xlsx" ? options.excelDescriptor : options.pdfDescriptor;
  return `${brokerage} - ${descriptor} - ${client} - ${reportDate}.${options.kind}`;
}

export function resolveExportBranding(
  branding: SharedExportBranding | null | undefined,
): ResolvedExportBranding {
  return {
    brokerageName: String(branding?.brokerageName || EXPORT_BRAND.name).trim() || EXPORT_BRAND.name,
    clientName: String(branding?.clientName || "Client").trim() || "Client",
    reportDate: normalizeDateMmDdYyyy(branding?.reportDate) || formatDateMmDdYyyy(new Date()),
    preparedBy: String(branding?.preparedBy || "").trim(),
  };
}

export function buildExportMetaLine(branding: SharedExportBranding | null | undefined): string {
  const resolved = resolveExportBranding(branding);
  return `${resolved.brokerageName} | ${resolved.clientName} | Report Date ${resolved.reportDate}${resolved.preparedBy ? ` | Prepared by ${resolved.preparedBy}` : ""}`;
}

export function toColumnLetter(index: number): string {
  let n = Math.max(1, Math.floor(index));
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function applyExcelPageSetup(
  sheet: ExcelJS.Worksheet,
  opts: {
    landscape: boolean;
    lastRow: number;
    lastCol: number;
    repeatHeaderRow?: number;
    fitToHeight?: number;
  }
): void {
  sheet.views = [
    {
      ...(sheet.views?.[0] ?? {}),
      showGridLines: false,
      zoomScale: 100,
      style: "pageBreakPreview",
    } as ExcelJS.WorksheetView & { style?: "pageBreakPreview" },
  ];
  sheet.pageSetup = {
    ...sheet.pageSetup,
    orientation: opts.landscape ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: opts.fitToHeight ?? 0,
    paperSize: 1 as ExcelJS.PaperSize,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.45,
      bottom: 0.45,
      header: 0.2,
      footer: 0.2,
    },
    printArea: `A1:${toColumnLetter(opts.lastCol)}${opts.lastRow}`,
    horizontalCentered: false,
  };
  if (opts.repeatHeaderRow) {
    const setup = sheet.pageSetup as unknown as { printTitlesRow?: string };
    setup.printTitlesRow = `${opts.repeatHeaderRow}:${opts.repeatHeaderRow}`;
  }
}
