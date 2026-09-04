import fs from "fs/promises";

import {
  claimJob,
  downloadJobFile,
  fetchPendingJobs,
  reportFilePrinted,
  reportJobFailed,
  reportJobReady,
  type PendingJob,
} from "./api-client";
import { loadConfig } from "./config";
import {
  createImagePrintablePdf,
  type PrintableOrientation,
} from "./image-to-printable-pdf";
import { planJobPrint } from "./print-settings";
import { detectPrinters, printPdfFile } from "./printer-service";
import { deleteFileSafe, getTempFilePath } from "./storage-service";
import { runTestPrint as runInternalTestPrint } from "./test-print";

let processing = false;

export async function runTestPrint(printerName: string) {
  return runInternalTestPrint(printerName);
}

async function ensurePrintablePdf(
  sourcePath: string,
  extension: string,
  jobNumber: string,
  fileId: string,
  orientation: PrintableOrientation,
) {
  const ext = extension.toLowerCase();
  if (ext === "pdf") {
    return sourcePath;
  }

  if (ext === "png" || ext === "jpg" || ext === "jpeg") {
    const bytes = await fs.readFile(sourcePath);
    const pdfBytes = await createImagePrintablePdf(bytes, ext, orientation);
    const outPath = getTempFilePath(`job-${jobNumber}-${fileId}-converted.pdf`);
    await fs.writeFile(outPath, pdfBytes);
    return outPath;
  }

  throw new Error(
    `Automatic printing is not supported for .${ext} files in MVP. Use PDF.`,
  );
}

async function printCloudJob(job: PendingJob, printerName: string) {
  let claimed = false;
  const localFiles: string[] = [];

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

    for (const file of claimedJob.files) {
      if (file.printedAt) {
        console.log(
          `Skipping already printed file ${file.originalFileName} for ${claimedJob.jobNumber}`,
        );
        continue;
      }

      const localName = `job-${claimedJob.jobNumber}-${file.id}.${file.fileExtension}`;
      const localPath = getTempFilePath(localName);
      await downloadJobFile(job.id, file.id, localPath);
      localFiles.push(localPath);

      const printablePath = await ensurePrintablePdf(
        localPath,
        file.fileExtension,
        claimedJob.jobNumber,
        file.id,
        plan.imageOrientation,
      );
      if (printablePath !== localPath) {
        localFiles.push(printablePath);
      }

      // PrintJob.copies remains the print-count source of truth (matches pricing).
      await printPdfFile(printablePath, printerName, {
        copies: claimedJob.copies,
        printMode: claimedJob.printMode,
        printType: claimedJob.printType,
        orientation: plan.sumatraOrientation,
      });

      await reportFilePrinted(job.id, file.id);
      console.log(`Printed file ${file.originalFileName}`);
    }

    await reportJobReady(job.id);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown print failure";
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
      deleteFileSafe(localPath);
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

    // Only print when Windows reports the selected printer as Online.
    // Installed-but-unplugged USB printers must not claim jobs.
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
