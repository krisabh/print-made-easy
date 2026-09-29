/**
 * Diagnostic timeline for one cloud print. Logging only.
 * Does not change print, cancellation, or printer-detection behavior.
 */
import { randomBytes } from "crypto";
import fs from "fs/promises";
import path from "path";
import { performance } from "perf_hooks";

const PRINT_PERF_LOG_PATH = path.join(
  "C:\\ProgramData",
  "PrintYantra",
  "logs",
  "print-performance.log",
);

let fileWriteChain: Promise<void> = Promise.resolve();

type PageTiming = {
  sumatraMs: number;
  postDelayMs: number;
  spoolerMs: number;
  sumatraStartElapsed: number;
};

type BufferedEvent = {
  event: string;
  fields: Record<string, string | number>;
  page?: string;
  wall: string;
  elapsedMs: number;
};

type Observation = {
  id: string;
  jobNumber: string;
  origin: number;
  committed: boolean;
  buffer: BufferedEvent[];
  fileLines: string[];
  printerCheckStarted: number;
  printerDetectStarted: number;
  printerCheckMs: number;
  printerDetectMs: number;
  printerMode: "hit" | "miss" | "joined";
  claimStarted: number;
  claimMs: number;
  downloadStarted: number;
  downloadMs: number;
  preparationStarted: number;
  preparationMs: number;
  pages: Map<string, PageTiming>;
  pagePrepStarted: Map<string, number>;
  sumatraStarted: Map<string, number>;
  delayStarted: Map<string, number>;
  spoolerStarted: Map<string, number>;
  cimStarted: number;
};

let observation: Observation | null = null;
let captureCim = false;

export function setPrintTraceCimCapture(enabled: boolean) {
  captureCim = enabled;
}

function newObservation(): Observation {
  return {
    id: randomBytes(3).toString("hex"),
    jobNumber: "pending",
    origin: performance.now(),
    committed: false,
    buffer: [],
    fileLines: [],
    printerCheckStarted: 0,
    printerDetectStarted: 0,
    printerCheckMs: 0,
    printerDetectMs: 0,
    printerMode: "miss",
    claimStarted: 0,
    claimMs: 0,
    downloadStarted: 0,
    downloadMs: 0,
    preparationStarted: 0,
    preparationMs: 0,
    pages: new Map(),
    pagePrepStarted: new Map(),
    sumatraStarted: new Map(),
    delayStarted: new Map(),
    spoolerStarted: new Map(),
    cimStarted: 0,
  };
}

function elapsedMs() {
  if (!observation) return -1;
  return Math.round(performance.now() - observation.origin);
}

function wallClock() {
  return new Date().toISOString();
}

function formatFields(fields: Record<string, string | number>) {
  return Object.entries(fields)
    .map(([key, value]) => {
      const text = String(value).replace(/"/g, "'");
      return /[\s]/.test(text) ? `${key}="${text}"` : `${key}=${text}`;
    })
    .join(" ");
}

function publish(line: string) {
  console.log(line);
  if (observation?.committed) observation.fileLines.push(line);
}

function schedulePrintPerfFlush(lines: string[]) {
  if (lines.length === 0) return;
  const payload = `${lines.join("\n")}\n`;
  fileWriteChain = fileWriteChain
    .then(() => fs.mkdir(path.dirname(PRINT_PERF_LOG_PATH), { recursive: true }))
    .then(() => fs.appendFile(PRINT_PERF_LOG_PATH, payload, "utf8"))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "write failed";
      console.warn(`Print performance log write failed: ${message}`);
    });
}

function lineFor(
  event: string,
  fields: Record<string, string | number>,
  page: string | undefined,
  wall: string,
  elapsed: number,
) {
  if (!observation) return;
  const pagePart = page ? ` page=${page}` : "";
  const extra = formatFields(fields);
  publish(
    `[print-perf][job=${observation.jobNumber}][trace=${observation.id}] wall=${wall} elapsedMs=${elapsed} event=${event}${pagePart}${extra ? ` ${extra}` : ""}`,
  );
}

function emit(
  event: string,
  fields: Record<string, string | number> = {},
  page?: string,
) {
  if (!observation) return;
  const record: BufferedEvent = {
    event,
    fields,
    page,
    wall: wallClock(),
    elapsedMs: elapsedMs(),
  };
  if (!observation.committed) {
    observation.buffer.push(record);
    return;
  }
  lineFor(record.event, record.fields, record.page, record.wall, record.elapsedMs);
}

/** Start observing a poll that may print. Discarded if no job is selected. */
export function beginPrintObservation() {
  observation = newObservation();
  emit("job-processing-start");
}

