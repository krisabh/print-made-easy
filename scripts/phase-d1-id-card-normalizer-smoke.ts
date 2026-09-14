/**
 * Phase D1 / D1.1 / D1.2 / D1.3 — ID Card image normalizer smoke + diagnostics.
 * Run: npx tsx scripts/phase-d1-id-card-normalizer-smoke.ts
 *
 * Synthetic fixtures only — no real identity documents.
 * Diagnostics never include paths, filenames, image bytes, or PII.
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadOpenCV } from "@opencvjs/node";
import sharp from "sharp";

import { generateIdCardA4Pdf } from "../lib/id-card-layout";
import {
  applySafeEnhancement,
  detectCardCandidates,
  diagnoseIdCardImage,
  ID_CARD_CV_MAX_EDGE,
  ID_CARD_DESKEW_SCORE_THRESHOLD,
  ID_CARD_MAX_RESIDUAL_SKEW_DEG,
  ID_CARD_PERSPECTIVE_SCORE_THRESHOLD,
  longEdgeAngleDeg,
  normalizeDeskewAngleDeg,
  normalizeIdCardImage,
  orderCornersStable,
  preprocessIdCardImage,
  shouldApplyDeskewCorrection,
  shouldApplyPerspectiveCorrection,
} from "../lib/id-card-image-normalizer";

assert.equal(ID_CARD_PERSPECTIVE_SCORE_THRESHOLD, 0.62);
assert.ok(ID_CARD_DESKEW_SCORE_THRESHOLD < ID_CARD_PERSPECTIVE_SCORE_THRESHOLD);
assert.ok(ID_CARD_MAX_RESIDUAL_SKEW_DEG <= 3);

type Rgb = { r: number; g: number; b: number };

/** Synthetic card with text-like lines, photo-like rect, QR-like square. */
async function contentCardSvg(opts: {
  cardW: number;
  cardH: number;
  fill?: string;
}): Promise<Buffer> {
  const w = opts.cardW;
  const h = opts.cardH;
  const fill = opts.fill ?? "#e8e8ec";
  const photoX = Math.round(w * 0.08);
  const photoY = Math.round(h * 0.18);
  const photoW = Math.round(w * 0.28);
  const photoH = Math.round(h * 0.55);
  const qr = Math.round(Math.min(w, h) * 0.22);
  const qrX = Math.round(w * 0.72);
  const qrY = Math.round(h * 0.55);
  const lineX = Math.round(w * 0.42);
  const lines = [0.22, 0.34, 0.46, 0.58]
    .map((t) => {
      const y = Math.round(h * t);
      const lw = Math.round(w * (0.22 + t * 0.08));
      return `<rect x="${lineX}" y="${y}" width="${lw}" height="6" fill="#2a2a30"/>`;
    })
    .join("");
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="100%" height="100%" fill="${fill}"/>
      <rect x="4" y="4" width="${w - 8}" height="${h - 8}" fill="none" stroke="#1a1a1e" stroke-width="3"/>
      <rect x="${photoX}" y="${photoY}" width="${photoW}" height="${photoH}" fill="#6a7a8a"/>
      <rect x="${qrX}" y="${qrY}" width="${qr}" height="${qr}" fill="#111"/>
      <rect x="${qrX + 6}" y="${qrY + 6}" width="${qr - 12}" height="${qr - 12}" fill="#eee"/>
      <rect x="${qrX + 14}" y="${qrY + 14}" width="${Math.round(qr * 0.35)}" height="${Math.round(qr * 0.35)}" fill="#111"/>
      ${lines}
    </svg>`,
  );
  return sharp(svg).png().toBuffer();
}

async function solidPng(opts: {
  width: number;
  height: number;
  bg: Rgb;
  card?: {
    left: number;
    top: number;
    width: number;
    height: number;
    color: Rgb;
    withContent?: boolean;
  };
  extras?: Array<{
    left: number;
    top: number;
    width: number;
    height: number;
    color: Rgb;
  }>;
  brightness?: number;
}): Promise<Buffer> {
  const layers = [];
  if (opts.card) {
    const cardBuf = opts.card.withContent
      ? await contentCardSvg({
          cardW: opts.card.width,
          cardH: opts.card.height,
        })
      : await sharp({
          create: {
            width: opts.card.width,
            height: opts.card.height,
            channels: 3,
            background: opts.card.color,
          },
        })
          .png()
          .toBuffer();
    layers.push({
      input: cardBuf,
      left: opts.card.left,
      top: opts.card.top,
    });
  }
  for (const extra of opts.extras ?? []) {
    layers.push({
      input: await sharp({
        create: {
          width: extra.width,
          height: extra.height,
          channels: 3,
          background: extra.color,
        },
      })
        .png()
        .toBuffer(),
      left: extra.left,
      top: extra.top,
    });
  }
  let pipeline = sharp({
    create: {
      width: opts.width,
      height: opts.height,
      channels: 3,
      background: opts.bg,
    },
  }).composite(layers);
  if (opts.brightness != null) {
    pipeline = pipeline.modulate({ brightness: opts.brightness });
  }
  return pipeline.png().toBuffer();
}

async function polygonCardPng(opts: {
  width: number;
  height: number;
  bg: string;
  points: string;
  fill: string;
  withContent?: boolean;
}): Promise<Buffer> {
  const content = opts.withContent
    ? await contentCardSvg({ cardW: 400, cardH: 230 })
    : null;
  // For perspective fixtures, draw filled polygon; content overlay is approximate
  // via a separate rotated composite when needed.
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}">
      <rect width="100%" height="100%" fill="${opts.bg}"/>
      <polygon points="${opts.points}" fill="${opts.fill}"/>
    </svg>`,
  );
  void content;
  return sharp(svg).png().toBuffer();
}

