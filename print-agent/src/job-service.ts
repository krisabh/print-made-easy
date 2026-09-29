import fs from "fs/promises";

import {
  cancelJobOnServer,
  claimJob,
  downloadJobFile,
  fetchAgentJobQueue,
  fetchJobPrintControl,
  reportFilePrinted,
  reportJobReady,
  type PendingJob,
} from "./api-client";
import { loadConfig } from "./config";
import { clearInterruptedPrintJob, loadInterruptedPrintJob } from "./interrupted-job-store";
import {
  createImagePrintablePdf,
  type PrintableOrientation,
} from "./image-to-printable-pdf";
import { countPdfPages, resolvePrintPageList } from "./pdf-page-list";
import { planJobPrint } from "./print-settings";
import {
  abortPrintObservation,
  beginPrintObservation,
  closePrintTraceIfOpen,
  commitPrintTrace,
  finishPrintTrace,
  noteClaimStart,
  noteClaimSuccess,
  noteDownloadStart,
  noteDownloadSuccess,
  notePagePreparationEnd,
  notePagePreparationStart,
  notePreparationEnd,
  notePreparationStart,
  notePrinterCheckResult,
  notePrinterCheckStart,
  notePrinterDetectEnd,
  notePrinterDetectStart,
  notePrintTraceFailure,
  noteSpoolerEnd,
  noteSpoolerStart,
  setPrintTraceCimCapture,
  tracePrintEvent,
} from "./print-perf-trace";
import {
  clearPrintPerf,
  detectPrinters,
  getDetectPrintersStats,
  logPrintPageSummary,
  logPrintPerf,
  notePrintClaim,
  notePrintDownload,
  notePrintPathStart,
  notePrintPrepare,
  peekPrinterDetectCache,
  printPdfFile,
} from "./printer-service";
import {
  deleteFileSafe,
  getTempFilePath,
  markLocalFileActive,
  unmarkLocalFileActive,
} from "./storage-service";
import { runTestPrint as runInternalTestPrint } from "./test-print";
import {
  cancelWindowsPrintJobsForYantraJob,
  listWindowsPrintJobs,
} from "./windows-print-jobs";

const INTERRUPT_STOP_MESSAGE =
  "Printing stopped because the printer or Agent was interrupted. Remaining pages were not printed. Submit the pages you still need with a custom page range.";

/** Windows spool JobIds submitted for the active PrintYantra job. */
const spoolIdsByJobNumber = new Map<string, number[]>();

let processing = false;
let testPrintBusy = false;

export { resolvePrintPageList };

/** True while a cloud print job or test print is in progress. */
export function isPrintOperationBusy(): boolean {
  return processing || testPrintBusy;
}

export async function runTestPrint(printerName: string) {
  testPrintBusy = true;
  try {
    return await runInternalTestPrint(printerName);
  } finally {
    testPrintBusy = false;
  }
}

function trackLocalFile(localFiles: string[], filePath: string) {
  markLocalFileActive(filePath);
  localFiles.push(filePath);
}

async function ensurePrintablePdf(
  sourcePath: string,
  extension: string,
  jobNumber: string,
  fileId: string,
  orientation: PrintableOrientation,
  marginPt: number,
) {
  const ext = extension.toLowerCase();
  if (ext === "pdf") {
    return sourcePath;
  }

  if (ext === "png" || ext === "jpg" || ext === "jpeg") {
    const bytes = await fs.readFile(sourcePath);
    const pdfBytes = await createImagePrintablePdf(
      bytes,
      ext,
      orientation,
      marginPt,
    );
    const outPath = getTempFilePath(`job-${jobNumber}-${fileId}-converted.pdf`);
    await fs.writeFile(outPath, pdfBytes);
    return outPath;
  }

  throw new Error(
    `Automatic printing is not supported for .${ext} files in MVP. Use PDF.`,
  );
}

class JobCancelledError extends Error {
  constructor(message = "Job was cancelled.") {
    super(message);
    this.name = "JobCancelledError";
  }
}

class JobUnconfirmedError extends Error {
  constructor(message = "Job print status could not be confirmed.") {
    super(message);
    this.name = "JobUnconfirmedError";
  }
}

