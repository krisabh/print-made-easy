/**
 * Image → printable A4 PDF helpers (Agent).
 * Portrait: 595×842. Landscape: 842×595. Fit without crop/stretch.
 *
 * Limitation: pdf-lib embedJpg/embedPng does not apply EXIF Orientation.
 */

import { PDFDocument } from "pdf-lib";

export type PrintableOrientation = "portrait" | "landscape";

/** PDF points (~72 dpi). Matches prior Agent conversion. */
export const A4_PORTRAIT_PT = { width: 595, height: 842 } as const;
export const A4_LANDSCAPE_PT = { width: 842, height: 595 } as const;
export const PRINTABLE_MARGIN_PT = 24;

export function a4PageSize(orientation: PrintableOrientation): {
  width: number;
  height: number;
} {
  return orientation === "landscape" ? A4_LANDSCAPE_PT : A4_PORTRAIT_PT;
}

/**
 * Uniform scale to fit inside the page content box (page minus margins).
 * Never upscales above 1; never crops; never stretches.
 */
export function fitImageOnPage(
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number,
  margin: number = PRINTABLE_MARGIN_PT,
): { width: number; height: number; x: number; y: number } {
  const maxWidth = Math.max(1, pageWidth - margin * 2);
  const maxHeight = Math.max(1, pageHeight - margin * 2);
  const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight, 1);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    width,
    height,
    x: margin + (maxWidth - width) / 2,
    y: margin + (maxHeight - height) / 2,
  };
}

export async function createImagePrintablePdf(
  bytes: Uint8Array,
  extension: string,
  orientation: PrintableOrientation = "portrait",
  marginPt: number = PRINTABLE_MARGIN_PT,
): Promise<Uint8Array> {
  const ext = extension.toLowerCase();
  const pdf = await PDFDocument.create();
  const image =
    ext === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);

  const { width: pageWidth, height: pageHeight } = a4PageSize(orientation);
  const safeMargin = Number.isFinite(marginPt) && marginPt >= 0 ? marginPt : PRINTABLE_MARGIN_PT;
  const draw = fitImageOnPage(
    image.width,
    image.height,
    pageWidth,
    pageHeight,
    safeMargin,
  );

  const page = pdf.addPage([pageWidth, pageHeight]);
  page.drawImage(image, {
    x: draw.x,
    y: draw.y,
    width: draw.width,
    height: draw.height,
  });

  return pdf.save();
}
