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

/** Coalesce concurrent scans; short TTL avoids PowerShell storms from UI+heartbeat. */
const DETECT_CACHE_MS = 5_000;
let detectInFlight: Promise<DetectedPrinter[]> | null = null;
let detectCache: { at: number; printers: DetectedPrinter[] } | null = null;
let detectStarts = 0;

export function getDetectPrintersStats() {
  return {
    inFlight: Boolean(detectInFlight),
    cacheAgeMs: detectCache ? Date.now() - detectCache.at : null,
    starts: detectStarts,
  };
}

/** Test helper — do not call from production paths. */
export function resetDetectPrintersCacheForTests() {
  detectInFlight = null;
  detectCache = null;
  detectStarts = 0;
}

type WindowsPrinterRow = {
  Name?: string;
  WorkOffline?: boolean | null;
  PrinterStatus?: number | string;
  PrinterState?: number | string;
  PortName?: string;
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

async function detectPrintersUncached(): Promise<DetectedPrinter[]> {
  detectStarts += 1;
  if (process.platform === "win32") {
    try {
      const rows = await withTimeout(
        detectPrintersViaCim(),
        8000,
        "Win32_Printer",
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
      console.warn("CIM printer detection failed:", error);
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

/**
 * Detect printers installed on Windows.
 * Prefer Win32_Printer (CIM) — Get-Printer often reports Idle even when USB is unplugged.
 * Concurrent callers share one in-flight scan; results are briefly cached.
 */
export async function detectPrinters(
  options?: { force?: boolean },
): Promise<DetectedPrinter[]> {
  const now = Date.now();
  if (
    !options?.force &&
    detectCache &&
    now - detectCache.at < DETECT_CACHE_MS
  ) {
    return detectCache.printers;
  }

  if (detectInFlight) {
    return detectInFlight;
  }

  detectInFlight = detectPrintersUncached()
    .then((printers) => {
      detectCache = { at: Date.now(), printers };
      return printers;
    })
    .finally(() => {
      detectInFlight = null;
    });

  return detectInFlight;
}

async function detectPrintersViaCim(): Promise<DetectedPrinter[]> {
  const command =
    "Get-CimInstance Win32_Printer | Select-Object Name, WorkOffline, PrinterStatus, PrinterState, PortName | ConvertTo-Json -Compress";

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

/**
 * Win32_Printer.PrinterStatus: 1 Other, 2 Unknown, 3 Idle, 4 Printing, 5 Warmup,
 * 6 Stopped Printing, 7 Offline.
 * PrinterState bit 0x80 = Offline.
 */
function mapWindowsStatus(row: WindowsPrinterRow): DetectedPrinter["status"] {
  if (row.WorkOffline === true) return "Offline";

  const state =
    typeof row.PrinterState === "number"
      ? row.PrinterState
      : Number(row.PrinterState);
  if (Number.isFinite(state) && (state & 0x80) === 0x80) return "Offline";

  const status = row.PrinterStatus;
  if (status === 7 || status === "Offline") return "Offline";
  if (status === 2 || status === "Unknown") return "Offline";
  if (
    status === 3 ||
    status === 4 ||
    status === 5 ||
    status === "Idle" ||
    status === "Printing" ||
    status === "Warmup"
  ) {
    return "Online";
  }

  return "Unknown";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map PrintJob.printMode → pdf-to-printer `monochrome`.
 * BW → true (Sumatra -print-settings monochrome)
 * COLOR → false (Sumatra -print-settings color)
 * Missing/unknown → undefined (omit flag; do not assume COLOR).
 *
 * Physical output remains driver-dependent; some Canon/XPS drivers have
 * historically printed blank pages when Sumatra monochrome/simplex flags
 * are set. This mapping is intentional V1 enforcement, not universal proof.
 */
export function resolveMonochrome(
  printMode: "BW" | "COLOR" | null | undefined,
): boolean | undefined {
  if (printMode === "BW") return true;
  if (printMode === "COLOR") return false;
  return undefined;
}

export type PrintPdfFileOptions = {
  copies?: number;
  printMode?: "BW" | "COLOR";
  printType?: "SINGLE" | "DOUBLE";
  orientation?: "portrait" | "landscape";
  scale?: "fit" | "noscale";
  pages?: string;
  paperSize?: string;
};

/**
 * Build pdf-to-printer options (testable; no I/O).
 * Preserves existing fields and adds monochrome from printMode when known.
 */
export function buildPdfToPrinterOptions(
  printerName: string,
  options?: PrintPdfFileOptions,
) {
  const printOptions: {
    printer: string;
    silent: boolean;
    copies: number;
    scale: "fit" | "noscale";
    monochrome?: boolean;
    side?: "duplex" | "simplex";
    orientation?: "portrait" | "landscape";
    pages?: string;
    paperSize?: string;
  } = {
    printer: printerName,
    silent: true,
    copies: options?.copies && options.copies > 0 ? options.copies : 1,
    scale: options?.scale === "noscale" ? "noscale" : "fit",
  };

  const monochrome = resolveMonochrome(options?.printMode);
  if (monochrome !== undefined) {
    printOptions.monochrome = monochrome;
  }

  if (options?.printType === "DOUBLE") {
    printOptions.side = "duplex";
  }

  if (options?.orientation === "landscape") {
    printOptions.orientation = "landscape";
  }

  if (options?.pages && options.pages.trim() && options.pages !== "all") {
    printOptions.pages = options.pages.trim();
  }

  if (options?.paperSize) {
    printOptions.paperSize = options.paperSize;
  }

  return printOptions;
}

/**
 * Print a PDF on Windows via pdf-to-printer (SumatraPDF 3.4.6 bundled).
 *
 * Color/B&W: PrintJob.printMode maps to pdf-to-printer `monochrome`
 * (BW → true / COLOR → false). Sumatra supports these -print-settings flags;
 * physical Color vs B&W remains printer-driver dependent. Some Canon/XPS
 * drivers have historically produced blank pages with monochrome/simplex
 * Sumatra flags — this is not universal hardware proof.
 *
 * Orientation: landscape only when requested (portrait/legacy omit flag).
 * Scale: fit (default) or noscale (actual size).
 * Pages: optional Sumatra page list (e.g. "1-5,8").
 */
export async function printPdfFile(
  filePath: string,
  printerName: string,
  options?: PrintPdfFileOptions,
) {
  const printOptions = buildPdfToPrinterOptions(printerName, options);
  await printPdf(filePath, printOptions);
  await delay(3000);
}
