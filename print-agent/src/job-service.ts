import fs from "fs/promises";

import {
  cancelJobOnServer,
  claimJob,
  downloadJobFile,
  fetchJobPrintControl,
  fetchPendingJobs,
  reportFilePrinted,
  reportJobFailed,
  reportJobReady,
  type PendingJob,
} from "./api-client";
import { loadConfig } from "./config";
import {
  clearInterruptedPrintJob,
  describeInterruptedProgress,
  loadInterruptedPrintJob,
  saveInterruptedPrintJob,
  type InterruptedPrintJob,
  type PageResumeState,
} from "./interrupted-job-store";
import {
  createImagePrintablePdf,
  type PrintableOrientation,
} from "./image-to-printable-pdf";
import { countPdfPages, resolvePrintPageList } from "./pdf-page-list";
import { planJobPrint } from "./print-settings";
import { detectPrinters, printPdfFile } from "./printer-service";
import {
  deleteFileSafe,
  getTempFilePath,
  markLocalFileActive,
  unmarkLocalFileActive,
} from "./storage-service";
import { runTestPrint as runInternalTestPrint } from "./test-print";
import { cancelWindowsPrintJobsForYantraJob } from "./windows-print-jobs";

let processing = false;
let testPrintBusy = false;

export type InterruptDecision = "continue" | "cancel";

type InterruptConfirmFn = (
  info: InterruptedPrintJob,
) => Promise<InterruptDecision>;

let interruptConfirmFn: InterruptConfirmFn | null = null;

/** Wire Electron dialog from main.ts (keeps this module testable without Electron). */
export function setInterruptConfirmHandler(fn: InterruptConfirmFn | null) {
  interruptConfirmFn = fn;
}

export { describeInterruptedProgress, resolvePrintPageList };

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

async function assertJobStillPrintable(jobId: string, jobNumber: string) {
  const control = await fetchJobPrintControl(jobId);
  if (!control.ok) {
    if (control.reason === "cancelled" || control.reason === "missing") {
      throw new JobCancelledError(
        control.reason === "cancelled"
          ? `Job ${jobNumber} was cancelled.`
          : `Job ${jobNumber} was deleted.`,
      );
    }
    throw new JobCancelledError(`Job ${jobNumber} is no longer printable.`);
  }
}

async function cancelSpoolForJob(jobNumber: string, printerName: string) {
  try {
    const result = await cancelWindowsPrintJobsForYantraJob({
      jobNumber,
      printerName,
    });
    if (result.cancelled > 0) {
      console.log(
        `Cancelled ${result.cancelled} Windows spool job(s) for ${jobNumber}`,
      );
    }
  } catch (error) {
    console.warn("Spool cancel failed:", error);
  }
}

async function confirmInterruptedJob(
  info: InterruptedPrintJob,
): Promise<InterruptDecision> {
  if (!interruptConfirmFn) {
    return "cancel";
  }
  return interruptConfirmFn(info);
}

async function handleInterruptedDecision(
  info: InterruptedPrintJob,
): Promise<"continue" | "stop"> {
  if (info.userConfirmedContinue && info.canSafelyContinue) {
    return "continue";
  }

  const decision = await confirmInterruptedJob(info);
  if (decision === "continue" && info.canSafelyContinue) {
    saveInterruptedPrintJob({
      ...info,
      userConfirmedContinue: true,
      savedAt: new Date().toISOString(),
    });
    return "continue";
  }

  await cancelSpoolForJob(info.jobNumber, info.printerName);
  try {
    await cancelJobOnServer(info.jobId, "Cancelled after print interruption.");
  } catch (error) {
    console.warn("Failed to cancel interrupted job on server:", error);
  }
  clearInterruptedPrintJob(info.jobId);
  return "stop";
}

function persistPageProgress(input: {
  jobId: string;
  jobNumber: string;
  printerName: string;
  printedFiles: number;
  remainingFiles: number;
  pageResume: PageResumeState;
}) {
  saveInterruptedPrintJob({
    jobId: input.jobId,
    jobNumber: input.jobNumber,
    printerName: input.printerName,
    printedFiles: input.printedFiles,
    remainingFiles: input.remainingFiles,
    savedAt: new Date().toISOString(),
    canSafelyContinue: true,
    pageResume: input.pageResume,
  });
}