async function assertJobStillPrintable(jobId: string, jobNumber: string) {
  let control: Awaited<ReturnType<typeof fetchJobPrintControl>>;
  try {
    control = await fetchJobPrintControl(jobId);
  } catch (error) {
    console.warn(
      `Could not confirm job ${jobNumber} is still printable:`,
      error,
    );
    throw new JobUnconfirmedError(
      `Job ${jobNumber} could not be confirmed as printable.`,
    );
  }
  if (!control.ok) {
    throw new JobCancelledError(
      control.reason === "cancelled"
        ? `Job ${jobNumber} was cancelled.`
        : control.reason === "missing"
          ? `Job ${jobNumber} was deleted.`
          : `Job ${jobNumber} is no longer printable.`,
    );
  }
}

function rememberSpoolIds(jobNumber: string, jobIds: number[]) {
  if (jobIds.length === 0) return;
  const current = spoolIdsByJobNumber.get(jobNumber) || [];
  spoolIdsByJobNumber.set(jobNumber, [...new Set([...current, ...jobIds])]);
}

function spoolIdsFor(jobNumber: string) {
  return spoolIdsByJobNumber.get(jobNumber) || [];
}

async function snapshotSpoolJobIds(): Promise<Set<number>> {
  const jobs = await listWindowsPrintJobs();
  return new Set(jobs.map((job) => job.jobId));
}

async function cancelSpoolForJob(jobNumber: string, printerName: string) {
  try {
    const result = await cancelWindowsPrintJobsForYantraJob({
      jobNumber,
      printerName,
      extraJobIds: spoolIdsFor(jobNumber),
    });
    console.log(
      `Spool cancel for ${jobNumber}: matched=${result.matched} removed=${result.cancelled}${result.error ? ` error=${result.error}` : ""}`,
    );
  } catch (error) {
    console.warn("Spool cancel failed:", error);
  } finally {
    spoolIdsByJobNumber.delete(jobNumber);
  }
}

async function stopInterruptedJobOnServer(jobId: string) {
  try {
    await cancelJobOnServer(jobId, INTERRUPT_STOP_MESSAGE);
  } catch (error) {
    console.warn("Failed to stop interrupted job on server:", error);
  }
}

/**
 * Submit one PDF page and remember any new Windows spool JobIds.
 * Caller must already have confirmed the server job is still printable.
 */
async function submitPdfPage(input: {
  jobNumber: string;
  printablePath: string;
  printerName: string;
  copies: number;
  printMode: "BW" | "COLOR";
  printType: "SINGLE" | "DOUBLE";
  orientation: "portrait" | "landscape" | undefined;
  scale: "fit" | "noscale";
  pages: string;
  paperSize: string | undefined;
}) {
  notePagePreparationStart(input.pages);
  const spoolBeforeStarted = Date.now();
  const before = await snapshotSpoolJobIds();
  const spoolBeforeMs = Date.now() - spoolBeforeStarted;
  notePagePreparationEnd(input.pages);
  await printPdfFile(input.printablePath, input.printerName, {
    copies: input.copies,
    printMode: input.printMode,
    printType: input.printType,
    orientation: input.orientation,
    scale: input.scale,
    pages: input.pages,
    paperSize: input.paperSize,
  });
  noteSpoolerStart(input.pages);
  const spoolAfterStarted = Date.now();
  const after = await listWindowsPrintJobs();
  const t7 = Date.now();
  logPrintPerf("T7", t7, {
    page: input.pages,
    phase: "spool-after",
    spoolDetectMs: t7 - spoolAfterStarted,
    spoolBeforeMs,
  });
  logPrintPageSummary({
    page: input.pages,
    t7,
    spoolDetectMs: t7 - spoolAfterStarted,
    spoolBeforeMs,
  });
  const created = after
    .filter((job) => !before.has(job.jobId))
    .map((job) => job.jobId);
  rememberSpoolIds(input.jobNumber, created);
  noteSpoolerEnd(input.pages, {
    newJobs: created.length,
    windowsJobIds: created.length > 0 ? created.join(",") : "none",
    spoolBeforeMs,
  });
  if (created.length > 0) {
    console.log(
      `[spool] ${input.jobNumber} page ${input.pages} windowsJobIds=${created.join(",")}`,
    );
  }
}

/**
 * Print one PDF file page-by-page so cancellation can stop before the next page.
 * Does not persist a resume cursor. An interruption stops the job permanently.
 */