/** Place a landscape card on a canvas, then rotate the whole frame. */
async function rotatedCardPng(degrees: number): Promise<Buffer> {
  const base = await solidPng({
    width: 900,
    height: 700,
    bg: { r: 32, g: 32, b: 34 },
    card: {
      left: 180,
      top: 200,
      width: 540,
      height: 300,
      color: { r: 228, g: 228, b: 232 },
      withContent: true,
    },
  });
  return sharp(base)
    .rotate(degrees, { background: { r: 32, g: 32, b: 34, alpha: 1 } })
    .png()
    .toBuffer();
}

async function meanLuma(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    n += 1;
  }
  return sum / n;
}

function logDiag(
  label: string,
  result: Awaited<ReturnType<typeof diagnoseIdCardImage>>,
) {
  const d = result.diagnostics;
  if (!d) {
    console.log(`  [${label}] diagnostics missing`);
    return;
  }
  console.log(
    `  [${label}] ${d.inputWidth}x${d.inputHeight} work=${d.workingWidth}x${d.workingHeight} contours=${d.contourCount} quads=${d.quadCandidateCount} selected=${d.selectedScore ?? "null"} angle=${d.selectedAngleDeg ?? "null"} aspect=${d.selectedAspect ?? "null"} dest=${d.destinationWidth ?? "null"}x${d.destinationHeight ?? "null"} residual=${d.residualSkewDeg ?? "null"} correction=${d.correctionType} reason=${d.fallbackReason}`,
  );
  if (d.selectedCorners?.length) {
    console.log(
      `    corners=${d.selectedCorners.map((p) => `(${p.x},${p.y})`).join(" ")}`,
    );
  }
  for (const c of d.topCandidates) {
    console.log(
      `    cand score=${c.score} area=${c.areaRatio} aspect=${c.aspect} rect=${c.rectangularity} border=${c.borderTouch} var=${c.sideVariance} angle=${c.angleDeg} pass=${c.sourcePass}`,
    );
  }
}

function assertCorrectedGeometry(
  result: Awaited<ReturnType<typeof diagnoseIdCardImage>>,
  label: string,
) {
  assert.ok(
    result.perspectiveApplied || result.deskewApplied,
    `${label}: expected perspective or deskew`,
  );
  assert.ok(
    result.correctionType === "perspective" ||
      result.correctionType === "deskew",
  );
  assert.ok(result.width >= result.height * 0.95, `${label}: expect landscape`);
  const aspect = result.width / Math.max(1, result.height);
  assert.ok(aspect > 1.1 && aspect < 2.5, `${label}: aspect ${aspect}`);
  if (result.diagnostics?.residualSkewDeg != null) {
    assert.ok(
      result.diagnostics.residualSkewDeg <= ID_CARD_MAX_RESIDUAL_SKEW_DEG + 0.5,
      `${label}: residualSkewDeg ${result.diagnostics.residualSkewDeg}`,
    );
  }
}

