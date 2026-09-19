/**
 * Phase A — ID Card Front + Back A4 PDF composition smoke tests.
 * Run: npx tsx scripts/phase-a-id-card-layout-smoke.ts
 *
 * Does not touch upload UI, Agent, pricing, or DB.
 * Optional inspection PDF is written under the OS temp dir (not tracked).
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PDFDocument } from "pdf-lib";

import {
  computeIdCardA4Layout,
  fitImageInBox,
  generateIdCardA4Pdf,
  GENERAL_ID_CARD_MAX_HEIGHT_PT,
  GENERAL_ID_CARD_MAX_WIDTH_PT,
  ID_CARD_A4_PORTRAIT_PT,
  normalizeIdCardImageFormat,
} from "../lib/id-card-layout";

/** 1×1 PNG (valid). */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** 2×1 PNG (landscape aspect) — tiny, valid. */
const PNG_2X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEElEQVR42mP8z8BQz0AEYBxVSF+FBwD+9wX+4x6i6QAAAABJRU5ErkJggg==",
  "base64",
);

/** 1×2 PNG (portrait aspect). */
const PNG_1X2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZmgDzAAAAEklEQVR42mP8z8BQz0AEYBxVSF+FBwD+9wX+qYxY3QAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Minimal valid JPEG (1×1).
 * Source: public-domain tiny JPEG used in smoke fixtures.
 */
const JPEG_1X1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z",
  "base64",
);

async function assertValidIdCardPdf(
  pdfBytes: Uint8Array,
  label: string,
): Promise<void> {
  const pdf = await PDFDocument.load(pdfBytes);
  assert.equal(pdf.getPageCount(), 1, `${label}: page count`);
  const page = pdf.getPage(0);
  const { width, height } = page.getSize();
  assert.equal(width, ID_CARD_A4_PORTRAIT_PT.width, `${label}: width`);
  assert.equal(height, ID_CARD_A4_PORTRAIT_PT.height, `${label}: height`);
}

