import { execFile } from "child_process";

import {
  getPrinters as getPdfToPrinterList,
  print as printPdf,
} from "pdf-to-printer";
import {
  notePrintTraceCim,
  notePrintTraceFailure,
  notePostDelayEnd,
  notePostDelayStart,
  noteSumatraExit,
  noteSumatraStart,
} from "./print-perf-trace";

export type DetectCaller =
  | "heartbeat"
  | "job-poll"
  | "window-refresh"
  | "other";

export type DetectedPrinter = {
  name: string;
  status: "Online" | "Offline" | "Unknown";
};

/** Coalesce concurrent scans; short TTL avoids PowerShell storms from UI+heartbeat. */
const DETECT_CACHE_MS = 5_000;
let detectInFlight: Promise<DetectedPrinter[]> | null = null;
let detectCache: { at: number; printers: DetectedPrinter[] } | null = null;
let detectStarts = 0;
let scanSeq = 0;
let activeScanId = 0;

/** Diagnostic only. Set when a cloud job is selected. Cleared when that job ends. */
type PrintPerfMark = {
  jobNumber: string;
  t0: number;
  t1: number;
  t2: number;
  printerCache: "hit" | "miss";
  claimMs: number;
  downloadMs: number;
  prepareMs: number;
  t3: number;
  t4: number;
};

let printPerfMark: PrintPerfMark | null = null;
let lastSumatraTiming: { page: string; t5: number; t6: number } | null = null;

export function peekPrinterDetectCache(): "hit" | "miss" {
  if (!detectCache) return "miss";
  return Date.now() - detectCache.at < DETECT_CACHE_MS ? "hit" : "miss";
}

export function notePrintPathStart(mark: {
  jobNumber: string;
  t0: number;
  t1: number;
  t2: number;
  printerCache: "hit" | "miss";
}) {
  printPerfMark = {
    ...mark,
    claimMs: 0,
    downloadMs: 0,
    prepareMs: 0,
    t3: 0,
    t4: 0,
  };
}

export function notePrintClaim(claimMs: number, at: number) {
  if (!printPerfMark) return;
  printPerfMark.claimMs = claimMs;
  printPerfMark.t3 = at;
}

export function notePrintDownload(downloadMs: number, at: number) {
  if (!printPerfMark) return;
  printPerfMark.downloadMs = downloadMs;
  printPerfMark.t4 = at;
}

export function notePrintPrepare(prepareMs: number) {
  if (!printPerfMark) return;
  printPerfMark.prepareMs = prepareMs;
}

export function clearPrintPerf() {
  printPerfMark = null;
  lastSumatraTiming = null;
}

export function logPrintPageSummary(input: {
  page: string;
  t7: number;
  spoolDetectMs: number;
  spoolBeforeMs: number;
}) {
  if (!printPerfMark || !lastSumatraTiming || input.page !== "1") return;
  const mark = printPerfMark;
  const t5 = lastSumatraTiming.t5;
  const t6 = lastSumatraTiming.t6;
  console.log(
    `[print-perf] job=${mark.jobNumber} page=1 printerCache=${mark.printerCache} printerDetectMs=${mark.t2 - mark.t1} claimMs=${mark.claimMs} downloadMs=${mark.downloadMs} prepareMs=${mark.prepareMs} preSumatraMs=${t5 - mark.t0} sumatraStartToExitMs=${t6 - t5} spoolDetectMs=${input.spoolDetectMs} spoolBeforeMs=${input.spoolBeforeMs} T0toT5=${t5 - mark.t0} T0toT1=${mark.t1 - mark.t0} T1toT2=${mark.t2 - mark.t1} T2toT3=${mark.t3 - mark.t2} T3toT4=${mark.t4 - mark.t3} T4toT5=${t5 - mark.t4} T7at=${input.t7}`,
  );
}

function printPerfElapsed(at: number) {
  return printPerfMark ? at - printPerfMark.t0 : -1;
}

export function logPrintPerf(
  event: string,
  at: number,
  fields: Record<string, string | number> = {},
) {
  const job = printPerfMark?.jobNumber ?? "none";
  const extra = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.log(
    `[print-perf] event=${event} job=${job} at=${at} elapsedFromT0=${printPerfElapsed(at)}${extra ? ` ${extra}` : ""}`,
  );
}

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
  activeScanId = 0;
  printPerfMark = null;
  lastSumatraTiming = null;
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

type ScanDiag = {
  id: number;
  caller: DetectCaller;
  startedAt: number;
  cimMs: number;
  cimResult: "success" | "timeout" | "failed" | "skipped";
  cimPrinters: number;
  fallbackMs: number;
  fallbackResult: "success" | "timeout" | "failed" | "skipped";
  fallbackPrinters: number;
};

