export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

export function downloadArrayBuffer(arrayBuffer: ArrayBuffer, fileName: string, mimeType: string): void {
  const blob = new Blob([arrayBuffer], { type: mimeType });
  downloadBlob(blob, fileName);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export function openPrintWindow(html: string, size: { width: number; height: number } = { width: 1280, height: 900 }): void {
  const popup = window.open("", "_blank", `width=${size.width},height=${size.height}`);
  if (!popup) return;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
}
