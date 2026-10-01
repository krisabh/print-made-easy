/**
 * Bake brightness + contentScale into printable PDFs on the server.
 * Agent prints the resulting PDF with existing Sumatra settings (no Agent change).
 *
 * Strategy:
 * - contentScale alone → vector pdf-lib page copy (preserves PDF quality)
 * - brightness ≠ 100 → page-by-page raster at controlled DPI via pdfjs + canvas,
 *   then JPEG embed (one page at a time to bound memory)
 * - images → sharp brightness + A4 composition with contentScale
 *
 * Server-only module — do not import from Client Components.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

import { logInfo } from "@/lib/log";

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

/**
 * Longest rendered edge. Normal A4 at 150 DPI stays under this, so typical
 * pages are unchanged. Oversized page boxes are scaled down only for the
 * raster, not for the PDF page size.
 */
const MAX_BRIGHTNESS_RENDER_PX = 4096;

function pdfjsAssetDir(kind: "standard_fonts" | "cmaps" | "wasm"): string {
  // Resolve from disk. createRequire() is rewritten to void 0 by the Next
  // server bundle, which would throw before pdfjs ever opens the PDF.
  const relative = path.join("node_modules", "pdfjs-dist", kind);
  const candidates: string[] = [];
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    candidates.push(path.join(dir, relative));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  // pdfjs requires a trailing "/" even on Windows. fs.readFile accepts it.
  return (found ?? candidates[0]).replace(/\\/g, "/") + "/";
}

/** pdf-lib reads JPEG markers from byte 0 of the underlying buffer. */
function jpegBytesForEmbed(jpeg: Uint8Array): Uint8Array {
  if (jpeg.byteOffset === 0 && jpeg.byteLength === jpeg.buffer.byteLength) {
    return jpeg;
  }
  const copy = new Uint8Array(jpeg.byteLength);
  copy.set(jpeg);
  return copy;
}

function positivePageSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const w = Number.isFinite(width) && width > 0 ? width : 612;
  const h = Number.isFinite(height) && height > 0 ? height : 792;
  return { width: w, height: h };
}

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
  const pageCount = src.getPageCount();
  if (pageCount === 0) {
    return sourceBytes;
  }
  const pageIndices = Array.from({ length: pageCount }, (_, i) => i);
  // copyPages preserves every page, including blank pages that have no
  // Contents entry. embedPdf throws on those pages and also re-decodes
  // content streams, which can reject PDFs the direct-submit path accepts.
  const copiedPages = await out.copyPages(src, pageIndices);

  for (const page of copiedPages) {
    const { width, height } = page.getSize();
    out.addPage(page);
    page.scaleContent(scaleFactor, scaleFactor);
    page.translateContent(
      ((1 - scaleFactor) * width) / 2,
      ((1 - scaleFactor) * height) / 2,
    );
  }

  const saved = await out.save();
  logInfo(
    "pdf_adjust",
    `inBytes=${sourceBytes.byteLength} outBytes=${saved.byteLength} pages=${pageCount} brightness=100 contentScale=${contentScalePercent} mime=application/pdf ext=pdf`,
  );
  return saved;
}

/**
 * Rebuild every page with pdf-lib before rasterizing.
 * Scale-only already does this. Brightness must too: pdfjs rejects some
 * customer PDFs that pdf-lib accepts, which is the submit error after a
 * brightness change. Content scale is applied here so the raster step draws
 * each page at 100% of the already-scaled page.
 */
async function normalizePdfForBrightness(
  sourceBytes: Uint8Array,
  contentScalePercent: number,
): Promise<Uint8Array> {
  const scaleFactor = contentScalePercent / 100;
  const src = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pageCount = src.getPageCount();
  if (pageCount === 0) {
    return sourceBytes;
  }
  const pageIndices = Array.from({ length: pageCount }, (_, index) => index);
  const copiedPages = await out.copyPages(src, pageIndices);
  for (const page of copiedPages) {
    const { width, height } = page.getSize();
    out.addPage(page);
    if (scaleFactor !== 1) {
      page.scaleContent(scaleFactor, scaleFactor);
      page.translateContent(
        ((1 - scaleFactor) * width) / 2,
        ((1 - scaleFactor) * height) / 2,
      );
    }
  }
  return out.save({ useObjectStreams: false });
}

