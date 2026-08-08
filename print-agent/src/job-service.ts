import { PDFDocument } from "pdf-lib";
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
) {
  const ext = extension.toLowerCase();
  if (ext === "pdf") {
    return sourcePath;
  }

  if (ext === "png" || ext === "jpg" || ext === "jpeg") {
    const bytes = await fs.readFile(sourcePath);
    const pdf = await PDFDocument.create();
    const image =
      ext === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);

    // Fit image onto A4 so Canon drivers don't get a huge/odd page size.
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 24;
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;

    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(image, {
      x,
      y,
      width: drawWidth,
      height: drawHeight,
    });
    const outPath = getTempFilePath(`job-${jobNumber}-${fileId}-converted.pdf`);
    await fs.writeFile(outPath, await pdf.save());
    return outPath;
  }

  throw new Error(
    `Automatic printing is not supported for .${ext} files in MVP. Use PDF.`,
  );
}

async function printCloudJob(job: PendingJob, printerName: string) {
  let claimed = false;
  const localFiles: string[] = [];
  let printed = false;

  try {
    const claim = await claimJob(job.id);
    const claimedJob = claim.job;
    if (!claimedJob) {
      throw new Error("Job could not be claimed.");
    }
    claimed = true;

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
      );
      if (printablePath !== localPath) {
        localFiles.push(printablePath);
      }

      await printPdfFile(printablePath, printerName, {
        copies: claimedJob.copies,
        printMode: claimedJob.printMode,
        printType: claimedJob.printType,
      });

      await reportFilePrinted(job.id, file.id);
      console.log(`Printed file ${file.originalFileName}`);
    }

    printed = true;
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

    // Printer detection can time out; only skip when we know the printer is Offline.
    const printers = await detectPrinters().catch(() => []);
    const selected = printers.find(
      (printer) => printer.name === config.selectedPrinter,
    );
    if (selected?.status === "Offline") {
      console.warn(
        "Printer offline — skipping job poll until printer is ready.",
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
