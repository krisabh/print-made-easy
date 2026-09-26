/**
 * Persist interrupted PrintYantra jobs that need a Continue/Cancel decision.
 * Survives Agent restart; cleared on Continue, Cancel, or server cancellation.
 *
 * Page-safe resume stores nextPageIndex into pageList for the active PDF file.
 * Progress means "submitted to Windows spooler" (after printPdfFile returns),
 * not a physical paper sensor confirmation.
 */

import fs from "fs";
import path from "path";

import { CONFIG_PATH } from "./config";

export type PageResumeState = {
  fileId: string;
  /** 0-based index into pageList — next page to submit. */
  nextPageIndex: number;
  /** Absolute 1-based page numbers to print, in order. */
  pageList: number[];
};

export type InterruptedPrintJob = {
  jobId: string;
  jobNumber: string;
  printerName: string;
  printedFiles: number;
  remainingFiles: number;
  savedAt: string;
  /**
   * True when Continue will not re-submit already-submitted pages
   * (page-level resume or only whole unprinted single-page/files remain).
   */
  canSafelyContinue: boolean;
  /** Present when a multi-page PDF was interrupted mid-file. */
  pageResume?: PageResumeState;
  /** Human reason when Continue must be hidden. */
  unsafeReason?: string;
  /** Set after the operator chooses Continue — skip a second dialog. */
  userConfirmedContinue?: boolean;
};

function storePath() {
  return path.join(path.dirname(CONFIG_PATH), "interrupted-print-job.json");
}

export function loadInterruptedPrintJob(): InterruptedPrintJob | null {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw) as InterruptedPrintJob;
    if (
      !parsed ||
      typeof parsed.jobId !== "string" ||
      typeof parsed.jobNumber !== "string" ||
      !parsed.jobId.trim() ||
      !parsed.jobNumber.trim()
    ) {
      return null;
    }
    // Legacy interrupted records without canSafelyContinue: treat as unsafe
    // if they look like mid-file multi-page without pageResume.
    if (typeof parsed.canSafelyContinue !== "boolean") {
      parsed.canSafelyContinue = Boolean(parsed.pageResume);
      if (!parsed.canSafelyContinue) {
        parsed.unsafeReason =
          "Some pages may already have printed. To avoid duplicate pages, this job cannot be automatically resumed.";
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveInterruptedPrintJob(job: InterruptedPrintJob) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(job, null, 2), "utf8");
}

export function clearInterruptedPrintJob(jobId?: string) {
  const current = loadInterruptedPrintJob();
  if (jobId && current && current.jobId !== jobId) {
    return;
  }
  try {
    fs.unlinkSync(storePath());
  } catch {
    // missing is fine
  }
}

export function describeInterruptedProgress(info: InterruptedPrintJob): {
  title: string;
  detail: string;
  allowContinue: boolean;
} {
  if (!info.canSafelyContinue) {
    return {
      title: "Print job interrupted",
      detail: `Print job #${info.jobNumber} was interrupted.\n\n${
        info.unsafeReason ||
        "Some pages may already have printed. To avoid duplicate pages, this job cannot be automatically resumed."
      }\n\nYou can cancel the remaining job.`,
      allowContinue: false,
    };
  }

  if (info.pageResume) {
    const submitted = info.pageResume.nextPageIndex;
    const remaining =
      info.pageResume.pageList.length - info.pageResume.nextPageIndex;
    return {
      title: "Print job interrupted",
      detail: `Print job #${info.jobNumber} was interrupted.\n${submitted} page(s) were submitted for printing and ${remaining} page(s) remain.\n\nDo you want to continue printing the remaining pages?\n\nNote: “submitted” means sent to Windows — not a paper-sensor confirmation.`,
      allowContinue: true,
    };
  }

  return {
    title: "Print job interrupted",
    detail: `Print job #${info.jobNumber} was interrupted.\n${info.printedFiles} file(s) were printed and ${info.remainingFiles} file(s) remain.\n\nDo you want to continue printing the remaining files?`,
    allowContinue: true,
  };
}