async function main() {
  // Format normalization
  assert.equal(normalizeIdCardImageFormat("PNG"), "png");
  assert.equal(normalizeIdCardImageFormat(".JPG"), "jpg");
  assert.equal(normalizeIdCardImageFormat("jpeg"), "jpeg");
  assert.equal(normalizeIdCardImageFormat("pdf"), null);
  assert.equal(normalizeIdCardImageFormat("docx"), null);
  console.log("0 PASS format normalization");

  // Aspect-ratio fit math (structural; no visual rasterization)
  const fit = fitImageInBox(400, 200, 200, 200);
  assert.equal(fit.scale, 0.5);
  assert.equal(fit.width, 200);
  assert.equal(fit.height, 100);
  assert.ok(Math.abs(fit.width / fit.height - 2) < 1e-9);
  // No upscale when image already smaller than box
  const noUpscale = fitImageInBox(50, 50, 200, 200);
  assert.equal(noUpscale.scale, 1);
  assert.equal(noUpscale.width, 50);
  assert.equal(noUpscale.height, 50);
  console.log("E PASS aspect ratio preserved / no upscale");

  const layout = computeIdCardA4Layout();
  assert.equal(layout.page.width, 595);
  assert.equal(layout.page.height, 842);
  assert.ok(layout.front.y > layout.back.y, "front slot is above back");
  assert.ok(layout.front.height > 0 && layout.back.height > 0);
  // General ID-card boxes — not half-page fillers
  assert.ok(
    layout.front.width <= GENERAL_ID_CARD_MAX_WIDTH_PT + 1e-6,
    "front box within general max width",
  );
  assert.ok(
    layout.front.height <= GENERAL_ID_CARD_MAX_HEIGHT_PT + 1e-6,
    "front box within general max height",
  );
  assert.ok(
    layout.front.width < ID_CARD_A4_PORTRAIT_PT.width * 0.55,
    "front box substantially narrower than A4",
  );
  assert.ok(
    layout.front.height < ID_CARD_A4_PORTRAIT_PT.height * 0.35,
    "front box substantially shorter than A4",
  );
  assert.ok(
    Math.abs(layout.front.x + layout.front.width / 2 - layout.page.width / 2) <
      1,
    "front box horizontally centered",
  );
  assert.ok(
    Math.abs(layout.back.x + layout.back.width / 2 - layout.page.width / 2) < 1,
    "back box horizontally centered",
  );
  // No overlap + half-page placement (front upper, back lower)
  assert.ok(
    layout.front.y >= layout.back.y + layout.back.height - 1e-6,
    "front/back do not overlap",
  );
  const frontCenterY = layout.front.y + layout.front.height / 2;
  const backCenterY = layout.back.y + layout.back.height / 2;
  const pageMid = layout.page.height / 2;
  assert.ok(frontCenterY > pageMid, "front center in upper half");
  assert.ok(backCenterY < pageMid, "back center in lower half");
  const gap = layout.front.y - (layout.back.y + layout.back.height);
  assert.ok(gap > 80, `meaningful half-page gap (got ${gap})`);
  console.log("0b PASS layout slots (half-page regions, centered, gap)");

  // A — JPEG + JPEG
  const jpegPair = await generateIdCardA4Pdf(
    { bytes: JPEG_1X1, format: "jpg" },
    { bytes: JPEG_1X1, format: "jpeg" },
  );
  await assertValidIdCardPdf(jpegPair.pdfBytes, "A");
  assert.equal(jpegPair.pageCount, 1);
  assert.ok(jpegPair.frontDraw.width > 0 && jpegPair.frontDraw.height > 0);
  assert.ok(jpegPair.backDraw.width > 0 && jpegPair.backDraw.height > 0);
  console.log("A PASS JPEG + JPEG → valid 1-page A4 PDF");

  // B — PNG + PNG
  const pngPair = await generateIdCardA4Pdf(
    { bytes: PNG_2X1, format: "png" },
    { bytes: PNG_1X2, format: "png" },
  );
  await assertValidIdCardPdf(pngPair.pdfBytes, "B");
  // Landscape front aspect preserved in draw box
  assert.ok(
    Math.abs(pngPair.frontDraw.width / pngPair.frontDraw.height - 2) < 0.05,
  );
  // Portrait back aspect preserved
  assert.ok(
    Math.abs(pngPair.backDraw.height / pngPair.backDraw.width - 2) < 0.05,
  );
  console.log("B PASS PNG + PNG → valid PDF with aspect preserved");

  // C — mixed JPEG + PNG
  const mixed = await generateIdCardA4Pdf(
    { bytes: JPEG_1X1, format: "jpeg" },
    { bytes: PNG_1X1, format: "png" },
  );
  await assertValidIdCardPdf(mixed.pdfBytes, "C");
  console.log("C PASS mixed JPEG + PNG → valid PDF");

  // D — page count / A4 / both draws present (embedding succeeded if draws > 0)
  assert.equal(mixed.pageCount, 1);
  assert.equal(mixed.widthPt, ID_CARD_A4_PORTRAIT_PT.width);
  assert.equal(mixed.heightPt, ID_CARD_A4_PORTRAIT_PT.height);
  assert.ok(mixed.frontDraw.width > 0 && mixed.backDraw.width > 0);
  console.log("D PASS 1 page, A4 dims, both images drawn");

  // I1 — drawn cards stay inside general bounding box and A4
  {
    const large = await generateIdCardA4Pdf(
      { bytes: PNG_2X1, format: "png" },
      { bytes: PNG_1X2, format: "png" },
    );
    for (const draw of [large.frontDraw, large.backDraw] as const) {
      assert.ok(draw.width <= GENERAL_ID_CARD_MAX_WIDTH_PT + 1e-6);
      assert.ok(draw.height <= GENERAL_ID_CARD_MAX_HEIGHT_PT + 1e-6);
      assert.ok(draw.x >= 0 && draw.y >= 0);
      assert.ok(draw.x + draw.width <= ID_CARD_A4_PORTRAIT_PT.width + 1e-6);
      assert.ok(draw.y + draw.height <= ID_CARD_A4_PORTRAIT_PT.height + 1e-6);
      assert.ok(
        draw.width * draw.height <
          ID_CARD_A4_PORTRAIT_PT.width * ID_CARD_A4_PORTRAIT_PT.height * 0.2,
        "card area much smaller than A4",
      );
      assert.ok(
        Math.abs(
          draw.x + draw.width / 2 - ID_CARD_A4_PORTRAIT_PT.width / 2,
        ) < 1,
        "drawn card horizontally centered",
      );
    }
    assert.ok(
      large.frontDraw.y >= large.backDraw.y + large.backDraw.height - 1e-6,
      "drawn front/back do not overlap",
    );
    const frontCy = large.frontDraw.y + large.frontDraw.height / 2;
    const backCy = large.backDraw.y + large.backDraw.height / 2;
    assert.ok(frontCy > ID_CARD_A4_PORTRAIT_PT.height / 2, "front in upper half");
    assert.ok(backCy < ID_CARD_A4_PORTRAIT_PT.height / 2, "back in lower half");
    const drawGap =
      large.frontDraw.y - (large.backDraw.y + large.backDraw.height);
    assert.ok(drawGap > 80, `drawn half-page gap (got ${drawGap})`);
    console.log(
      "I1 PASS cards in half-page regions, inside general ID box, no overlap",
    );
  }

  // F — unsupported input
  await assert.rejects(
    () =>
      generateIdCardA4Pdf(
        { bytes: PNG_1X1, format: "pdf" },
        { bytes: PNG_1X1, format: "png" },
      ),
    /JPEG or PNG/i,
  );
  await assert.rejects(
    () =>
      generateIdCardA4Pdf(
        { bytes: Buffer.from("%PDF-1.4"), format: "png" },
        { bytes: PNG_1X1, format: "png" },
      ),
    /could not be read|JPEG or PNG/i,
  );
  console.log("F PASS unsupported / invalid image rejected");

  // G — front missing
  await assert.rejects(
    () => generateIdCardA4Pdf(null, { bytes: PNG_1X1, format: "png" }),
    /front/i,
  );
  await assert.rejects(
    () =>
      generateIdCardA4Pdf(
        { bytes: new Uint8Array(), format: "png" },
        { bytes: PNG_1X1, format: "png" },
      ),
    /empty|front/i,
  );
  console.log("G PASS front missing/empty rejected");

  // H — back missing
  await assert.rejects(
    () => generateIdCardA4Pdf({ bytes: PNG_1X1, format: "png" }, undefined),
    /back/i,
  );
  console.log("H PASS back missing rejected");

  // Optional inspection artifact (OS temp — not in git)
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "pme-id-card-"));
  const outPath = path.join(tmpDir, "id-card-phase-a-sample.pdf");
  await writeFile(outPath, pngPair.pdfBytes);
  console.log(`\nOptional sample PDF (not tracked): ${outPath}`);
  console.log(
    "Note: visual pixel inspection of embedded images is not automated;",
  );
  console.log(
    "tests assert structure (1×A4 page, draw boxes, aspect math, embed success).",
  );
  console.log("EXIF Orientation is a documented Phase A limitation (pdf-lib).");

  console.log("\nPhase A ID card layout smoke tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