function emptyDiag(id: number, caller: DetectCaller, startedAt: number): ScanDiag {
  return {
    id,
    caller,
    startedAt,
    cimMs: 0,
    cimResult: "skipped",
    cimPrinters: 0,
    fallbackMs: 0,
    fallbackResult: "skipped",
    fallbackPrinters: 0,
  };
}

function timeoutResult(error: unknown): "timeout" | "failed" {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("timed out") ? "timeout" : "failed";
}

function logScanSummary(diag: ScanDiag, printers: number, success: boolean) {
  const scanMs = Date.now() - diag.startedAt;
  console.log(
    `[printer-perf] caller=${diag.caller} cache=miss joined=false scan=${diag.id} scanMs=${scanMs} cimMs=${diag.cimMs} cim=${diag.cimResult} cimPrinters=${diag.cimPrinters} defaultPrinterMs=0 fallbackMs=${diag.fallbackMs} fallback=${diag.fallbackResult} fallbackPrinters=${diag.fallbackPrinters} printers=${printers} success=${success}`,
  );
}

async function detectPrintersUncached(diag: ScanDiag): Promise<DetectedPrinter[]> {
  detectStarts += 1;
  if (process.platform === "win32") {
    const cimStarted = Date.now();
    console.log(`[printer-perf] cim-start scan=${diag.id}`);
    try {
      const rows = await withTimeout(
        detectPrintersViaCim(diag.id),
        8000,
        "Win32_Printer",
      );
      diag.cimMs = Date.now() - cimStarted;
      diag.cimResult = "success";
      diag.cimPrinters = rows.length;
      console.log(
        `[printer-perf] cim-done scan=${diag.id} elapsedMs=${diag.cimMs} result=success printers=${rows.length}`,
      );
      if (rows.length > 0) {
        return rows;
      }
    } catch (error) {
      diag.cimMs = Date.now() - cimStarted;
      diag.cimResult = timeoutResult(error);
      console.log(
        `[printer-perf] cim-done scan=${diag.id} elapsedMs=${diag.cimMs} result=${diag.cimResult} printers=0`,
      );
      console.warn("CIM printer detection failed:", error);
    }
  }

  const fallbackStarted = Date.now();
  console.log(`[printer-perf] fallback-start scan=${diag.id}`);
  let printersFromLib: Array<{ name: string }> = [];
  try {
    printersFromLib = await withTimeout(
      getPdfToPrinterList(),
      8000,
      "getPrinters",
    );
    diag.fallbackMs = Date.now() - fallbackStarted;
    diag.fallbackResult = "success";
    diag.fallbackPrinters = printersFromLib.length;
    console.log(
      `[printer-perf] fallback-done scan=${diag.id} elapsedMs=${diag.fallbackMs} result=success printers=${printersFromLib.length}`,
    );
  } catch (error) {
    diag.fallbackMs = Date.now() - fallbackStarted;
    diag.fallbackResult = timeoutResult(error);
    diag.fallbackPrinters = 0;
    printersFromLib = [];
    console.log(
      `[printer-perf] fallback-done scan=${diag.id} elapsedMs=${diag.fallbackMs} result=${diag.fallbackResult} printers=0`,
    );
    console.warn("pdf-to-printer getPrinters failed:", error);
  }

  return printersFromLib.map((printer) => ({
    name: printer.name,
    status: "Unknown" as const,
  }));
}

/**
 * Detect printers installed on Windows.
 * Prefer Win32_Printer (CIM) — Get-Printer often reports Idle even when USB is unplugged.
 * Concurrent callers share one in-flight scan; results are briefly cached.
 * The Windows default printer is not queried here. First-run selection uses
 * the detected name list only.
 */

export async function detectPrinters(
  options?: { force?: boolean; caller?: DetectCaller },
): Promise<DetectedPrinter[]> {
  const caller = options?.caller ?? "other";
  const now = Date.now();
  if (
    !options?.force &&
    detectCache &&
    now - detectCache.at < DETECT_CACHE_MS
  ) {
    console.log(
      `[printer-perf] scan-start caller=${caller} cache=hit joined=false scan=0`,
    );
    console.log(
      `[printer-perf] caller=${caller} cache=hit joined=false scan=0 scanMs=${Date.now() - now} cimMs=0 cim=skipped cimPrinters=0 defaultPrinterMs=0 fallbackMs=0 fallback=skipped fallbackPrinters=0 printers=${detectCache.printers.length} success=true`,
    );
    return detectCache.printers;
  }

  if (detectInFlight) {
    console.log(
      `[printer-perf] scan-start caller=${caller} cache=miss joined=true scan=${activeScanId}`,
    );
    return detectInFlight;
  }

  const diag = emptyDiag(++scanSeq, caller, Date.now());
  activeScanId = diag.id;
  console.log(
    `[printer-perf] scan-start caller=${caller} cache=miss joined=false scan=${diag.id}`,
  );

  detectInFlight = detectPrintersUncached(diag)
    .then((printers) => {
      detectCache = { at: Date.now(), printers };
      logScanSummary(diag, printers.length, true);
      return printers;
    })
    .catch((error) => {
      logScanSummary(diag, 0, false);
      throw error;
    })
    .finally(() => {
      detectInFlight = null;
      if (activeScanId === diag.id) activeScanId = 0;
    });

  return detectInFlight;
}

