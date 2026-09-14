/**
 * Server-side ID Card Front + Back upload helpers (Phase B).
 * Validates FormData sides, composes one A4 PDF, persists a single job artifact.
 * Does not create PrintJobs — callers use createPrintJob.
 */

import path from "path";

import {
  generateIdCardA4Pdf,
  normalizeIdCardImageFormat,
} from "@/lib/id-card-layout";
import { normalizeIdCardImage } from "@/lib/id-card-image-normalizer";
import {
  deleteStoredUploadFile,
  saveGeneratedPdfFile,
  type SavedUploadFile,
} from "@/lib/upload-service";
import {
  JOB_MODE_ID_CARD_FRONT_BACK,
  JOB_MODE_NORMAL,
  parseSubmitJobMode,
  type SubmitJobMode,
} from "@/shared/job-mode";

export {
  JOB_MODE_ID_CARD_FRONT_BACK,
  JOB_MODE_NORMAL,
  parseSubmitJobMode,
  type SubmitJobMode,
};

function getExtension(fileName: string) {
  return path.extname(fileName).replace(".", "").toLowerCase();
}

function asNonEmptyFile(
  entry: FormDataEntryValue | null | undefined,
): File | null {
  if (entry instanceof File && entry.size > 0) {
    return entry;
  }
  return null;
}

function isAllowedIdCardImageFile(file: File): boolean {
  const format = normalizeIdCardImageFormat(getExtension(file.name));
  if (!format) {
    return false;
  }

  const mime = (file.type || "").toLowerCase().trim();
  if (!mime || mime === "application/octet-stream") {
    return true;
  }
  return (
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/png"
  );
}

export type IdCardFormFilesResult =
  | { ok: true; front: File; back: File }
  | { ok: false; error: string };

/**
 * Authoritative ID-card FormData validation.
 * Expects fields: front, back. Rejects extra `files` entries and bad types.
 */
export function validateIdCardFormFiles(
  formData: FormData,
): IdCardFormFilesResult {
  const fronts = formData
    .getAll("front")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const backs = formData
    .getAll("back")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const extras = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (extras.length > 0) {
    return {
      ok: false,
      error: "ID card jobs accept only front and back images.",
    };
  }

  if (fronts.length > 1 || backs.length > 1) {
    return {
      ok: false,
      error: "ID card jobs accept only one front and one back image.",
    };
  }

  const front = fronts[0] ?? asNonEmptyFile(formData.get("front"));
  const back = backs[0] ?? asNonEmptyFile(formData.get("back"));

  if (!front) {
    return {
      ok: false,
      error: "Please upload the front of the ID card.",
    };
  }
  if (!back) {
    return {
      ok: false,
      error: "Please upload the back of the ID card.",
    };
  }

  if (!isAllowedIdCardImageFile(front) || !isAllowedIdCardImageFile(back)) {
    return {
      ok: false,
      error: "ID card uploads must be JPEG or PNG images.",
    };
  }

  return { ok: true, front, back };
}

export type ComposedIdCardPdf = {
  pdfBytes: Uint8Array;
  pageCount: 1;
  widthPt: number;
  heightPt: number;
};

/**
 * Shared ID-card composition path (preview + submit).
 * Normalizes both sides then builds one A4 PDF in memory.
 * Does not write files, create jobs, or touch billing.
 */
export async function composeIdCardPdfInMemory(
  front: File,
  back: File,
): Promise<ComposedIdCardPdf> {
  const frontExt = getExtension(front.name);
  const backExt = getExtension(back.name);
  const frontBytes = new Uint8Array(await front.arrayBuffer());
  const backBytes = new Uint8Array(await back.arrayBuffer());

  const [frontNorm, backNorm] = await Promise.all([
    normalizeIdCardImage({ bytes: frontBytes, format: frontExt }),
    normalizeIdCardImage({ bytes: backBytes, format: backExt }),
  ]);

  const composed = await generateIdCardA4Pdf(
    { bytes: frontNorm.bytes, format: frontNorm.format },
    { bytes: backNorm.bytes, format: backNorm.format },
  );

  return {
    pdfBytes: composed.pdfBytes,
    pageCount: 1,
    widthPt: composed.widthPt,
    heightPt: composed.heightPt,
  };
}

/**
 * Compose front/back in memory and save ONE generated PDF for the PrintJob.
 * Raw sides are never written as PrintJobFile records.
 * Each side is normalized (EXIF + optional CV crop/warp) before A4 layout.
 */
export async function composeAndSaveIdCardPdf(
  front: File,
  back: File,
): Promise<SavedUploadFile> {
  const composed = await composeIdCardPdfInMemory(front, back);

  return saveGeneratedPdfFile({
    pdfBytes: composed.pdfBytes,
    originalFileName: "id-card-a4.pdf",
    totalPages: composed.pageCount,
  });
}

export async function cleanupIdCardArtifact(
  saved: SavedUploadFile | null | undefined,
) {
  if (!saved?.storedFileName) return;
  await deleteStoredUploadFile(saved.storedFileName);
}