export function abortPrintObservation() {
  observation = null;
  captureCim = false;
}

export function commitPrintTrace(jobNumber: string) {
  if (!observation || observation.committed) {
    if (observation) observation.jobNumber = jobNumber;
    return;
  }
  observation.jobNumber = jobNumber;
  observation.committed = true;
  publish("[print-perf] ===== PRINT PERFORMANCE TRACE START =====");
  const pending = observation.buffer;
  observation.buffer = [];
  for (const record of pending) {
    lineFor(record.event, record.fields, record.page, record.wall, record.elapsedMs);
  }
}

export function tracePrintEvent(
  event: string,
  fields: Record<string, string | number> = {},
  page?: string,
) {
  emit(event, fields, page);
}

export function notePrinterCheckStart(mode: "hit" | "miss" | "joined") {
  if (!observation) return;
  observation.printerMode = mode;
  observation.printerCheckStarted = performance.now();
  emit("printer-check-start", { mode });
  if (mode === "hit") emit("printer-check-cache-hit");
  else if (mode === "joined") emit("printer-check-joined-in-flight");
  else emit("printer-check-cache-miss");
}

export function notePrinterDetectStart() {
  if (!observation) return;
  observation.printerDetectStarted = performance.now();
  emit("printer-detect-start");
}

export function notePrinterDetectEnd() {
  if (!observation) return;
  observation.printerDetectMs = Math.round(
    performance.now() - observation.printerDetectStarted,
  );
  emit("printer-detect-end", { printerDetectMs: observation.printerDetectMs });
}

export function notePrintTraceCim(phase: "start" | "end", result?: string) {
  if (!observation || !captureCim) return;
  if (phase === "start") {
    observation.cimStarted = performance.now();
    emit("cim-printer-query-start");
    return;
  }
  const cimMs = observation.cimStarted
    ? Math.round(performance.now() - observation.cimStarted)
    : 0;
  emit("cim-printer-query-end", { cimMs, result: result || "ok" });
}

export function notePrinterCheckResult(fields: Record<string, string | number>) {
  if (!observation) return;
  observation.printerCheckMs = observation.printerCheckStarted
    ? Math.round(performance.now() - observation.printerCheckStarted)
    : 0;
  emit("printer-check-result", {
    ...fields,
    printerCheckMs: observation.printerCheckMs,
    printerDetectMs: observation.printerDetectMs,
    printerMode: observation.printerMode,
  });
}

export function noteClaimStart() {
  if (!observation) return;
  observation.claimStarted = performance.now();
  emit("claim-start");
}

export function noteClaimSuccess() {
  if (!observation) return;
  observation.claimMs = Math.round(performance.now() - observation.claimStarted);
  emit("claim-success", { claimMs: observation.claimMs });
}

export function noteDownloadStart() {
  if (!observation) return;
  observation.downloadStarted = performance.now();
  emit("download-start");
}

export function noteDownloadSuccess(bytes: number) {
  if (!observation) return;
  const segmentMs = Math.round(
    performance.now() - observation.downloadStarted,
  );
  observation.downloadMs += segmentMs;
  emit("download-success", { bytes, downloadMs: observation.downloadMs });
}

export function notePreparationStart() {
  if (!observation) return;
  observation.preparationStarted = performance.now();
  emit("PDF-preparation-start");
}

export function notePreparationEnd(pageCount: number) {
  if (!observation) return;
  const segmentMs = Math.round(
    performance.now() - observation.preparationStarted,
  );
  observation.preparationMs += segmentMs;
  emit("PDF-preparation-end", {
    pageCount,
    preparationMs: observation.preparationMs,
  });
}

function pageSlot(page: string): PageTiming {
  const existing = observation?.pages.get(page);
  if (existing) return existing;
  const created = {
    sumatraMs: 0,
    postDelayMs: 0,
    spoolerMs: 0,
    sumatraStartElapsed: 0,
  };
  observation?.pages.set(page, created);
  return created;
}

export function notePagePreparationStart(page: string) {
  if (observation) observation.pagePrepStarted.set(page, performance.now());
  emit(`page-${page}-preparation-start`, {}, page);
}

export function notePagePreparationEnd(page: string) {
  const started = observation?.pagePrepStarted.get(page) ?? performance.now();
  const preparationMs = Math.round(performance.now() - started);
  emit(`page-${page}-preparation-end`, { preparationMs }, page);
}

