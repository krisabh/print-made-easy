/**
 * Phase D0 — Sharp + OpenCV capability smoke (server-side only).
 * Run: npx tsx scripts/phase-d0-image-processing-capability-smoke.ts
 *
 * Proves dependencies load and required APIs execute.
 * Does NOT implement ID-card document detection yet.
 */
import assert from "node:assert/strict";

import { loadOpenCV, type OpenCV } from "@opencvjs/node";
import sharp from "sharp";

async function makeSyntheticJpeg(): Promise<Buffer> {
  // Solid gray with a brighter rectangle — enough for Canny/contours.
  return sharp({
    create: {
      width: 320,
      height: 240,
      channels: 3,
      background: { r: 40, g: 40, b: 40 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 180,
            height: 110,
            channels: 3,
            background: { r: 220, g: 220, b: 220 },
          },
        })
          .png()
          .toBuffer(),
        left: 70,
        top: 65,
      },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function main() {
  // ---------- Sharp ----------
  assert.equal(typeof sharp, "function");
  console.log("Sharp A PASS import");

  const jpeg = await makeSyntheticJpeg();
  assert.ok(jpeg.byteLength > 100);
  const img = sharp(jpeg);
  console.log("Sharp B PASS read buffer");

  const meta = await img.metadata();
  assert.equal(meta.width, 320);
  assert.equal(meta.height, 240);
  assert.ok(meta.format === "jpeg" || meta.format === "jpg");
  console.log("Sharp C PASS metadata");

  // Auto-orient applies EXIF when present; no-op for synthetic JPEG.
  const oriented = await sharp(jpeg).rotate().toBuffer();
  assert.ok(oriented.byteLength > 0);
  console.log("Sharp D PASS EXIF/auto-orient rotate()");

  const enhanced = await sharp(jpeg).normalize().toBuffer();
  assert.ok(enhanced.byteLength > 0);
  console.log("Sharp E PASS conservative normalize()");

  const encodedPng = await sharp(jpeg)
    .resize({ width: 160, height: 120, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const encodedJpeg = await sharp(jpeg)
    .resize({ width: 160, height: 120, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  assert.ok(encodedPng.byteLength > 0);
  assert.ok(encodedJpeg.byteLength > 0);
  console.log("Sharp F PASS resize + PNG/JPEG encode");

  // ---------- OpenCV ----------
  assert.equal(typeof loadOpenCV, "function");
  console.log("OpenCV A PASS import loadOpenCV");

  const cv: typeof OpenCV = await loadOpenCV();
  assert.ok(cv);
  assert.equal(typeof cv.Mat, "function");
  console.log("OpenCV B PASS loadOpenCV()");

  let src: InstanceType<typeof OpenCV.Mat> | null = null;
  let gray: InstanceType<typeof OpenCV.Mat> | null = null;
  let edges: InstanceType<typeof OpenCV.Mat> | null = null;
  let contours: InstanceType<typeof OpenCV.MatVector> | null = null;
  let hierarchy: InstanceType<typeof OpenCV.Mat> | null = null;
  let srcPts: InstanceType<typeof OpenCV.Mat> | null = null;
  let dstPts: InstanceType<typeof OpenCV.Mat> | null = null;
  let M: InstanceType<typeof OpenCV.Mat> | null = null;
  let warped: InstanceType<typeof OpenCV.Mat> | null = null;

  try {
    src = cv.Mat.zeros(120, 160, cv.CV_8UC3);
    assert.equal(src.rows, 120);
    assert.equal(src.cols, 160);
    console.log("OpenCV C PASS Mat create");

    // Draw a bright rectangle into the Mat for edge/contour detection.
    for (let y = 30; y < 90; y++) {
      for (let x = 40; x < 120; x++) {
        const i = (y * src.cols + x) * 3;
        src.data[i] = 240;
        src.data[i + 1] = 240;
        src.data[i + 2] = 240;
      }
    }

    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGB2GRAY);
    assert.equal(gray.channels(), 1);
    console.log("OpenCV D PASS basic image op (cvtColor)");

    edges = new cv.Mat();
    cv.Canny(gray, edges, 50, 150);
    assert.equal(edges.rows, gray.rows);
    assert.equal(edges.cols, gray.cols);
    let edgePixels = 0;
    for (let i = 0; i < edges.data.length; i++) {
      if (edges.data[i] > 0) edgePixels += 1;
    }
    assert.ok(edgePixels > 0, "expected some Canny edges");
    console.log("OpenCV E PASS Canny edge detection");

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );
    assert.ok(contours.size() >= 1, "expected at least one contour");
    console.log("OpenCV F PASS findContours");

    assert.equal(typeof cv.getPerspectiveTransform, "function");
    assert.equal(typeof cv.warpPerspective, "function");

    // Four-point warp API availability (synthetic rectangle → dest).
    srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      40, 30, 120, 30, 120, 90, 40, 90,
    ]);
    dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, 100, 0, 100, 60, 0, 60,
    ]);
    M = cv.getPerspectiveTransform(srcPts, dstPts);
    warped = new cv.Mat();
    cv.warpPerspective(src, warped, M, new cv.Size(100, 60));
    assert.equal(warped.cols, 100);
    assert.equal(warped.rows, 60);
    console.log("OpenCV G PASS getPerspectiveTransform + warpPerspective");
  } finally {
    warped?.delete();
    M?.delete();
    dstPts?.delete();
    srcPts?.delete();
    hierarchy?.delete();
    contours?.delete();
    edges?.delete();
    gray?.delete();
    src?.delete();
  }

  console.log("\nPhase D0 image-processing capability smoke tests passed.");
  console.log(
    `Versions: sharp=${require("sharp/package.json").version}, @opencvjs/node=${require("@opencvjs/node/package.json").version}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
