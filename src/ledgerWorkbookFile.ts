import { invoke } from "@tauri-apps/api/core";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function downloadInBrowser(filename: string, bytes: Uint8Array): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: XLSX_MIME }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function deliverLedgerWorkbookFile(
  filename: string,
  bytes: Uint8Array,
): Promise<string> {
  try {
    return await invoke<string>("save_excel_backup", {
      filename,
      bytes: Array.from(bytes),
    });
  } catch {
    downloadInBrowser(filename, bytes);
    return filename;
  }
}