export function noteSumatraStart(page: string) {
  if (!observation) return;
  observation.sumatraStarted.set(page, performance.now());
  const slot = pageSlot(page);
  slot.sumatraStartElapsed = elapsedMs();
  emit(`page-${page}-sumatra-start`, {}, page);
}

export function noteSumatraExit(page: string, exitCode: number | string) {
  if (!observation) return;
  const started = observation.sumatraStarted.get(page) ?? performance.now();
  const sumatraMs = Math.round(performance.now() - started);
  pageSlot(page).sumatraMs = sumatraMs;
  emit(`page-${page}-sumatra-exit`, { exitCode, sumatraMs }, page);
}

export function notePostDelayStart(page: string) {
  if (!observation) return;
  observation.delayStarted.set(page, performance.now());
  emit(`page-${page}-post-sumatra-delay-start`, {}, page);
}

export function notePostDelayEnd(page: string) {
  if (!observation) return;
  const started = observation.delayStarted.get(page) ?? performance.now();
  const postDelayMs = Math.round(performance.now() - started);
  pageSlot(page).postDelayMs = postDelayMs;
  emit(`page-${page}-post-sumatra-delay-end`, { postDelayMs }, page);
}

export function noteSpoolerStart(page: string) {
  if (!observation) return;
  observation.spoolerStarted.set(page, performance.now());
  emit(`page-${page}-spooler-observation-start`, {}, page);
}

export function noteSpoolerEnd(
  page: string,
  fields: Record<string, string | number>,
) {
  if (!observation) return;
  const started = observation.spoolerStarted.get(page) ?? performance.now();
  const spoolerMs = Math.round(performance.now() - started);
  pageSlot(page).spoolerMs = spoolerMs;
  emit(
    `page-${page}-spooler-observation-end`,
    { ...fields, spoolerMs },
    page,
  );
}

export function notePrintTraceFailure(kind: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error ?? kind);
  const safe = message.replace(/[\r\n]+/g, " ").slice(0, 180);
  emit(kind, { elapsedMs: elapsedMs(), message: safe });
}

export function notePrintTraceSpoolFailure(message: string) {
  if (!observation) return;
  notePrintTraceFailure("spooler-query-failure", message);
}

function pageMetric(page: string, key: keyof PageTiming) {
  return observation?.pages.get(page)?.[key] ?? 0;
}

export function finishPrintTrace(status: string) {
  if (!observation) return;
  if (!observation.committed) {
    observation = null;
    return;
  }
  emit("job-print-complete", { status, totalJobMs: elapsedMs() });
  const summary = [
    `totalJobMs=${elapsedMs()}`,
    `printerCheckMs=${observation.printerCheckMs}`,
    `printerDetectMs=${observation.printerDetectMs}`,
    `printerMode=${observation.printerMode}`,
    `claimMs=${observation.claimMs}`,
    `downloadMs=${observation.downloadMs}`,
    `preparationMs=${observation.preparationMs}`,
    `page1SumatraMs=${pageMetric("1", "sumatraMs")}`,
    `page1PostDelayMs=${pageMetric("1", "postDelayMs")}`,
    `page1SpoolerMs=${pageMetric("1", "spoolerMs")}`,
    `page2SumatraMs=${pageMetric("2", "sumatraMs")}`,
    `page2PostDelayMs=${pageMetric("2", "postDelayMs")}`,
    `page2SpoolerMs=${pageMetric("2", "spoolerMs")}`,
    `page3SumatraMs=${pageMetric("3", "sumatraMs")}`,
    `page3PostDelayMs=${pageMetric("3", "postDelayMs")}`,
    `page3SpoolerMs=${pageMetric("3", "spoolerMs")}`,
    `totalTimeToPage1SumatraMs=${pageMetric("1", "sumatraStartElapsed")}`,
    `totalTimeToPage2SumatraMs=${pageMetric("2", "sumatraStartElapsed")}`,
    `totalTimeToPage3SumatraMs=${pageMetric("3", "sumatraStartElapsed")}`,
  ].join(" ");
  const summaryLine = `[print-perf][job=${observation.jobNumber}][trace=${observation.id}] SUMMARY ${summary}`;
  publish(summaryLine);
  publish("[print-perf] ===== PRINT PERFORMANCE TRACE END =====");
  const lines = observation.fileLines;
  observation = null;
  captureCim = false;
  schedulePrintPerfFlush(lines);
}

/** Closes a committed trace. Discards an observation that never selected a job. */
export function closePrintTraceIfOpen(status: string) {
  if (!observation) return;
  if (!observation.committed) {
    abortPrintObservation();
    return;
  }
  finishPrintTrace(status);
}
