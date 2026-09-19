/**
 * Server-side ID Card Front + Back → one A4 portrait PDF.
 *
 * Phase A composition engine only — independent of the Electron Agent
 * image-to-PDF path. Uses pdf-lib (already in the web app).
 *
 * Known limitation: pdf-lib embedJpg/embedPng does not apply EXIF Orientation.
 * Phone photos with orientation tags may appear rotated until a later phase
 * adds safe EXIF normalization (no new dependency in Phase A).
 */

import { PDFDocument, type PDFImage } from "pdf-lib";

/** PDF points (~72 dpi). Matches Agent A4 portrait size for Sumatra. */
export const ID_CARD_A4_PORTRAIT_PT = { width: 595, height: 842 } as const;

/**
 * Outer page margin — keeps the stacked cards clear of the sheet edge.
 * Layout no longer fills A4 with half-page slots; margin is a soft bound.
 */
export const ID_CARD_PAGE_MARGIN_PT = 36;

/** Vertical gap between front (upper) and back (lower) card boxes. */
export const ID_CARD_SLOT_GAP_PT = 28;

/**
 * General ID-card MAX bounding box (PDF points) for one face on A4.
 *
 * Rationale: roughly ISO ID-1 / common government ID print size (~86×54 mm),
 * with a little headroom so Aadhaar / PAN / DL / similar cards fit without
 * forcing every upload into one exact physical dimension.
 *
 * This is a MAXIMUM fit box — not a hard crop to 85.60×53.98 mm.
 * Images keep their aspect ratio, are never stretched/cropped, and are not
 * upscaled above 1× (see fitImageInBox).
 */
export const GENERAL_ID_CARD_MAX_WIDTH_PT = 260; // ≈ 91.7 mm
export const GENERAL_ID_CARD_MAX_HEIGHT_PT = 165; // ≈ 58.2 mm

/**
 * Max bytes per source image — aligns with default MAX_UPLOAD_SIZE_MB (20).
 * Does not replace upload-service validation; guards this helper in isolation.
 */
export const ID_CARD_MAX_IMAGE_BYTES =
  Number(process.env.MAX_UPLOAD_SIZE_MB ?? 20) * 1024 * 1024;

export type IdCardImageFormat = "jpg" | "jpeg" | "png";

export type IdCardImageInput = {
  bytes: Uint8Array | Buffer;
  /** File extension or format token: jpg | jpeg | png */
  format: string;
};

export type IdCardLayoutSlot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type IdCardA4Layout = {
  page: { width: number; height: number };
  front: IdCardLayoutSlot;
  back: IdCardLayoutSlot;
};

export type GenerateIdCardA4PdfResult = {
  pdfBytes: Uint8Array;
  pageCount: 1;
  widthPt: number;
  heightPt: number;
  /** Draw boxes used for each image (for tests / debugging). */
  layout: IdCardA4Layout;
  frontDraw: { x: number; y: number; width: number; height: number };
  backDraw: { x: number; y: number; width: number; height: number };
};

/**
 * Normalize format tokens. Returns null for unsupported types (PDF/DOCX/etc.).
 */
export function normalizeIdCardImageFormat(
  format: string | undefined | null,
): IdCardImageFormat | null {
  if (!format) return null;
  const raw = format.trim().toLowerCase().replace(/^\./, "");
  if (raw === "jpg" || raw === "jpeg" || raw === "png") {
    return raw;
  }
  return null;
}

/**
 * Uniform scale to fit inside a content box.
 * Never upscales above 1; never crops; never stretches (matches Agent convention).
 */
export function fitImageInBox(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
  options?: { maxScale?: number },
): { width: number; height: number; x: number; y: number; scale: number } {
  const maxScale = options?.maxScale ?? 1;
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    throw new Error("Invalid image dimensions.");
  }
  if (
    !Number.isFinite(boxWidth) ||
    !Number.isFinite(boxHeight) ||
    boxWidth <= 0 ||
    boxHeight <= 0
  ) {
    throw new Error("Invalid layout box.");
  }

  const scale = Math.min(
    boxWidth / imageWidth,
    boxHeight / imageHeight,
    maxScale,
  );
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    width,
    height,
    scale,
    x: (boxWidth - width) / 2,
    y: (boxHeight - height) / 2,
  };
}

/**
 * Portrait A4 with two GENERAL ID-card-sized boxes (front upper, back lower).
 * Boxes are horizontally centered and stacked with a vertical gap; the pair is
 * centered vertically on the page (clamped inside page margins).
 * PDF origin is bottom-left.
 */
