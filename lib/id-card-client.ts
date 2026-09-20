/**
 * Client-safe ID Card helpers (Phase C).
 * No fs / pdf-lib — safe to import from upload-form.
 */

import {
  DEFAULT_MAX_UPLOAD_SIZE_MB,
  getMaxUploadSizeBytes,
  maxUploadSizeErrorMessage,
} from "./upload-limits";
import {
  JOB_MODE_ID_CARD_FRONT_BACK,
  JOB_MODE_NORMAL,
  type SubmitJobMode,
} from "../shared/job-mode";

export {
  JOB_MODE_ID_CARD_FRONT_BACK,
  JOB_MODE_NORMAL,
  type SubmitJobMode,
} from "../shared/job-mode";

const ID_CARD_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);

export function extensionFromName(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? (parts.pop() as string).toLowerCase() : "";
}

/** UX-only check — server remains authoritative. */
export function isIdCardImageFile(file: File): boolean {
  const ext = extensionFromName(file.name);
  if (!ID_CARD_EXTENSIONS.has(ext)) return false;
  const mime = (file.type || "").toLowerCase().trim();
  if (!mime || mime === "application/octet-stream") return true;
  return (
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/png"
  );
}

export function validateIdCardClientSides(
  front: File | null | undefined,
  back: File | null | undefined,
  maxUploadSizeMb: number = DEFAULT_MAX_UPLOAD_SIZE_MB,
): string | null {
  if (!front) return "Please upload the front of the ID card.";
  if (!back) return "Please upload the back of the ID card.";
  if (!isIdCardImageFile(front) || !isIdCardImageFile(back)) {
    return "ID card uploads must be JPEG or PNG images.";
  }
  const maxBytes = getMaxUploadSizeBytes(maxUploadSizeMb);
  if (front.size > maxBytes || back.size > maxBytes) {
    return maxUploadSizeErrorMessage(maxUploadSizeMb);
  }
  return null;
}

/** ID-card jobs always bill as one composed A4 page. */
export function idCardBillablePages(): 1 {
  return 1;
}

export function buildIdCardSubmitFormData(input: {
  shopCode: string;
  copies: number;
  printMode: "BW" | "COLOR";
  front: File;
  back: File;
}): FormData {
  const formData = new FormData();
  formData.set("shopCode", input.shopCode);
  formData.set("copies", String(input.copies));
  formData.set("printMode", input.printMode);
  formData.set("jobMode", JOB_MODE_ID_CARD_FRONT_BACK);
  formData.set("orientation", "portrait");
  formData.set("scale", "fit");
  formData.set("margins", "normal");
  formData.set("pagesMode", "all");
  formData.set("pageRange", "");
  formData.set("front", input.front);
  formData.set("back", input.back);
  return formData;
}

/** Preview-only FormData — no copies/pricing fields required by the server. */
export function buildIdCardPreviewFormData(input: {
  shopCode: string;
  front: File;
  back: File;
}): FormData {
  const formData = new FormData();
  formData.set("shopCode", input.shopCode);
  formData.set("front", input.front);
  formData.set("back", input.back);
  return formData;
}

export function resolveUploadJobMode(mode: SubmitJobMode): SubmitJobMode {
  return mode === JOB_MODE_ID_CARD_FRONT_BACK
    ? JOB_MODE_ID_CARD_FRONT_BACK
    : JOB_MODE_NORMAL;
}
