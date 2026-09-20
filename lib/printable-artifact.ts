/**
 * Bake brightness + contentScale into printable PDFs on the server.
 * Agent prints the resulting PDF with existing Sumatra settings (no Agent change).
 *
 * Strategy:
 * - contentScale alone → vector pdf-lib page embedding (preserves PDF quality)
 * - brightness ≠ 100 → page-by-page raster at controlled DPI via pdfjs + canvas,
 *   then JPEG embed (one page at a time to bound memory)
 * - images → sharp brightness + A4 composition with contentScale
 *
 * Server-only module — do not import from Client Components.
 */

import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

import {
  applyBrightnessToImageBytes,
  resolvePrintAdjustments,
  scaleDrawInBox,
} from "@/lib/print-adjustments";
import {
  hasPrintContentAdjustments,
  NORMAL_A4_MARGIN_PT,
  type PrintOrientationV1,
} from "@/lib/print-settings";

const A4_PORTRAIT = { width: 595, height: 842 } as const;
const A4_LANDSCAPE = { width: 842, height: 595 } as const;

/** Print-quality raster DPI when brightness adjustment requires rasterization. */
export const PDF_BRIGHTNESS_RASTER_DPI = 150;

function a4Size(orientation: PrintOrientationV1) {
  return orientation === "landscape" ? A4_LANDSCAPE : A4_PORTRAIT;
}

function fitImageOnPage(
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number,
  margin: number,
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

/**
 * Compose one image into an A4 PDF with brightness + contentScale applied.
 */
export async function createAdjustedImagePrintablePdf(
  bytes: Uint8Array | Buffer,
  extension: string,
  options: {
    orientation?: PrintOrientationV1;
    marginPt?: number;
    brightness?: unknown;
    contentScale?: unknown;
  } = {},
): Promise<Uint8Array> {
  const orientation = options.orientation === "landscape" ? "landscape" : "portrait";
  const marginPt =
    typeof options.marginPt === "number" && Number.isFinite(options.marginPt)
      ? Math.max(0, options.marginPt)
      : NORMAL_A4_MARGIN_PT;
  const adj = resolvePrintAdjustments(options);
  const ext = extension.toLowerCase().replace(/^\./, "");

  const brightBytes = await applyBrightnessToImageBytes(bytes, adj.brightness);
  const pdf = await PDFDocument.create();
  const image =
    ext === "png"
      ? await pdf.embedPng(brightBytes)
      : await pdf.embedJpg(brightBytes);

  const { width: pageWidth, height: pageHeight } = a4Size(orientation);
  const fitted = fitImageOnPage(
    image.width,
    image.height,
    pageWidth,
    pageHeight,
    marginPt,
  );
  const contentBox = {
    width: Math.max(1, pageWidth - marginPt * 2),
    height: Math.max(1, pageHeight - marginPt * 2),
  };
  const scaled = scaleDrawInBox(
    { width: fitted.width, height: fitted.height, x: 0, y: 0 },
    contentBox,
    adj.contentScale,
  );
  const draw = {
    width: scaled.width,
    height: scaled.height,
    x: marginPt + scaled.x,
    y: marginPt + scaled.y,
  };

  const page = pdf.addPage([pageWidth, pageHeight]);
  page.drawImage(image, draw);
  return pdf.save();
}

async function scalePdfVector(
  sourceBytes: Uint8Array,
  contentScalePercent: number,
): Promise<Uint8Array> {
  if (contentScalePercent === 100) {
    return sourceBytes;
  }
  const scaleFactor = contentScalePercent / 100;
  const src = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const embeddedPages = await out.embedPdf(src);

  for (let i = 0; i < embeddedPages.length; i++) {
    const { width, height } = src.getPage(i).getSize();
    const embedded = embeddedPages[i];
    const drawW = width * scaleFactor;
    const drawH = height * scaleFactor;
    const newPage = out.addPage([width, height]);
    newPage.drawPage(embedded, {
      x: (width - drawW) / 2,
      y: (height - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  }

  return out.save();
}

async function rasterizePdfWithBrightness(
  sourceBytes: Uint8Array,
  brightnessPercent: number,
  contentScalePercent: number,
  dpi: number = PDF_BRIGHTNESS_RASTER_DPI,
): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  // Use legacy build for Node (no DOM / worker assumptions).
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(sourceBytes),
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const out = await PDFDocument.create();
  const scaleFactor = contentScalePercent / 100;
  const brightFactor = brightnessPercent / 100;
  const renderScale = dpi / 72;

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      let png = canvas.toBuffer("image/png");
      // Release canvas backing store ASAP.
      canvas.width = 0;
      canvas.height = 0;

      if (brightnessPercent !== 100) {
        png = await sharp(png).linear(brightFactor, 0).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      } else {
        png = await sharp(png).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      }

      const embedded = await out.embedJpg(png);
      const pageWidth = baseViewport.width;
      const pageHeight = baseViewport.height;
      const newPage = out.addPage([pageWidth, pageHeight]);
      const drawW = pageWidth * scaleFactor;
      const drawH = pageHeight * scaleFactor;
      newPage.drawImage(embedded, {
        x: (pageWidth - drawW) / 2,
        y: (pageHeight - drawH) / 2,
        width: drawW,
        height: drawH,
      });
    }
  } finally {
    try {
      await pdf.cleanup();
    } catch {
      // ignore cleanup errors
    }
  }

  return out.save();
}

/**
 * Transform a PDF with brightness + contentScale.
 * Brightness 100 → vector scale path. Otherwise page-wise raster (bounded memory).
 */
export async function transformPdfWithAdjustments(
  sourceBytes: Uint8Array | Buffer,
  options: { brightness?: unknown; contentScale?: unknown } = {},
): Promise<Uint8Array> {
  const adj = resolvePrintAdjustments(options);
  const bytes = Buffer.isBuffer(sourceBytes)
    ? new Uint8Array(sourceBytes)
    : sourceBytes;

  if (!hasPrintContentAdjustments(adj.brightness, adj.contentScale)) {
    return bytes;
  }

  if (adj.brightness === 100) {
    return scalePdfVector(bytes, adj.contentScale);
  }

  return rasterizePdfWithBrightness(bytes, adj.brightness, adj.contentScale);
}

export function needsArtifactAdjustment(
  brightness: unknown,
  contentScale: unknown,
): boolean {
  return hasPrintContentAdjustments(brightness, contentScale);
}