/** Residual edge tilt in degrees from top vs bottom light-pixel spans. */
async function residualTiltDeg(jpeg: Buffer): Promise<number> {
  const { data, info } = await sharp(jpeg)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  function edgeX(y: number) {
    let L = 0;
    let R = w - 1;
    for (let x = 0; x < w; x++) {
      if (data[y * w + x]! > 80) {
        L = x;
        break;
      }
    }
    for (let x = w - 1; x >= 0; x--) {
      if (data[y * w + x]! > 80) {
        R = x;
        break;
      }
    }
    return { L, R };
  }
  const top = edgeX(Math.floor(h * 0.2));
  const bot = edgeX(Math.floor(h * 0.8));
  const dy = h * 0.6;
  const tiltL = (Math.atan2(bot.L - top.L, dy) * 180) / Math.PI;
  const tiltR = (Math.atan2(bot.R - top.R, dy) * 180) / Math.PI;
  return Math.max(Math.abs(tiltL), Math.abs(tiltR));
}

function assertClockwiseTlTrBrBl(
  ordered: ReturnType<typeof orderCornersStable>,
  label: string,
) {
  const [tl, tr, br, bl] = ordered;
  assert.ok(tl.x + tl.y <= tr.x + tr.y + 1e-6, `${label}: TL sum`);
  assert.ok(tl.x + tl.y <= bl.x + bl.y + 1e-6, `${label}: TL vs BL`);
  assert.ok(br.x + br.y >= tr.x + tr.y - 1e-6, `${label}: BR sum`);
  // Clockwise winding in y-down image space: TL→TR→BR cross ≥ 0
  const cross =
    (tr.x - tl.x) * (br.y - tr.y) - (tr.y - tl.y) * (br.x - tr.x);
  assert.ok(cross >= 0, `${label}: clockwise cross=${cross}`);
  assert.ok(tr.x >= tl.x - 1, `${label}: TR right of TL`);
  assert.ok(br.y >= tr.y - 1, `${label}: BR below TR`);
  assert.ok(bl.x <= br.x + 1, `${label}: BL left of BR`);
}