/**
 * Light UI refresh only. Returns the last detected list without starting CIM,
 * including after the 5-second detectPrinters cache has expired.
 * An uninitialized cache falls through to one normal detectPrinters() call.
 * Forced scans and the 5-second cache used by heartbeat, job poll, and
 * manual refresh are unchanged.
 */
export async function readPrintersForLightRefresh(): Promise<DetectedPrinter[]> {
  if (detectCache) {
    console.log(
      `[printer-perf] caller=window-refresh cache=read joined=false scan=0 scanMs=0 cimMs=0 cim=skipped cimPrinters=0 defaultPrinterMs=0 fallbackMs=0 fallback=skipped fallbackPrinters=0 printers=${detectCache.printers.length} success=true`,
    );
    return detectCache.printers;
  }
  return detectPrinters({ caller: "window-refresh" });
}

/**
 * Same powershell.exe arguments as before. The callback logs PID and exit
 * even when withTimeout has already moved on. Nothing is killed.
 * pdf-to-printer starts its own PowerShell inside the library, so those PIDs
 * are not visible here.
 */
function execPowerShellObserved(
  scanId: number,
  label: string,
  args: string[],
): Promise<{ stdout: string }> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = execFile(
      "powershell.exe",
      args,
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        console.log(
          `[printer-perf] powershell-exit scan=${scanId} label=${label} pid=${child.pid ?? "none"} elapsedMs=${Date.now() - startedAt} exit=${error ? "error" : "ok"}`,
        );
        if (error) reject(error);
        else {
          const text = Buffer.isBuffer(stdout)
            ? stdout.toString("utf8")
            : String(stdout ?? "");
          resolve({ stdout: text });
        }
      },
    );
    console.log(
      `[printer-perf] powershell-start scan=${scanId} label=${label} pid=${child.pid ?? "none"} at=${startedAt}`,
    );
  });
}

async function detectPrintersViaCim(scanId: number): Promise<DetectedPrinter[]> {
  const command =
    "Get-CimInstance Win32_Printer | Select-Object Name, WorkOffline, PrinterStatus, PrinterState, PortName | ConvertTo-Json -Compress";

  notePrintTraceCim("start");
  let stdout: string;
  try {
    const result = await execPowerShellObserved(scanId, "cim", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ]);
    stdout = result.stdout;
    notePrintTraceCim("end", "ok");
  } catch (error) {
    notePrintTraceCim("end", "failed");
    notePrintTraceFailure("printer-detection-failure", error);
    throw error;
  }

  const trimmed = stdout.trim();
  if (!trimmed) return [];

  let parsed: WindowsPrinterRow[] | WindowsPrinterRow;
  try {
    parsed = JSON.parse(trimmed) as WindowsPrinterRow[] | WindowsPrinterRow;
  } catch (error) {
    notePrintTraceFailure("printer-detection-failure", error);
    throw error;
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows
    .filter((row) => Boolean(row.Name))
    .map((row) => ({
      name: String(row.Name),
      status: mapWindowsStatus(row),
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
  const page = options?.pages?.trim() || "all";
  const t5 = Date.now();
  logPrintPerf("T5", t5, { page, phase: "sumatra-start" });
  noteSumatraStart(page);
  try {
    await printPdf(filePath, printOptions);
  } catch (error) {
    const exitCode =
      error && typeof error === "object" && "status" in error
        ? String((error as { status?: unknown }).status ?? "error")
        : "error";
    noteSumatraExit(page, exitCode);
    notePrintTraceFailure("sumatra-failure", error);
    throw error;
  }
  const t6 = Date.now();
  lastSumatraTiming = { page, t5, t6 };
  noteSumatraExit(page, 0);
  logPrintPerf("T6", t6, {
    page,
    phase: "sumatra-exit",
    sumatraStartToExitMs: t6 - t5,
  });
  const delayStarted = Date.now();
  notePostDelayStart(page);
  await delay(3000);
  notePostDelayEnd(page);
  logPrintPerf("fixed-delay", Date.now(), {
    page,
    fixedDelayMs: Date.now() - delayStarted,
  });
}
