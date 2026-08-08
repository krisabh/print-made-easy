import { execFile } from "child_process";
import { promisify } from "util";

import {
  getDefaultPrinter,
  getPrinters as getPdfToPrinterList,
  print as printPdf,
} from "pdf-to-printer";

const execFileAsync = promisify(execFile);

export type DetectedPrinter = {
  name: string;
  status: "Online" | "Offline" | "Unknown";
  isDefault: boolean;
};

type WindowsPrinterRow = {
  Name?: string;
  PrinterStatus?: number | string;
  WorkOffline?: boolean | null;
};

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Detect printers installed on Windows.
 * Prefer PowerShell first — pdf-to-printer getPrinters often times out on Windows.
 */
export async function detectPrinters(): Promise<DetectedPrinter[]> {
  if (process.platform === "win32") {
    try {
      const rows = await withTimeout(
        detectPrintersViaPowerShell(),
        8000,
        "Get-Printer",
      );
      if (rows.length > 0) {
        const defaultName = await withTimeout(
          getDefaultPrinter().then((p) => p?.name ?? null),
          5000,
          "getDefaultPrinter",
        ).catch(() => null);

        return rows.map((row) => ({
          name: row.name,
          status: row.status,
          isDefault: defaultName === row.name,
        }));
      }
    } catch (error) {
      console.warn("PowerShell printer detection failed:", error);
    }
  }

  const printersFromLib = await withTimeout(
    getPdfToPrinterList(),
    8000,
    "getPrinters",
  ).catch((error) => {
    console.warn("pdf-to-printer getPrinters failed:", error);
    return [] as Array<{ name: string }>;
  });

  const defaultName = await withTimeout(
    getDefaultPrinter().then((p) => p?.name ?? null),
    5000,
    "getDefaultPrinter",
  ).catch(() => null);

  return printersFromLib.map((printer) => ({
    name: printer.name,
    status: "Unknown" as const,
    isDefault: defaultName === printer.name,
  }));
}

async function detectPrintersViaPowerShell(): Promise<DetectedPrinter[]> {
  const command =
    "Get-Printer | Select-Object Name, PrinterStatus, WorkOffline | ConvertTo-Json -Compress";

  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  );

  const trimmed = stdout.trim();
  if (!trimmed) return [];

  const parsed = JSON.parse(trimmed) as WindowsPrinterRow[] | WindowsPrinterRow;
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows
    .filter((row) => Boolean(row.Name))
    .map((row) => ({
      name: String(row.Name),
      status: mapWindowsStatus(row),
      isDefault: false,
    }));
}

function mapWindowsStatus(row: WindowsPrinterRow): DetectedPrinter["status"] {
  if (row.WorkOffline === true) return "Offline";
  if (row.PrinterStatus === 0 || row.PrinterStatus === "Normal") return "Online";
  if (typeof row.PrinterStatus === "number" && row.PrinterStatus > 0) {
    return "Offline";
  }
  return "Unknown";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Print a PDF on Windows via pdf-to-printer (SumatraPDF).
 * Keep options minimal — Canon XPS drivers often print blank pages when
 * Sumatra is given monochrome/simplex flags.
 */
export async function printPdfFile(
  filePath: string,
  printerName: string,
  options?: {
    copies?: number;
    printMode?: "BW" | "COLOR";
    printType?: "SINGLE" | "DOUBLE";
  },
) {
  const printOptions: {
    printer: string;
    silent: boolean;
    copies: number;
    scale: "fit";
    side?: "duplex" | "simplex";
  } = {
    printer: printerName,
    silent: true,
    copies: options?.copies && options.copies > 0 ? options.copies : 1,
    // Fit content to page — avoids oversized/blank output on many drivers
    scale: "fit",
  };

  // Only request duplex when needed. Do not force simplex/monochrome.
  if (options?.printType === "DOUBLE") {
    printOptions.side = "duplex";
  }

  await printPdf(filePath, printOptions);

  // Give the spooler time to read the file before callers delete it.
  await delay(3000);
}