export function computeIdCardA4Layout(
  pageWidth: number = ID_CARD_A4_PORTRAIT_PT.width,
  pageHeight: number = ID_CARD_A4_PORTRAIT_PT.height,
  marginPt: number = ID_CARD_PAGE_MARGIN_PT,
  gapPt: number = ID_CARD_SLOT_GAP_PT,
  cardMaxWidthPt: number = GENERAL_ID_CARD_MAX_WIDTH_PT,
  cardMaxHeightPt: number = GENERAL_ID_CARD_MAX_HEIGHT_PT,
): IdCardA4Layout {
  const maxContentWidth = Math.max(1, pageWidth - marginPt * 2);
  const maxContentHeight = Math.max(1, pageHeight - marginPt * 2);

  const boxWidth = Math.min(cardMaxWidthPt, maxContentWidth);
  // Ensure two boxes + gap fit; shrink height if the page is unusually short.
  const maxPairHeight = Math.max(1, maxContentHeight - gapPt);
  const boxHeight = Math.min(cardMaxHeightPt, maxPairHeight / 2);

  const stackHeight = boxHeight * 2 + gapPt;
  const stackBottom = Math.max(
    marginPt,
    Math.min(
      pageHeight - marginPt - stackHeight,
      (pageHeight - stackHeight) / 2,
    ),
  );
  const boxX = (pageWidth - boxWidth) / 2;

  const back: IdCardLayoutSlot = {
    x: boxX,
    y: stackBottom,
    width: boxWidth,
    height: boxHeight,
  };
  const front: IdCardLayoutSlot = {
    x: boxX,
    y: stackBottom + boxHeight + gapPt,
    width: boxWidth,
    height: boxHeight,
  };

  return {
    page: { width: pageWidth, height: pageHeight },
    front,
    back,
  };
}

function toUint8Array(bytes: Uint8Array | Buffer): Uint8Array {
  if (Buffer.isBuffer(bytes)) {
    return new Uint8Array(bytes);
  }
  return bytes;
}

function assertValidImageInput(
  label: "front" | "back",
  input: IdCardImageInput | null | undefined,
): { bytes: Uint8Array; format: IdCardImageFormat } {
  if (!input) {
    throw new Error(`ID card ${label} image is required.`);
  }

  const format = normalizeIdCardImageFormat(input.format);
  if (!format) {
    throw new Error(
      `ID card ${label} must be a JPEG or PNG image.`,
    );
  }

  const bytes = toUint8Array(input.bytes);
  if (bytes.byteLength === 0) {
    throw new Error(`ID card ${label} image is empty.`);
  }
  if (bytes.byteLength > ID_CARD_MAX_IMAGE_BYTES) {
    throw new Error(
      `ID card ${label} image must be less than ${Math.round(ID_CARD_MAX_IMAGE_BYTES / (1024 * 1024))} MB.`,
    );
  }

  return { bytes, format };
}

async function embedIdCardImage(
  pdf: PDFDocument,
  bytes: Uint8Array,
  format: IdCardImageFormat,
  label: "front" | "back",
): Promise<PDFImage> {
  try {
    if (format === "png") {
      return await pdf.embedPng(bytes);
    }
    return await pdf.embedJpg(bytes);
  } catch {
    throw new Error(
      `ID card ${label} image could not be read. Use a valid JPEG or PNG.`,
    );
  }
}

/**
 * Compose FRONT + BACK images into one print-ready A4 portrait PDF page.
 * Returns PDF bytes only — does not write to disk or alter retention.
 */
export async function generateIdCardA4Pdf(
  front: IdCardImageInput | null | undefined,
  back: IdCardImageInput | null | undefined,
): Promise<GenerateIdCardA4PdfResult> {
  const frontInput = assertValidImageInput("front", front);
  const backInput = assertValidImageInput("back", back);

  const pdf = await PDFDocument.create();
  const frontImage = await embedIdCardImage(
    pdf,
    frontInput.bytes,
    frontInput.format,
    "front",
  );
  const backImage = await embedIdCardImage(
    pdf,
    backInput.bytes,
    backInput.format,
    "back",
  );

  const layout = computeIdCardA4Layout();
  const page = pdf.addPage([layout.page.width, layout.page.height]);

  const frontFit = fitImageInBox(
    frontImage.width,
    frontImage.height,
    layout.front.width,
    layout.front.height,
  );
  const backFit = fitImageInBox(
    backImage.width,
    backImage.height,
    layout.back.width,
    layout.back.height,
  );

  const frontDraw = {
    x: layout.front.x + frontFit.x,
    y: layout.front.y + frontFit.y,
    width: frontFit.width,
    height: frontFit.height,
  };
  const backDraw = {
    x: layout.back.x + backFit.x,
    y: layout.back.y + backFit.y,
    width: backFit.width,
    height: backFit.height,
  };

  page.drawImage(frontImage, frontDraw);
  page.drawImage(backImage, backDraw);

  const pdfBytes = await pdf.save();

  return {
    pdfBytes,
    pageCount: 1,
    widthPt: layout.page.width,
    heightPt: layout.page.height,
    layout,
    frontDraw,
    backDraw,
  };
}