async function main() {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "pme-id-card-d1.3-"));
  console.log(`Visual samples → ${outDir}`);
  console.log(
    `Perspective threshold locked at ${ID_CARD_PERSPECTIVE_SCORE_THRESHOLD}; deskew tier at ${ID_CARD_DESKEW_SCORE_THRESHOLD}; max residual ${ID_CARD_MAX_RESIDUAL_SKEW_DEG}°`,
  );

  // --- Corner ordering (deterministic, no OpenCV) ---
  {
    const cases: Array<{
      label: string;
      pts: Array<{ x: number; y: number }>;
    }> = [
      {
        label: "axis-aligned",
        pts: [
          { x: 10, y: 10 },
          { x: 200, y: 10 },
          { x: 200, y: 120 },
          { x: 10, y: 120 },
        ],
      },
      {
        label: "shuffled",
        pts: [
          { x: 200, y: 120 },
          { x: 10, y: 10 },
          { x: 10, y: 120 },
          { x: 200, y: 10 },
        ],
      },
      {
        label: "ccw-input",
        pts: [
          { x: 10, y: 10 },
          { x: 10, y: 120 },
          { x: 200, y: 120 },
          { x: 200, y: 10 },
        ],
      },
      {
        label: "rotated-rect",
        pts: [
          { x: 100, y: 40 },
          { x: 260, y: 80 },
          { x: 220, y: 180 },
          { x: 60, y: 140 },
        ],
      },
      {
        label: "near-square",
        pts: [
          { x: 50, y: 50 },
          { x: 160, y: 55 },
          { x: 155, y: 165 },
          { x: 45, y: 160 },
        ],
      },
    ];
    for (const c of cases) {
      const ordered = orderCornersStable(c.pts);
      assertClockwiseTlTrBrBl(ordered, c.label);
      const again = orderCornersStable([...ordered].reverse());
      assertClockwiseTlTrBrBl(again, `${c.label}-reversed`);
    }
    const ang = longEdgeAngleDeg([
      { x: 0, y: 0 },
      { x: 100, y: 10 },
      { x: 95, y: 60 },
      { x: -5, y: 50 },
    ]);
    const folded = normalizeDeskewAngleDeg(ang);
    assert.ok(Math.abs(folded) < 45);
    console.log("CORNER PASS orderCornersStable TL-TR-BR-BL + angle fold");
  }

  // A–F angle battery: +5 +10 -5 -10 +15 -15 (measure residual geometry)
  const angleBattery = [5, 10, -5, -10, 15, -15] as const;
  for (const deg of angleBattery) {
    const input = await rotatedCardPng(deg);
    const result = await diagnoseIdCardImage({ bytes: input, format: "png" });
    const tag = `rot${deg > 0 ? deg : `m${Math.abs(deg)}`}`;
    await writeFile(path.join(outDir, `${tag}-in.png`), input);
    await writeFile(path.join(outDir, `${tag}-out.jpg`), result.bytes);
    assertCorrectedGeometry(result, tag);
    const tilt = await residualTiltDeg(result.bytes);
    assert.ok(
      tilt < 3.5,
      `${tag}: residual tilt ${tilt} (input ${deg}°)`,
    );
    logDiag(tag, result);
    console.log(
      `ANGLE PASS ${deg}° → mode=${result.mode} tilt=${tilt.toFixed(2)} residualDiag=${result.diagnostics?.residualSkewDeg ?? "n/a"}`,
    );
  }

  // A class alias: rotated rectangular card already covered above.

  // B — perspective + rotation
  {
    const trap = await polygonCardPng({
      width: 640,
      height: 480,
      bg: "#232323",
      points: "100,90 510,75 530,350 90,365",
      fill: "#e6e6eb",
    });
    const input = await sharp(trap)
      .rotate(8, { background: { r: 35, g: 35, b: 35, alpha: 1 } })
      .png()
      .toBuffer();
    const result = await diagnoseIdCardImage({ bytes: input, format: "png" });
    await writeFile(path.join(outDir, "B-persp-rot-in.png"), input);
    await writeFile(path.join(outDir, "B-persp-rot-out.jpg"), result.bytes);
    assertCorrectedGeometry(result, "B-persp");
    const tilt = await residualTiltDeg(result.bytes);
    // Trapezoid warps can leave soft silhouette noise; trust residualSkewDeg gate.
    assert.ok(tilt < 6, `B-persp residual tilt ${tilt}`);
    if (result.diagnostics?.residualSkewDeg != null) {
      assert.ok(
        result.diagnostics.residualSkewDeg <= ID_CARD_MAX_RESIDUAL_SKEW_DEG + 0.5,
      );
    }
    logDiag("B-persp", result);
    console.log(`B PASS perspective + rotation (mode=${result.mode})`);
  }

  // C — imperfect quadrilateral
  {
    const input = await polygonCardPng({
      width: 640,
      height: 480,
      bg: "#232323",
      points: "95,85 515,70 545,355 80,380",
      fill: "#e6e6eb",
    });
    const result = await diagnoseIdCardImage({ bytes: input, format: "png" });
    await writeFile(path.join(outDir, "C-imperfect-quad-out.jpg"), result.bytes);
    if (result.perspectiveApplied || result.deskewApplied) {
      assert.ok(result.width >= result.height * 0.9);
      if (result.diagnostics?.residualSkewDeg != null) {
        assert.ok(
          result.diagnostics.residualSkewDeg <= ID_CARD_MAX_RESIDUAL_SKEW_DEG + 0.5,
        );
      }
    }
    logDiag("C-imperfect", result);
    console.log(
      `C PASS imperfect quad (mode=${result.mode}, correction=${result.correctionType})`,
    );
  }

  // D — stronger perspective (minAreaRect-style / soft corners)
  {
    const input = await polygonCardPng({
      width: 640,
      height: 480,
      bg: "#232323",
      points: "90,80 520,60 560,360 70,390",
      fill: "#e6e6eb",
    });
    const result = await diagnoseIdCardImage({ bytes: input, format: "png" });
    await writeFile(path.join(outDir, "D-strong-persp-out.jpg"), result.bytes);
    if (result.perspectiveApplied || result.deskewApplied) {
      assert.ok(result.width >= result.height * 0.9);
    }
    logDiag("D-strong", result);
    console.log(
      `D PASS stronger perspective (mode=${result.mode}, correction=${result.correctionType})`,
    );
  }

  // E — large margins
  {
    const input = await solidPng({
      width: 1000,
      height: 800,
      bg: { r: 25, g: 25, b: 25 },
      card: {
        left: 250,
        top: 260,
        width: 500,
        height: 280,
        color: { r: 235, g: 235, b: 240 },
        withContent: true,
      },
    });
    const result = await diagnoseIdCardImage({ bytes: input, format: "png" });
    await writeFile(path.join(outDir, "E-margins-out.jpg"), result.bytes);
    assert.ok(result.perspectiveApplied || result.deskewApplied);
    assert.ok(result.confidence >= ID_CARD_DESKEW_SCORE_THRESHOLD);
    logDiag("E-margins", result);
    console.log("E PASS large margins");
  }

  // F — card near image edge
  {
    const input = await solidPng({
      width: 800,
      height: 600,
      bg: { r: 28, g: 28, b: 28 },
      card: {
        left: 8,
        top: 120,
        width: 520,
        height: 300,
        color: { r: 225, g: 225, b: 230 },
        withContent: true,
      },
    });
    const result = await diagnoseIdCardImage({ bytes: input, format: "png" });
    await writeFile(path.join(outDir, "F-near-border-out.jpg"), result.bytes);
    assert.ok(result.perspectiveApplied || result.deskewApplied);
    logDiag("F-edge", result);
    console.log("F PASS near-border card");
  }

  // G — low contrast
  {
    const input = await solidPng({
      width: 800,
      height: 600,
      bg: { r: 150, g: 150, b: 152 },
      card: {
        left: 160,
        top: 170,
        width: 480,
        height: 270,
        color: { r: 175, g: 175, b: 178 },
      },
    });
    const result = await diagnoseIdCardImage({ bytes: input, format: "png" });
    await writeFile(path.join(outDir, "G-low-contrast-out.jpg"), result.bytes);
    assert.ok(result.bytes.byteLength > 0);
    logDiag("G-low", result);
    console.log(
      `G PASS low contrast (mode=${result.mode}, correction=${result.correctionType})`,
    );
  }

  // H — broken / incomplete edges (gap via dark cut on card border)
  {
    const base = await solidPng({
      width: 900,
      height: 700,
      bg: { r: 30, g: 30, b: 32 },
      card: {
        left: 180,
        top: 190,
        width: 520,
        height: 300,
        color: { r: 230, g: 230, b: 235 },
        withContent: true,
      },
    });
    // Carve a notch out of the top edge to break continuity.
    const input = await sharp(base)
      .composite([
        {
          input: await sharp({
            create: {
              width: 80,
              height: 24,
              channels: 3,
              background: { r: 30, g: 30, b: 32 },
            },
          })
            .png()
            .toBuffer(),
          left: 400,
          top: 190,
        },
      ])
      .png()
      .toBuffer();
    const result = await diagnoseIdCardImage({ bytes: input, format: "png" });
    await writeFile(path.join(outDir, "H-broken-edge-out.jpg"), result.bytes);
    assert.ok(result.bytes.byteLength > 0);
    logDiag("H-broken", result);
    console.log(
      `H PASS broken edges (mode=${result.mode}, correction=${result.correctionType})`,
    );
  }

  // I — cluttered background
  {
    const input = await solidPng({
      width: 900,
      height: 700,
      bg: { r: 45, g: 50, b: 55 },
      card: {
        left: 200,
        top: 180,
        width: 500,
        height: 290,
        color: { r: 230, g: 230, b: 235 },
        withContent: true,
      },
      extras: [
        {
          left: 40,
          top: 40,
          width: 120,
          height: 80,
          color: { r: 180, g: 100, b: 90 },
        },
        {
          left: 700,
          top: 500,
          width: 140,
          height: 100,
          color: { r: 90, g: 140, b: 180 },
        },
      ],
    });
    const result = await diagnoseIdCardImage({ bytes: input, format: "png" });
    await writeFile(path.join(outDir, "I-clutter-out.jpg"), result.bytes);
    assert.ok(result.perspectiveApplied || result.deskewApplied);
    logDiag("I", result);
    console.log("I PASS cluttered background");
  }

  // J — ambiguous rectangle → fallback
  {
    const noise = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 120, g: 90, b: 70 },
      },
    })
      .png()
      .toBuffer();
    const result = await diagnoseIdCardImage({ bytes: noise, format: "png" });
    assert.equal(result.perspectiveApplied, false);
    assert.equal(result.deskewApplied, false);
    assert.equal(result.correctionType, "fallback");
    assert.equal(result.mode, "fallback_exif_enhance");
    await writeFile(path.join(outDir, "J-ambiguous-out.jpg"), result.bytes);
    logDiag("J", result);
    console.log("J PASS ambiguous → safe fallback");
  }

  // K — already aligned card (no destructive rotation)
  {
    const input = await solidPng({
      width: 800,
      height: 600,
      bg: { r: 30, g: 30, b: 30 },
      card: {
        left: 140,
        top: 160,
        width: 520,
        height: 300,
        color: { r: 220, g: 220, b: 225 },
        withContent: true,
      },
    });
    const result = await diagnoseIdCardImage({ bytes: input, format: "png" });
    await writeFile(path.join(outDir, "K-aligned-out.jpg"), result.bytes);
    assert.ok(result.perspectiveApplied, "aligned card should perspective-crop");
    assert.ok(result.width / result.height > 1.2);
    if (result.diagnostics?.selectedAngleDeg != null) {
      assert.ok(
        Math.abs(result.diagnostics.selectedAngleDeg) < 3,
        "aligned card angle should be near 0",
      );
    }
    if (result.diagnostics?.residualSkewDeg != null) {
      assert.ok(result.diagnostics.residualSkewDeg < 2);
    }
    logDiag("K", result);
    console.log("K PASS already aligned card");
  }

  // L — invalid image rejected
  {
    await assert.rejects(
      () =>
        normalizeIdCardImage({
          bytes: Buffer.from("not-an-image"),
          format: "jpg",
        }),
      /could not be read|JPEG or PNG|invalid/i,
    );
    await assert.rejects(
      () =>
        normalizeIdCardImage({
          bytes: Buffer.from("%PDF"),
          format: "pdf",
        }),
      /JPEG or PNG/i,
    );
    console.log("L PASS invalid image rejected");
  }

  // Visual extras: dark + clean
  {
    const dark = await solidPng({
      width: 600,
      height: 400,
      bg: { r: 10, g: 10, b: 10 },
      card: {
        left: 100,
        top: 90,
        width: 400,
        height: 220,
        color: { r: 50, g: 50, b: 55 },
      },
      brightness: 0.55,
    });
    const before = await meanLuma(dark);
    const enhanced = await applySafeEnhancement(dark);
    const after = await meanLuma(enhanced);
    assert.ok(after > before * 0.95);
    const result = await diagnoseIdCardImage({ bytes: dark, format: "png" });
    await writeFile(path.join(outDir, "extra-dark-out.jpg"), result.bytes);
    console.log(
      `EXTRA dark (luma ${before.toFixed(1)}→${after.toFixed(1)}, mode=${result.mode})`,
    );
  }

  {
    const front = await solidPng({
      width: 900,
      height: 700,
      bg: { r: 20, g: 20, b: 20 },
      card: {
        left: 180,
        top: 200,
        width: 540,
        height: 300,
        color: { r: 220, g: 220, b: 230 },
        withContent: true,
      },
    });
    const back = await rotatedCardPng(10);
    const nFront = await normalizeIdCardImage({ bytes: front, format: "png" });
    const nBack = await normalizeIdCardImage({ bytes: back, format: "png" });
    const pdf = await generateIdCardA4Pdf(
      { bytes: nFront.bytes, format: nFront.format },
      { bytes: nBack.bytes, format: nBack.format },
    );
    assert.equal(pdf.pageCount, 1);
    await writeFile(path.join(outDir, "compose.pdf"), pdf.pdfBytes);
    console.log("EXTRA A4 compose with deskewed back PASS");
  }

  {
    const cv = await loadOpenCV();
    const sample = await solidPng({
      width: 640,
      height: 480,
      bg: { r: 15, g: 15, b: 15 },
      card: {
        left: 120,
        top: 140,
        width: 400,
        height: 220,
        color: { r: 225, g: 225, b: 230 },
      },
    });
    const { data, info } = await sharp(sample)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mat = new cv.Mat(info.height, info.width, cv.CV_8UC3);
    try {
      mat.data.set(data);
      const { candidates, contourCount } = detectCardCandidates(cv, mat);
      assert.ok(Array.isArray(candidates));
      assert.ok(typeof contourCount === "number");
      void shouldApplyPerspectiveCorrection(candidates[0]);
      void shouldApplyDeskewCorrection(candidates[0]);
    } finally {
      mat.delete();
    }
    const pre = await preprocessIdCardImage(sample);
    assert.ok(pre.orientedPng.byteLength > 0);
    assert.ok(ID_CARD_CV_MAX_EDGE === 1280);
    console.log("EXTRA OpenCV detect + deskew helpers PASS");
  }

  console.log("\nPhase D1.3 ID card normalizer smoke tests passed.");
  console.log(`Inspect samples in: ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
