import ExcelJS from "exceljs";
import type { ExistingObligation, SensitivityResult, SubleaseScenarioResult } from "./types";

function toPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function toCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function toDateLabel(iso: string): string {
  const [y, m, d] = String(iso || "").split("-");
  if (!y || !m || !d) return iso;
  return `${m}.${d}.${y}`;
}

export async function buildSubleaseRecoveryWorkbook(
  existing: ExistingObligation,
  results: SubleaseScenarioResult[],
  sensitivity: SensitivityResult,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "The CRE Model";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Sublease Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 36 },
    { header: "Existing Obligation", key: "existing", width: 22 },
    ...results.map((result) => ({ header: result.summary.scenarioName, key: result.summary.scenarioId, width: 22 })),
  ];

  const addSummaryRow = (label: string, values: Array<string | number>) => {
    summary.addRow([label, ...values]);
  };

  addSummaryRow("Premises", [existing.premises, ...results.map(() => existing.premises)]);
  addSummaryRow("RSF", [existing.rsf, ...results.map((result) => result.scenario.rsf)]);
  addSummaryRow("Commencement", [toDateLabel(existing.commencementDate), ...results.map((result) => toDateLabel(result.scenario.subleaseCommencementDate))]);
  addSummaryRow("Expiration", [toDateLabel(existing.expirationDate), ...results.map((result) => toDateLabel(result.scenario.subleaseExpirationDate))]);
  addSummaryRow("Total Remaining Obligation", [
    toCurrency(results[0]?.summary.totalRemainingObligation ?? 0),
    ...results.map((result) => toCurrency(result.summary.totalRemainingObligation)),
  ]);
  addSummaryRow("Total Sublease Recovery", [
    "N/A",
    ...results.map((result) => toCurrency(result.summary.totalSubleaseRecovery)),
  ]);
  addSummaryRow("Total Sublease Costs", [
    "N/A",
    ...results.map((result) => toCurrency(result.summary.totalSubleaseCosts)),
  ]);
  addSummaryRow("Net Sublease Recovery", [
    "N/A",
    ...results.map((result) => toCurrency(result.summary.netSubleaseRecovery)),
  ]);
  addSummaryRow("Net Obligation", [
    toCurrency(results[0]?.summary.totalRemainingObligation ?? 0),
    ...results.map((result) => toCurrency(result.summary.netObligation)),
  ]);
  addSummaryRow("Recovery %", ["0.0%", ...results.map((result) => toPercent(result.summary.recoveryPercent))]);
  addSummaryRow("Recovery % per SF", ["0.0%", ...results.map((result) => toPercent(result.summary.recoveryPercentPerSf))]);
  addSummaryRow("Avg Total Cost / SF / Year", [
    toCurrency((results[0]?.summary.averageTotalCostPerSfPerYear ?? 0)),
    ...results.map((result) => toCurrency(result.summary.averageTotalCostPerSfPerYear)),
  ]);
  addSummaryRow("Avg Total Cost / Month", [
    toCurrency((results[0]?.summary.averageTotalCostPerMonth ?? 0)),
    ...results.map((result) => toCurrency(result.summary.averageTotalCostPerMonth)),
  ]);
  addSummaryRow("Avg Total Cost / Year", [
    toCurrency((results[0]?.summary.averageTotalCostPerYear ?? 0)),
    ...results.map((result) => toCurrency(result.summary.averageTotalCostPerYear)),
  ]);
  addSummaryRow("NPV", [
    toCurrency((results[0]?.summary.npv ?? 0)),
    ...results.map((result) => toCurrency(result.summary.npv)),
  ]);

  summary.getRow(1).font = { bold: true };

  for (const result of results) {
    const sheetName = `${result.summary.scenarioName}`.slice(0, 31);
    const ws = workbook.addWorksheet(sheetName);
    ws.columns = [
      { header: "Month #", key: "monthNumber", width: 10 },
      { header: "Date", key: "date", width: 13 },
      { header: "Occupied RSF", key: "occupiedRsf", width: 14 },
      { header: "Base Rent", key: "baseRent", width: 14 },
      { header: "Operating Expenses", key: "operatingExpenses", width: 18 },
      { header: "Parking", key: "parking", width: 12 },
      { header: "TI Amortization", key: "tiAmortization", width: 15 },
      { header: "Gross Monthly Rent", key: "grossMonthlyRent", width: 16 },
      { header: "Abatements/Credits", key: "abatementsOrCredits", width: 17 },
      { header: "Net Monthly Rent", key: "netMonthlyRent", width: 14 },
      { header: "One-Time Costs", key: "oneTimeCosts", width: 14 },
      { header: "Sublease Recovery", key: "subleaseRecovery", width: 16 },
      { header: "Net Obligation", key: "netObligation", width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const row of result.monthly) {
      ws.addRow({
        ...row,
        date: toDateLabel(row.date),
      });
    }
  }

  const sensitivitySheet = workbook.addWorksheet("Sensitivity");
  sensitivitySheet.columns = [
    { header: "Downtime \\ Base Rent", key: "downtime", width: 24 },
    ...sensitivity.baseRentValues.map((value, idx) => ({
      header: `Rent ${idx + 1}: ${value.toFixed(2)}`,
      key: `rent_${idx}`,
      width: 20,
    })),
  ];
  sensitivitySheet.getRow(1).font = { bold: true };
  for (const downtime of sensitivity.downtimeValues) {
    const row: Array<string | number> = [`${downtime} months`];
    for (const baseRent of sensitivity.baseRentValues) {
      const cell = sensitivity.matrix.find((item) => item.downtimeMonths === downtime && item.baseRent === baseRent);
      row.push(cell ? `${toCurrency(cell.netObligation)} | ${toPercent(cell.recoveryPercent)}` : "-");
    }
    sensitivitySheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

export function downloadArrayBuffer(arrayBuffer: ArrayBuffer, fileName: string, mimeType: string): void {
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export function printSubleaseRecoverySummary(existing: ExistingObligation, results: SubleaseScenarioResult[]): void {
  const rows = results
    .map((result) => `
      <tr>
        <td>${result.summary.scenarioName}</td>
        <td>${toCurrency(result.summary.totalRemainingObligation)}</td>
        <td>${toCurrency(result.summary.totalSubleaseRecovery)}</td>
        <td>${toCurrency(result.summary.totalSubleaseCosts)}</td>
        <td>${toCurrency(result.summary.netObligation)}</td>
        <td>${toPercent(result.summary.recoveryPercent)}</td>
        <td>${toCurrency(result.summary.npv)}</td>
      </tr>
    `)
    .join("\n");

  const html = `
    <html>
      <head>
        <title>Sublease Recovery Analysis</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
          h1 { margin: 0 0 8px; }
          p { margin: 0 0 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 18px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: right; }
          th:first-child, td:first-child { text-align: left; }
          th { background: #e2e8f0; }
        </style>
      </head>
      <body>
        <h1>Sublease Recovery Analysis</h1>
        <p><strong>Premises:</strong> ${existing.premises}</p>
        <p><strong>RSF:</strong> ${existing.rsf.toLocaleString()}</p>
        <p><strong>Current Lease:</strong> ${toDateLabel(existing.commencementDate)} - ${toDateLabel(existing.expirationDate)}</p>
        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Total Remaining Obligation</th>
              <th>Total Sublease Recovery</th>
              <th>Total Sublease Costs</th>
              <th>Net Obligation</th>
              <th>Recovery %</th>
              <th>NPV</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </body>
    </html>
  `;

  const popup = window.open("", "_blank", "width=1100,height=800");
  if (!popup) return;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
}