async function printPdfFilePageByPage(input: {
  jobId: string;
  jobNumber: string;
  printerName: string;
  fileId: string;
  printablePath: string;
  copies: number;
  printMode: "BW" | "COLOR";
  printType: "SINGLE" | "DOUBLE";
  orientation: "portrait" | "landscape" | undefined;
  scale: "fit" | "noscale";
  paperSize: string | undefined;
  plannedPageRange: string | undefined;
}) {
  const pageCountStarted = Date.now();
  let totalPages: number;
  try {
    totalPages = await countPdfPages(input.printablePath);
  } catch (error) {
    notePrintTraceFailure("pdf-preparation-failure", error);
    throw error;
  }
  notePreparationEnd(totalPages);
  logPrintPerf("page-count", Date.now(), {
    pageCountMs: Date.now() - pageCountStarted,
    totalPages,
  });
  const pageList = resolvePrintPageList(input.plannedPageRange, totalPages);
  if (pageList.length === 0) {
    const error = new Error("No printable pages in this PDF.");
    notePrintTraceFailure("pdf-preparation-failure", error);
    throw error;
  }

  for (let i = 0; i < pageList.length; i++) {
    await assertJobStillPrintable(input.jobId, input.jobNumber);

    const pageNumber = pageList[i];
    await submitPdfPage({
      jobNumber: input.jobNumber,
      printablePath: input.printablePath,
      printerName: input.printerName,
      copies: input.copies,
      printMode: input.printMode,
      printType: input.printType,
      orientation: input.orientation,
      scale: input.scale,
      pages: String(pageNumber),
      paperSize: input.paperSize,
    });

    console.log(
      `Submitted page ${pageNumber} (${i + 1}/${pageList.length}) for job ${input.jobNumber} file ${input.fileId}`,
    );
  }
}

