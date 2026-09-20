/**
 * Brightness + contentScale settings / artifact smoke.
 * Run: npx tsx scripts/brightness-scale-smoke.ts
 */
import assert from "node:assert/strict";
import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";

import {
  generateIdCardA4Pdf,
  ID_CARD_A4_PORTRAIT_PT,
} from "../lib/id-card-layout";
import {
  applyBrightnessToImageBytes,
  scaleDrawInBox,
} from "../lib/print-adjustments";
import {
  createAdjustedImagePrintablePdf,
  transformPdfWithAdjustments,
} from "../lib/printable-artifact";
import {
  buildPrintSettingsV1,
  normalizeBrightnessPercent,
  normalizeContentScalePercent,
  resolvePrintSettings,
} from "../shared/print-settings";

async function makeTestJpeg(shade: number) {
  return sharp({
    create: {
      width: 120,
      height: 80,
      channels: 3,
      background: { r: shade, g: shade, b: shade },
    },
  })
    .jpeg()
    .toBuffer();
}

async function meanLuma(buf: Buffer) {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / pixels;
}

async function main() {
  // Boundaries + defaults
  assert.equal(normalizeBrightnessPercent(undefined), 100);
  assert.equal(normalizeBrightnessPercent("nope"), 100);
  assert.equal(normalizeBrightnessPercent(NaN), 100);
  assert.equal(normalizeBrightnessPercent(47), 50);
  assert.equal(normalizeBrightnessPercent(153), 150);
  assert.equal(normalizeBrightnessPercent(122), 120);
  assert.equal(normalizeContentScalePercent(null), 100);
  assert.equal(normalizeContentScalePercent(79), 80);
  assert.equal(normalizeContentScalePercent(121), 120);
  assert.equal(normalizeContentScalePercent(107), 105);
  console.log("PASS normalize boundaries");

  const built = buildPrintSettingsV1({
    copies: 1,
    brightness: 125,
    contentScale: 90,
  });
  assert.equal(built.brightness, 125);
  assert.equal(built.contentScale, 90);

  // Backward compat: missing fields → 100
  const legacy = resolvePrintSettings({
    v: 1,
    orientation: "portrait",
    copies: 1,
    paperSize: "A4",
    scale: "fit",
    margins: "normal",
    pageRange: "all",
  });
  assert.equal(legacy.source, "v1");
  assert.equal(legacy.settings?.brightness, 100);
  assert.equal(legacy.settings?.contentScale, 100);
  console.log("PASS settings store + backward compat");

  // Image brightness actually changes pixels
  const dark = await makeTestJpeg(40);
  const bright = await applyBrightnessToImageBytes(dark, 150);
  const darkMean = await meanLuma(dark);
  const brightMean = await meanLuma(bright);
  assert.ok(brightMean > darkMean + 5, "150% should brighten");
  console.log("PASS image brightness");

  // Scale clamp in box
  const scaled = scaleDrawInBox(
    { width: 100, height: 50, x: 10, y: 10 },
    { width: 100, height: 50 },
    120,
  );
  assert.ok(scaled.width <= 100 + 1e-6);
  assert.ok(scaled.height <= 50 + 1e-6);
  console.log("PASS scale clamp");

  // Adjusted image PDF
  const imgPdf = await createAdjustedImagePrintablePdf(dark, "jpg", {
    brightness: 120,
    contentScale: 110,
  });
  const imgDoc = await PDFDocument.load(imgPdf);
  assert.equal(imgDoc.getPageCount(), 1);
  const page = imgDoc.getPage(0);
  assert.equal(Math.round(page.getWidth()), 595);
  assert.equal(Math.round(page.getHeight()), 842);
  console.log("PASS adjusted image → A4 PDF");

  // PDF vector scale (brightness 100)
  const src = await PDFDocument.create();
  const p = src.addPage([595, 842]);
  p.drawRectangle({ x: 100, y: 100, width: 200, height: 200, color: rgb(0.2, 0.2, 0.2) });
  const srcBytes = await src.save();
  const scaledPdf = await transformPdfWithAdjustments(srcBytes, {
    brightness: 100,
    contentScale: 90,
  });
  const scaledDoc = await PDFDocument.load(scaledPdf);
  assert.equal(scaledDoc.getPageCount(), 1);
  console.log("PASS PDF vector contentScale");

  // PDF brightness raster path
  const brightPdf = await transformPdfWithAdjustments(srcBytes, {
    brightness: 120,
    contentScale: 100,
  });
  const brightDoc = await PDFDocument.load(brightPdf);
  assert.equal(brightDoc.getPageCount(), 1);
  console.log("PASS PDF brightness raster");

  // ID card shared adjustments + no overlap / stay in page
  const front = await makeTestJpeg(60);
  const back = await makeTestJpeg(90);
  const id = await generateIdCardA4Pdf(
    { bytes: front, format: "jpg" },
    { bytes: back, format: "jpg" },
    { brightness: 115, contentScale: 105 },
  );
  assert.equal(id.pageCount, 1);
  assert.equal(id.widthPt, ID_CARD_A4_PORTRAIT_PT.width);
  assert.ok(id.frontDraw.x + id.frontDraw.width <= id.backDraw.x + 0.5);
  assert.ok(id.frontDraw.y >= 0);
  assert.ok(
    id.frontDraw.y + id.frontDraw.height <= ID_CARD_A4_PORTRAIT_PT.height,
  );
  assert.ok(id.backDraw.x + id.backDraw.width <= ID_CARD_A4_PORTRAIT_PT.width);
  console.log("PASS ID-card side-by-side with adjustments");

  console.log("\nbrightness-scale-smoke: ALL PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
