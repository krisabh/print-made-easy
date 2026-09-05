/**
 * Canonical upload file categorization for print UI (Phase C).
 * Aligns with lib/upload-service allowlist: pdf, docx, png, jpg, jpeg.
 * "doc" is recognized as DOCUMENT for classification but is not uploadable today.
 */

/** Per-file category (never MIXED). */
export type PrintFileCategory = "DOCUMENT" | "IMAGE";

/**
 * Job-level aggregate derived from ALL current uploads.
 * Source of truth is the files list — do not persist this independently.
 */
export type AggregatePrintFileCategory =
  | "NONE"
  | "DOCUMENT"
  | "IMAGE"
  | "MIXED";

export type PrintFileKind =
  | "pdf"
  | "doc"
  | "docx"
  | "jpg"
  | "jpeg"
  | "png"
  | "unknown";

const DOCUMENT_EXTS = new Set(["pdf", "doc", "docx"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg"]);

const MIME_TO_KIND: Record<string, PrintFileKind> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "image/jpeg": "jpeg",
  "image/jpg": "jpg",
  "image/png": "png",
};

export function extensionFromFileName(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? (parts.pop() as string).toLowerCase() : "";
}

export function kindFromExtension(extension: string): PrintFileKind {
  const ext = extension.toLowerCase();
  if (
    ext === "pdf" ||
    ext === "doc" ||
    ext === "docx" ||
    ext === "png" ||
    ext === "jpg" ||
    ext === "jpeg"
  ) {
    return ext;
  }
  return "unknown";
}

export function kindFromMime(mime: string | undefined | null): PrintFileKind | null {
  if (!mime) return null;
  return MIME_TO_KIND[mime.toLowerCase()] ?? null;
}

export function categoryFromKind(kind: PrintFileKind): PrintFileCategory | null {
  if (kind === "unknown") return null;
  if (DOCUMENT_EXTS.has(kind)) return "DOCUMENT";
  if (IMAGE_EXTS.has(kind)) return "IMAGE";
  return null;
}

export function categorizeExtension(extension: string): PrintFileCategory | null {
  return categoryFromKind(kindFromExtension(extension));
}

/**
 * Prefer extension (matches upload-service validation). MIME is a soft hint
 * when extension is missing/unknown.
 */
export function categorizeUploadFile(file: {
  name: string;
  type?: string;
}): {
  extension: string;
  kind: PrintFileKind;
  category: PrintFileCategory | null;
} {
  const extension = extensionFromFileName(file.name);
  let kind = kindFromExtension(extension);
  if (kind === "unknown") {
    const fromMime = kindFromMime(file.type);
    if (fromMime) kind = fromMime;
  }
  return {
    extension,
    kind,
    category: categoryFromKind(kind),
  };
}

/**
 * Derive job-level UI category from ALL uploaded files.
 * Recalculate whenever the files list changes — never cache independently.
 *
 * - NONE: no files
 * - DOCUMENT: every categorized file is a document
 * - IMAGE: every categorized file is an image
 * - MIXED: both document and image present (or unknown mixes with either)
 */
export function resolveJobPrintCategory(
  files: Array<{ name: string; type?: string }>,
): AggregatePrintFileCategory {
  if (files.length === 0) return "NONE";

  let hasDocument = false;
  let hasImage = false;

  for (const file of files) {
    const category = categorizeUploadFile(file).category;
    if (category === "DOCUMENT") hasDocument = true;
    else if (category === "IMAGE") hasImage = true;
    else {
      // Unknown type: treat conservatively as mixed-capable noise → MIXED
      // if anything else is present; alone stays DOCUMENT UI baseline.
      hasDocument = true;
    }
  }

  if (hasDocument && hasImage) return "MIXED";
  if (hasImage) return "IMAGE";
  return "DOCUMENT";
}

export function isAutoPrintSupportedKind(kind: PrintFileKind): boolean {
  return kind === "pdf" || kind === "png" || kind === "jpg" || kind === "jpeg";
}

export function jobHasUnsupportedAutoPrint(
  files: Array<{ name: string; type?: string }>,
): boolean {
  return files.some((f) => {
    const { kind } = categorizeUploadFile(f);
    return kind === "doc" || kind === "docx";
  });
}