async function printCloudJob(job: PendingJob, printerName: string) {
  let claimed = false;
  const localFiles: string[] = [];

  try {
    await assertJobStillPrintable(job.id, job.jobNumber);

    noteClaimStart();
    const claimStarted = Date.now();
    let claim: Awaited<ReturnType<typeof claimJob>>;
    try {
      claim = await claimJob(job.id);
    } catch (error) {
      notePrintTraceFailure("claim-failure", error);
      throw error;
    }
    const claimEnded = Date.now();
    const claimedJob = claim.job as
      | (PendingJob & {
          files?: Array<{
            id: string;
            originalFileName: string;
            fileExtension: string;
            fileSize: number;
            printedAt?: string | null;
          }>;
        })
      | null;
    if (!claimedJob) {
      await assertJobStillPrintable(job.id, job.jobNumber);
      console.warn(`Job ${job.jobNumber} was not claimed; it stays pending.`);
      notePrintTraceFailure("claim-failure", "Job was not claimed");
      finishPrintTrace("claim-failure");
      clearPrintPerf();
      return;
    }
    claimed = true;
    noteClaimSuccess();
    notePrintClaim(claimEnded - claimStarted, claimEnded);
    logPrintPerf("T3", claimEnded, {
      phase: "claim-done",
      claimMs: claimEnded - claimStarted,
    });

    await assertJobStillPrintable(claimedJob.id, claimedJob.jobNumber);

    const plan = planJobPrint(
      claimedJob.printSettings ?? job.printSettings,
      claimedJob.copies,
    );

    if (!claimedJob.files?.length) {
      throw new Error(
        "Document is no longer available on the server. Submit a new print job.",
      );
    }

    const claimedFiles = claimedJob.files as Array<{
      id: string;
      originalFileName: string;
      fileExtension: string;
      fileSize: number;
      printedAt?: string | null;
    }>;

    for (const file of claimedFiles) {
      if (file.printedAt) {
        console.log(
          `Skipping already printed file ${file.id} for job ${claimedJob.jobNumber}`,
        );
        continue;
      }

      await assertJobStillPrintable(claimedJob.id, claimedJob.jobNumber);

      const localName = `PrintYantra-${claimedJob.jobNumber}-${file.id}.${file.fileExtension}`;
      const localPath = getTempFilePath(localName);
      noteDownloadStart();
      const downloadStarted = Date.now();
      try {
        await downloadJobFile(job.id, file.id, localPath);
      } catch (error) {
        notePrintTraceFailure("download-failure", error);
        throw error;
      }
      const downloadEnded = Date.now();
      let downloadedBytes = file.fileSize;
      try {
        downloadedBytes = (await fs.stat(localPath)).size;
      } catch {
        downloadedBytes = file.fileSize;
      }
      noteDownloadSuccess(downloadedBytes);
      notePrintDownload(downloadEnded - downloadStarted, downloadEnded);
      logPrintPerf("T4", downloadEnded, {
        phase: "download-done",
        downloadMs: downloadEnded - downloadStarted,
      });
      trackLocalFile(localFiles, localPath);

      await assertJobStillPrintable(claimedJob.id, claimedJob.jobNumber);

      notePreparationStart();
      const prepareStarted = Date.now();
      let printablePath: string;
      try {
        printablePath = await ensurePrintablePdf(
          localPath,
          file.fileExtension,
          claimedJob.jobNumber,
          file.id,
          plan.imageOrientation,
          plan.imageMarginPt,
        );
      } catch (error) {
        notePrintTraceFailure("pdf-preparation-failure", error);
        throw error;
      }
      notePrintPrepare(Date.now() - prepareStarted);
      logPrintPerf("prepare", Date.now(), {
        prepareMs: Date.now() - prepareStarted,
      });
      if (printablePath !== localPath) {
        trackLocalFile(localFiles, printablePath);
      }

      const isPdf =
        file.fileExtension.toLowerCase() === "pdf" ||
        printablePath.toLowerCase().endsWith(".pdf");

      await assertJobStillPrintable(claimedJob.id, claimedJob.jobNumber);

      if (isPdf) {
        await printPdfFilePageByPage({
          jobId: claimedJob.id,
          jobNumber: claimedJob.jobNumber,
          printerName,
          fileId: file.id,
          printablePath,
          copies: claimedJob.copies,
          printMode: claimedJob.printMode,
          printType: claimedJob.printType,
          orientation: plan.sumatraOrientation,
          scale: plan.scale,
          paperSize: plan.paperSize,
          plannedPageRange: plan.pages,
        });
      } else {
        notePreparationEnd(1);
        await submitPdfPage({
          jobNumber: claimedJob.jobNumber,
          printablePath,
          printerName,
          copies: claimedJob.copies,
          printMode: claimedJob.printMode,
          printType: claimedJob.printType,
          orientation: plan.sumatraOrientation,
          scale: plan.scale,
          pages: "all",
          paperSize: plan.paperSize,
        });
      }

      await assertJobStillPrintable(claimedJob.id, claimedJob.jobNumber);

      await reportFilePrinted(job.id, file.id);
      clearInterruptedPrintJob(claimedJob.id);
      console.log(`Printed file ${file.id} for job ${claimedJob.jobNumber}`);
    }

    await reportJobReady(job.id);
    tracePrintEvent("status-ready");
    clearInterruptedPrintJob(claimedJob.id);
    spoolIdsByJobNumber.delete(job.jobNumber);
    tracePrintEvent("cleanup", { status: "ready" });
    finishPrintTrace("ready");
    clearPrintPerf();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown print failure";
    const kind =
      error instanceof JobCancelledError ? "cancellation" : "stopped";
    notePrintTraceFailure(kind, error);

    await cancelSpoolForJob(job.jobNumber, printerName);
    clearInterruptedPrintJob(job.id);

    // Once this Agent has claimed the job, any stop is permanent.
    // A shopkeeper delete is already CANCELLED; this call is idempotent.
    // A printer/Agent failure must not fall back to PENDING (that reprints).
    if (claimed || error instanceof JobCancelledError) {
      await stopInterruptedJobOnServer(job.id);
    }

    console.warn(`Stopped job ${job.jobNumber}: ${message}`);
    tracePrintEvent("cleanup", { status: kind });
    finishPrintTrace(kind);
    clearPrintPerf();
    return;
  } finally {
    for (const localPath of localFiles) {
      deleteFileSafe(localPath, {
        jobNumber: job.jobNumber,
        reason: "job cleanup",
      });
      unmarkLocalFileActive(localPath);
    }
  }
}

