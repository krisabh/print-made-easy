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

/**
 * Detect printers installed on Windows.
 * Prefer Win32_Printer (CIM) — Get-Printer often reports Idle even when USB is unplugged.
 */
export async function detectPrinters(): Promise<DetectedPrinter[]> {
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
    scale: "fit",
  };

  if (options?.printType === "DOUBLE") {
    printOptions.side = "duplex";
  }

  await printPdf(filePath, printOptions);
  await delay(3000);
}