/**
 * Print one PDF file page-by-page so interruption can resume without duplicates.
 * Progress is persisted after each successful printPdfFile return (spooler accept).
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
  startPageIndex: number;
  printedFiles: number;
  remainingFiles: number;
}) {
  const totalPages = await countPdfPages(input.printablePath);
  const pageList = resolvePrintPageList(input.plannedPageRange, totalPages);
  if (pageList.length === 0) {
    throw new Error("No printable pages in this PDF.");
  }

  let startIndex = Math.max(0, Math.min(input.startPageIndex, pageList.length));

  // All pages already submitted (e.g. crash after last page, before file report).
  if (startIndex >= pageList.length) {
    return;
  }

  // Single-page PDF: one Sumatra call (same as before).
  if (pageList.length === 1) {
    await assertJobStillPrintable(input.jobId, input.jobNumber);
    await printPdfFile(input.printablePath, input.printerName, {
      copies: input.copies,
      printMode: input.printMode,
      printType: input.printType,
      orientation: input.orientation,
      scale: input.scale,
      pages: String(pageList[0]),
      paperSize: input.paperSize,
    });
    return;
  }

  for (let i = startIndex; i < pageList.length; i++) {
    await assertJobStillPrintable(input.jobId, input.jobNumber);

    const pageNumber = pageList[i];
    await printPdfFile(input.printablePath, input.printerName, {
      copies: input.copies,
      printMode: input.printMode,
      printType: input.printType,
      orientation: input.orientation,
      scale: input.scale,
      pages: String(pageNumber),
      paperSize: input.paperSize,
    });

    // Persist AFTER spooler accept so Continue starts at the next page.
    persistPageProgress({
      jobId: input.jobId,
      jobNumber: input.jobNumber,
      printerName: input.printerName,
      printedFiles: input.printedFiles,
      remainingFiles: input.remainingFiles,
      pageResume: {
        fileId: input.fileId,
        nextPageIndex: i + 1,
        pageList,
      },
    });

    console.log(
      `Submitted page ${pageNumber} (${i + 1}/${pageList.length}) for job ${input.jobNumber} file ${input.fileId}`,
    );
  }
}

async function printCloudJob(job: PendingJob, printerName: string) {
  let claimed = false;
  const localFiles: string[] = [];
  let printedBeforeFail = 0;
  let remainingAtFail = 0;
  let activePageResume: PageResumeState | null = null;

  const priorInterrupt = loadInterruptedPrintJob();
  const resumeForThisJob =
    priorInterrupt && priorInterrupt.jobId === job.id ? priorInterrupt : null;

  try {
    const claim = await claimJob(job.id);
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
      throw new Error("Job could not be claimed.");
    }
    claimed = true;

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

    const alreadyPrinted = claimedFiles.filter((f) => f.printedAt).length;
    const remaining = claimedFiles.filter((f) => !f.printedAt).length;
    printedBeforeFail = alreadyPrinted;
    remainingAtFail = remaining;

    // Ask before resuming when we have saved interrupt state or partial files.
    const alreadyConfirmed = Boolean(resumeForThisJob?.userConfirmedContinue);
    const needsConfirm =
      !alreadyConfirmed &&
      ((resumeForThisJob &&
        (resumeForThisJob.pageResume ||
          !resumeForThisJob.canSafelyContinue ||
          (alreadyPrinted > 0 && remaining > 0))) ||
        (alreadyPrinted > 0 && remaining > 0));

    if (needsConfirm) {
      const info: InterruptedPrintJob = resumeForThisJob || {
        jobId: claimedJob.id,
        jobNumber: claimedJob.jobNumber,
        printerName,
        printedFiles: alreadyPrinted,
        remainingFiles: remaining,
        savedAt: new Date().toISOString(),
        canSafelyContinue: true,
      };
      const decision = await handleInterruptedDecision(info);
      if (decision === "stop") {
        return;
      }
      activePageResume =
        loadInterruptedPrintJob()?.pageResume || info.pageResume || null;
    } else if (resumeForThisJob?.pageResume) {
      activePageResume = resumeForThisJob.pageResume;
    }

    for (const file of claimedFiles) {
      if (file.printedAt) {
        console.log(
          `Skipping already printed file ${file.id} for job ${claimedJob.jobNumber}`,
        );
        continue;
      }

      await assertJobStillPrintable(claimedJob.id, claimedJob.jobNumber);

      const localName = `job-${claimedJob.jobNumber}-${file.id}.${file.fileExtension}`;
      const localPath = getTempFilePath(localName);
      await downloadJobFile(job.id, file.id, localPath);
      trackLocalFile(localFiles, localPath);

      await assertJobStillPrintable(claimedJob.id, claimedJob.jobNumber);

      const printablePath = await ensurePrintablePdf(
        localPath,
        file.fileExtension,
        claimedJob.jobNumber,
        file.id,
        plan.imageOrientation,
        plan.imageMarginPt,
      );
      if (printablePath !== localPath) {
        trackLocalFile(localFiles, printablePath);
      }

      const isPdf =
        file.fileExtension.toLowerCase() === "pdf" ||
        printablePath.toLowerCase().endsWith(".pdf");

      await assertJobStillPrintable(claimedJob.id, claimedJob.jobNumber);

      if (isPdf) {
        const startPageIndex =
          activePageResume && activePageResume.fileId === file.id
            ? activePageResume.nextPageIndex
            : 0;
        // Consume resume for this file only once.
        if (activePageResume && activePageResume.fileId === file.id) {
          activePageResume = null;
        }

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
          startPageIndex,
          printedFiles: printedBeforeFail,
          remainingFiles: remainingAtFail,
        });
      } else {
        await printPdfFile(printablePath, printerName, {
          copies: claimedJob.copies,
          printMode: claimedJob.printMode,
          printType: claimedJob.printType,
          orientation: plan.sumatraOrientation,
          scale: plan.scale,
          paperSize: plan.paperSize,
        });
      }

      await assertJobStillPrintable(claimedJob.id, claimedJob.jobNumber);

      await reportFilePrinted(job.id, file.id);
      printedBeforeFail += 1;
      remainingAtFail = Math.max(0, remainingAtFail - 1);
      clearInterruptedPrintJob(claimedJob.id);
      console.log(`Printed file ${file.id} for job ${claimedJob.jobNumber}`);
    }

    await reportJobReady(job.id);
    clearInterruptedPrintJob(claimedJob.id);
  } catch (error) {
    const cancelled = error instanceof JobCancelledError;
    const message =
      error instanceof Error ? error.message : "Unknown print failure";

    await cancelSpoolForJob(job.jobNumber, printerName);

    if (cancelled) {
      clearInterruptedPrintJob(job.id);
      console.warn(`Stopped cancelled job ${job.jobNumber}: ${message}`);
      return;
    }

    if (claimed && remainingAtFail > 0) {
      const existing = loadInterruptedPrintJob();
      const pageResume =
        existing && existing.jobId === job.id ? existing.pageResume : undefined;

      if (pageResume) {
        // Keep pageResume even when nextPageIndex === length (file pages done;
        // Continue skips reprint and reports the file). Mid-file → remaining pages only.
        saveInterruptedPrintJob({
          jobId: job.id,
          jobNumber: job.jobNumber,
          printerName,
          printedFiles: printedBeforeFail,
          remainingFiles: remainingAtFail,
          savedAt: new Date().toISOString(),
          canSafelyContinue: true,
          pageResume,
        });
      } else if (printedBeforeFail > 0) {
        // Next whole files remain — safe file-level continue.
        saveInterruptedPrintJob({
          jobId: job.id,
          jobNumber: job.jobNumber,
          printerName,
          printedFiles: printedBeforeFail,
          remainingFiles: remainingAtFail,
          savedAt: new Date().toISOString(),
          canSafelyContinue: true,
        });
      } else {
        // Interrupted before any page progress on the first remaining file —
        // Continue would resubmit from page 1 (acceptable for never-started).
        // If we cannot prove no pages left the spooler, Prefer cancel-only only
        // for legacy records without pageResume that claim mid-file work.
        saveInterruptedPrintJob({
          jobId: job.id,
          jobNumber: job.jobNumber,
          printerName,
          printedFiles: printedBeforeFail,
          remainingFiles: remainingAtFail,
          savedAt: new Date().toISOString(),
          canSafelyContinue: true,
        });
      }
    }

    if (claimed) {
      try {
        await reportJobFailed(job.id, message);
      } catch (reportError) {
        console.error("Failed to report job failure:", reportError);
      }
    }
    throw error;
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

export async function processPendingJobs() {
  if (processing) return { processed: 0, skipped: true };
  processing = true;

  try {
    const config = loadConfig();
    if (!config.authToken || !config.selectedPrinter) {
      return { processed: 0, skipped: true };
    }

    const interrupted = loadInterruptedPrintJob();
    if (interrupted) {
      const control = await fetchJobPrintControl(interrupted.jobId).catch(
        () => ({ ok: false as const, reason: "missing" as const }),
      );
      if (
        !control.ok &&
        (control.reason === "cancelled" || control.reason === "missing")
      ) {
        await cancelSpoolForJob(
          interrupted.jobNumber,
          interrupted.printerName || config.selectedPrinter,
        );
        clearInterruptedPrintJob(interrupted.jobId);
      } else {
        const decision = await handleInterruptedDecision({
          ...interrupted,
          printerName: interrupted.printerName || config.selectedPrinter,
        });
        if (decision === "stop") {
          return { processed: 0, skipped: false };
        }
        // Continue: fall through so claim/print resumes with pageResume still saved.
      }
    }

    const printers = await detectPrinters().catch(() => []);
    const selected = printers.find(
      (printer) => printer.name === config.selectedPrinter,
    );
    if (!selected || selected.status !== "Online") {
      console.warn(
        `Printer not ready (status: ${selected?.status ?? "missing"}) — skipping jobs.`,
      );
      return { processed: 0, skipped: true };
    }

    const jobs = await fetchPendingJobs();
    const printable = jobs.filter((job) => job.files?.length > 0);
    if (printable.length === 0) {
      return { processed: 0, skipped: false };
    }

    const job = printable[0];
    console.log(`Processing job ${job.jobNumber}`);
    await printCloudJob(job, config.selectedPrinter);
    console.log(`Completed job ${job.jobNumber}`);
    return { processed: 1, skipped: false };
  } finally {
    processing = false;
  }
}