async function abandonOwnedPrintingJobs(
  jobs: Array<{ id: string; jobNumber: string }>,
  printerName: string,
) {
  for (const job of jobs) {
    console.log(
      `Stopping owned PRINTING job ${job.jobNumber} - automatic resume is disabled`,
    );
    await cancelSpoolForJob(job.jobNumber, printerName);
    await stopInterruptedJobOnServer(job.id);
    clearInterruptedPrintJob(job.id);
  }
}

export async function processPendingJobs() {
  if (processing) return { processed: 0, skipped: true };
  processing = true;

  try {
    const config = loadConfig();
    if (!config.authToken || !config.selectedPrinter) {
      return { processed: 0, skipped: true };
    }

    const legacyInterrupt = loadInterruptedPrintJob();
    if (legacyInterrupt) {
      console.log(
        `Clearing leftover interrupt record for ${legacyInterrupt.jobNumber} without resuming`,
      );
      await cancelSpoolForJob(
        legacyInterrupt.jobNumber,
        legacyInterrupt.printerName || config.selectedPrinter,
      );
      await stopInterruptedJobOnServer(legacyInterrupt.jobId);
      clearInterruptedPrintJob(legacyInterrupt.jobId);
    }

    const queue = await fetchAgentJobQueue();
    if (queue.ownedPrinting.length > 0) {
      await abandonOwnedPrintingJobs(
        queue.ownedPrinting,
        config.selectedPrinter,
      );
      return { processed: 0, skipped: false };
    }

    const printable = queue.jobs.filter((job) => job.files?.length > 0);
    const willTrace = printable.length > 0;
    if (willTrace) beginPrintObservation();

    const printerCache = peekPrinterDetectCache();
    const inFlightBefore = getDetectPrintersStats().inFlight;
    const printerMode =
      printerCache === "hit" ? "hit" : inFlightBefore ? "joined" : "miss";
    const detectStarted = Date.now();
    if (willTrace) {
      notePrinterCheckStart(printerMode);
      notePrinterDetectStart();
      setPrintTraceCimCapture(true);
    }
    const printers = await detectPrinters({ caller: "job-poll" }).catch(
      (error) => {
        if (willTrace) notePrintTraceFailure("printer-detection-failure", error);
        return [];
      },
    );
    setPrintTraceCimCapture(false);
    const detectEnded = Date.now();
    if (willTrace) notePrinterDetectEnd();
    const selected = printers.find(
      (printer) => printer.name === config.selectedPrinter,
    );
    if (!selected || selected.status !== "Online") {
      if (willTrace) {
        notePrinterCheckResult({
          selectedPrinter: config.selectedPrinter,
          detected: selected ? "detected" : "not-detected",
          status: selected?.status ?? "Unknown",
        });
        commitPrintTrace(printable[0].jobNumber);
        notePrintTraceFailure(
          "printer-not-ready",
          `Printer not ready (${selected?.status ?? "missing"})`,
        );
        finishPrintTrace("printer-not-ready");
      }
      console.warn(
        `Printer not ready (status: ${selected?.status ?? "missing"}) - skipping jobs.`,
      );
      return { processed: 0, skipped: true };
    }

    if (printable.length === 0) {
      abortPrintObservation();
      return { processed: 0, skipped: false };
    }

    const job = printable[0];
    notePrinterCheckResult({
      selectedPrinter: config.selectedPrinter,
      detected: "detected",
      status: selected.status,
    });
    commitPrintTrace(job.jobNumber);
    tracePrintEvent("job-selected");
    const jobStarted = Date.now();
    notePrintPathStart({
      jobNumber: job.jobNumber,
      t0: jobStarted,
      t1: detectStarted,
      t2: detectEnded,
      printerCache,
    });
    logPrintPerf("T1", detectStarted, {
      phase: "printer-detect-start",
      printerCache,
    });
    logPrintPerf("T2", detectEnded, {
      phase: "printer-detect-done",
      printerCache,
      printerDetectMs: detectEnded - detectStarted,
    });
    logPrintPerf("T0", jobStarted, { phase: "job-start" });
    console.log(`Processing job ${job.jobNumber}`);
    await printCloudJob(job, config.selectedPrinter);
    console.log(`Completed job ${job.jobNumber}`);
    return { processed: 1, skipped: false };
  } finally {
    setPrintTraceCimCapture(false);
    closePrintTraceIfOpen("interrupted");
    processing = false;
  }
}