async function rasterizePdfWithBrightness(
  sourceBytes: Uint8Array,
  brightnessPercent: number,
  contentScalePercent: number,
  dpi: number = PDF_BRIGHTNESS_RASTER_DPI,
): Promise<Uint8Array> {
  const normalized = await normalizePdfForBrightness(
    sourceBytes,
    contentScalePercent,
  );
  const { createCanvas } = await import("@napi-rs/canvas");
  // Use legacy build for Node (no DOM / worker assumptions).
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfBytes = new Uint8Array(normalized.byteLength);
  pdfBytes.set(normalized);

  const loadingTask = pdfjs.getDocument({
    data: pdfBytes,
    useSystemFonts: true,
    standardFontDataUrl: pdfjsAssetDir("standard_fonts"),
    cMapUrl: pdfjsAssetDir("cmaps"),
    cMapPacked: true,
    wasmUrl: pdfjsAssetDir("wasm"),
  });
  const pdf = await loadingTask.promise;
  const out = await PDFDocument.create();
  const brightFactor = brightnessPercent / 100;
  const pageCount = pdf.numPages;
  const annotationMode = pdfjs.AnnotationMode?.DISABLE ?? 0;

  try {
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });
      const pageSize = positivePageSize(baseViewport.width, baseViewport.height);
      let renderScale = dpi / 72;
      const longSide = Math.max(pageSize.width, pageSize.height) * renderScale;
      if (longSide > MAX_BRIGHTNESS_RENDER_PX) {
        renderScale *= MAX_BRIGHTNESS_RENDER_PX / longSide;
      }
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = createCanvas(
        Math.max(1, Math.ceil(viewport.width)),
        Math.max(1, Math.ceil(viewport.height)),
      );
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // canvas must be null so pdfjs uses this Node context. Passing the
      // napi canvas makes pdfjs ignore the context and call getContext itself.
      await page.render({
        canvas: null,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
        intent: "print",
        annotationMode,
      }).promise;

      const png = canvas.toBuffer("image/png");
      canvas.width = 0;
      canvas.height = 0;

      const jpeg = await sharp(png)
        .linear(brightFactor, 0)
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
      const embedded = await out.embedJpg(jpegBytesForEmbed(jpeg));
      const newPage = out.addPage([pageSize.width, pageSize.height]);
      newPage.drawImage(embedded, {
        x: 0,
        y: 0,
        width: pageSize.width,
        height: pageSize.height,
      });
    }
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
      try {
        await pdf.cleanup();
      } catch {
        // ignore cleanup errors
      }
    }
  }

  const saved = await out.save({ useObjectStreams: false });
  logInfo(
    "pdf_adjust",
    `inBytes=${sourceBytes.byteLength} normalizedBytes=${normalized.byteLength} outBytes=${saved.byteLength} pages=${pageCount} brightness=${brightnessPercent} contentScale=${contentScalePercent} mime=application/pdf ext=pdf`,
  );
  return saved;
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

/**
 * Same checks the upload action runs after a brightness/scale bake:
 * transform, then reopen with pdf-lib before the file is stored.
 */
export async function buildAdjustedPrintablePdf(
  sourceBytes: Uint8Array | Buffer,
  options: { brightness?: unknown; contentScale?: unknown } = {},
): Promise<{ pdfBytes: Uint8Array; pageCount: number }> {
  const pdfBytes = await transformPdfWithAdjustments(sourceBytes, options);
  const loaded = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  return { pdfBytes, pageCount: loaded.getPageCount() };
}

export function needsArtifactAdjustment(
  brightness: unknown,
  contentScale: unknown,
): boolean {
  return hasPrintContentAdjustments(brightness, contentScale);
}
