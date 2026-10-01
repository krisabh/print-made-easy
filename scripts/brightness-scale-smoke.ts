/**
 * Brightness + contentScale settings / artifact smoke.
 * Run: npx tsx scripts/brightness-scale-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
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
  needsArtifactAdjustment,
  transformPdfWithAdjustments,
} from "../lib/printable-artifact";
import { getContentType } from "../lib/storage";
import {
  deleteStoredUploadFile,
  saveGeneratedPdfFile,
} from "../lib/upload-service";
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
  const at100 = await applyBrightnessToImageBytes(dark, 100);
  assert.equal(await meanLuma(at100), darkMean, "100% is neutral/original");
  const at80 = await applyBrightnessToImageBytes(dark, 80);
  assert.ok(
    (await meanLuma(at80)) < darkMean - 2,
    "80% should darken vs 100%",
  );
  console.log("PASS image brightness (100 neutral, 80 darker, 150 brighter)");

  // Preview: compact vertical overlay + instant CSS (no per-slider re-bake)
  const previewSrc = fs.readFileSync(
    path.join(process.cwd(), "components/print-preview-dialog.tsx"),
    "utf8",
  );
  assert.match(previewSrc, /VerticalAdjustmentOverlay/);
  assert.match(previewSrc, /writingMode:\s*"vertical-lr"/);
  assert.match(previewSrc, /left-1/);
  assert.match(previewSrc, /right-1/);
  assert.match(previewSrc, /aria-label=\{`Brightness/);
  assert.match(previewSrc, /aria-label="Increase scale"/);
  assert.match(previewSrc, /aria-label="Decrease scale"/);
  // No large labeled Brightness/Scale panels
  assert.equal(/Brightness\s*<\/label>/.test(previewSrc), false);
  assert.equal(/text-sm font-medium[^>]*>\s*Scale\s*</.test(previewSrc), false);
  // Instant CSS filter/transform on preview content
  assert.match(previewSrc, /brightness\(\$\{previewBrightness \/ 100\}\)/);
  assert.match(previewSrc, /scale\(\$\{previewContentScale \/ 100\}\)/);
  // Slider changes must NOT swap the document for a loading state
  assert.equal(
    /loading \|\| adjustmentsPending/.test(previewSrc),
    false,
  );

  const uploadSrc = fs.readFileSync(
    path.join(process.cwd(), "components/upload-form.tsx"),
    "utf8",
  );
  // Normal preview must NOT call server re-bake on slider movement
  assert.equal(uploadSrc.includes("previewNormalAdjustmentsAction"), false);
  assert.equal(uploadSrc.includes("fetchNormalAdjustedPreview"), false);
  assert.match(uploadSrc, /fetchIdCardPreviewPdf/);
  assert.match(uploadSrc, /adjustmentsBaked=\{false\}/);
  // ID-card preview bakes once at neutral 100/100; live adjust is CSS
  assert.match(uploadSrc, /brightness: 100/);
  assert.match(uploadSrc, /contentScale: 100/);
  // Submit must not require preview generation
  assert.match(
    uploadSrc,
    /Preview is optional — never block Submit on preview loading/,
  );

  const actionsSrc = fs.readFileSync(
    path.join(process.cwd(), "app/upload/[shopCode]/actions.ts"),
    "utf8",
  );
  // Final print still uses authoritative server bake on submit
  assert.match(actionsSrc, /saveUploadFilesWithPrintAdjustments/);
  assert.match(actionsSrc, /needsArtifactAdjustment/);
  assert.match(actionsSrc, /createAdjustedImagePrintablePdf/);
  assert.match(actionsSrc, /transformPdfWithAdjustments/);
  console.log("PASS compact vertical overlay + instant CSS preview (server bake on submit only)");


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

  // Multi-page PDF preview is client blob (no server bake) — 1 / 16 pages
  const { buildNormalPreviewPages } = await import(
    "../components/print-preview-dialog"
  );
  async function makePdfFile(pages: number, name: string) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) {
      const page = doc.addPage([595, 842]);
      page.drawRectangle({
        x: 40,
        y: 40,
        width: 100,
        height: 100,
        color: rgb(0.2, 0.2, 0.2),
      });
    }
    const bytes = await doc.save();
    return new File([Buffer.from(bytes)], name, { type: "application/pdf" });
  }

  const onePage = await makePdfFile(1, "one.pdf");
  const sixteen = await makePdfFile(16, "sixteen.pdf");
  const pages1 = buildNormalPreviewPages(
    [{ id: "f1", file: onePage }],
    { f1: 1 },
  );
  const pages16 = buildNormalPreviewPages(
    [{ id: "f16", file: sixteen }],
    { f16: 16 },
  );
  assert.equal(pages1.length, 1);
  assert.equal(pages1[0]?.kind, "pdf");
  assert.equal(pages16.length, 1);
  assert.equal(pages16[0]?.kind, "pdf");
  if (pages16[0]?.kind === "pdf") {
    assert.equal(pages16[0].estimatedPages, 16);
    assert.ok(pages16[0].url.startsWith("blob:") || pages16[0].url.length > 0);
  }
  // Authoritative submit bake still works for adjusted multi-page PDFs
  const sixteenBytes = Buffer.from(await sixteen.arrayBuffer());
  const srcDoc = await PDFDocument.load(sixteenBytes);
  assert.equal(srcDoc.getPageCount(), 16, "test PDF must have 16 pages");
  const adjusted16 = await transformPdfWithAdjustments(sixteenBytes, {
    brightness: 100,
    contentScale: 90,
  });
  const adjustedDoc = await PDFDocument.load(adjusted16);
  assert.equal(adjustedDoc.getPageCount(), 16);
  console.log("PASS 1-page + 16-page client preview pages; submit bake keeps 16 pages");

  // Neutral 100/100 is the pre-feature path: original bytes, no bake.
  assert.equal(needsArtifactAdjustment(100, 100), false);
  assert.equal(needsArtifactAdjustment(undefined, undefined), false);
  assert.equal(needsArtifactAdjustment(80, 100), true);
  assert.equal(needsArtifactAdjustment(100, 90), true);
  const neutral = await transformPdfWithAdjustments(srcBytes, {
    brightness: 100,
    contentScale: 100,
  });
  assert.deepEqual(Buffer.from(neutral), Buffer.from(srcBytes));
  console.log("PASS default 100/100 preserves original PDF bytes");

  function assertPdfFile(bytes: Uint8Array) {
    assert.ok(bytes.byteLength > 0);
    assert.equal(bytes[0], 0x25);
    assert.equal(bytes[1], 0x50);
    assert.equal(bytes[2], 0x44);
    assert.equal(bytes[3], 0x46);
  }

  async function assertSubmitPdf(
    label: string,
    bytes: Uint8Array,
    options: { brightness: number; contentScale: number },
    expectedPages: number,
  ) {
    const out = await transformPdfWithAdjustments(bytes, options);
    assertPdfFile(out);
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPageCount(), expectedPages, label);
    if (options.brightness === 100 && options.contentScale === 100) {
      assert.deepEqual(Buffer.from(out), Buffer.from(bytes), label);
    }
    return out;
  }

  const one = await PDFDocument.create();
  const onlyPage = one.addPage([595, 842]);
  onlyPage.drawText("Only", {
    x: 72,
    y: 760,
    size: 18,
    font: await one.embedFont(StandardFonts.Helvetica),
  });
  const oneBytes = await one.save();

  const multi = await PDFDocument.create();
  const font = await multi.embedFont(StandardFonts.Helvetica);
  multi.addPage([595, 842]).drawText("Page 1", {
    x: 72,
    y: 760,
    size: 18,
    font,
  });
  multi.addPage([595, 842]);
  multi.addPage([420, 595]).drawRectangle({
    x: 20,
    y: 20,
    width: 80,
    height: 40,
    color: rgb(0.05, 0.05, 0.05),
  });
  const multiBytes = await multi.save();
  assert.equal((await PDFDocument.load(multiBytes)).getPageCount(), 3);

  await assertSubmitPdf("1 none", oneBytes, { brightness: 100, contentScale: 100 }, 1);
  await assertSubmitPdf("1 bright", oneBytes, { brightness: 80, contentScale: 100 }, 1);
  await assertSubmitPdf("1 scale", oneBytes, { brightness: 100, contentScale: 90 }, 1);
  await assertSubmitPdf("3 none", multiBytes, { brightness: 100, contentScale: 100 }, 3);
  await assertSubmitPdf("3 bright", multiBytes, { brightness: 70, contentScale: 100 }, 3);
  const scaledMulti = await assertSubmitPdf(
    "3 scale",
    multiBytes,
    { brightness: 100, contentScale: 85 },
    3,
  );
  assert.equal(Math.round((await PDFDocument.load(scaledMulti)).getPage(0).getWidth()), 595);
  const both = await assertSubmitPdf(
    "3 both",
    multiBytes,
    { brightness: 60, contentScale: 110 },
    3,
  );
  const saved = await saveGeneratedPdfFile({
    pdfBytes: both,
    originalFileName: "multi.pdf",
    totalPages: 3,
  });
  assert.equal(saved.fileExtension, "pdf");
  assert.equal(getContentType(saved.fileExtension), "application/pdf");
  assert.equal(saved.fileSize, both.byteLength);
  assert.ok(saved.fileSize > 0);
  await deleteStoredUploadFile(saved.storedFileName);
  console.log("PASS multi-page blank-page brightness/scale submit PDF");

  console.log("\nbrightness-scale-smoke: ALL PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
