/**
 * Server-side ID Card image normalizer (Phase D1 / D1.1 / D1.2).
 *
 * Sharp: EXIF orientation, bounded resize, conservative enhance, encode.
 * OpenCV: multi-pass edges → candidates → Tier 1 perspective / Tier 2 deskew /
 *         Tier 3 safe fallback.
 *
 * Confidence > aggressiveness. Perspective threshold stays at 0.62.
 * OpenCV Mats must always be .delete()'d.
 *
 * Server-only — do not import from client components.
 */

import { loadOpenCV, type OpenCV } from "@opencvjs/node";
import sharp from "sharp";

import { ID_CARD_MAX_IMAGE_BYTES, normalizeIdCardImageFormat } from "@/lib/id-card-layout";

/** Max edge length for OpenCV working image. */
export const ID_CARD_CV_MAX_EDGE = 1280;

/** Max edge length for final normalized output (print quality). */
export const ID_CARD_OUTPUT_MAX_EDGE = 2400;

/** Minimum composite score required before full perspective crop/warp. */
export const ID_CARD_PERSPECTIVE_SCORE_THRESHOLD = 0.62;

/**
 * Minimum card-like score for Tier 2 rotation/deskew (safer than uncertain warp).
 * Intentionally below perspective threshold; still requires measurable angle.
 */
export const ID_CARD_DESKEW_SCORE_THRESHOLD = 0.52;

/** Ignore near-zero angles (already aligned enough). */
export const ID_CARD_DESKEW_MIN_ABS_ANGLE_DEG = 1.5;
/** Reject deskew when folded angle is extreme (prefer perspective / fallback). */
export const ID_CARD_DESKEW_MAX_ABS_ANGLE_DEG = 20;

/** Max residual skew (degrees) accepted after perspective/deskew. */
export const ID_CARD_MAX_RESIDUAL_SKEW_DEG = 2.5;

/** Apply a second-pass micro-deskew when residual is in this band. */
export const ID_CARD_MICRO_DESKEW_MIN_DEG = 0.8;
export const ID_CARD_MICRO_DESKEW_MAX_DEG = 8;


export type IdCardCorrectionType = "perspective" | "deskew" | "fallback";

export type IdCardNormalizationMode =
  | "perspective"
  | "deskew"
  | "fallback_exif_enhance";

export type IdCardFallbackReason =
  | "none"
  | "skip_geometry"
  | "no_candidates"
  | "below_threshold"
  | "area_out_of_range"
  | "deskew_unsafe"
  | "geometry_worsened"
  | "warp_failed"
  | "cv_exception";

export type NormalizedIdCardImage = {
  bytes: Buffer;
  format: "jpeg" | "png";
  width: number;
  height: number;
  mode: IdCardNormalizationMode;
  /** 0–1 composite confidence of the selected card candidate (0 if fallback). */
  confidence: number;
  perspectiveApplied: boolean;
  deskewApplied: boolean;
  correctionType: IdCardCorrectionType;
  fallbackReason: IdCardFallbackReason;
};

export type NormalizeIdCardImageInput = {
  bytes: Uint8Array | Buffer;
  format: string;
  /** When true, attach structured diagnostics (tests/dev only). */
  includeDiagnostics?: boolean;
};

type Point = { x: number; y: number };

export type CardCandidate = {
  corners: [Point, Point, Point, Point];
  areaRatio: number;
  aspect: number;
  rectangularity: number;
  borderTouch: number;
  sideVariance: number;
  /** Long-edge angle in degrees, folded toward horizontal (−45…45). */
  angleDeg: number;
  score: number;
  sourcePass: string;
};

export type IdCardCandidateDiag = {
  areaRatio: number;
  aspect: number;
  rectangularity: number;
  borderTouch: number;
  sideVariance: number;
  angleDeg: number;
  score: number;
  sourcePass: string;
  /** Rounded corner coords (working-image space). Opt-in diagnostics only. */
  corners?: Array<{ x: number; y: number }>;
};

export type IdCardNormalizationDiagnostics = {
  inputWidth: number;
  inputHeight: number;
  workingWidth: number;
  workingHeight: number;
  contourCount: number;
  quadCandidateCount: number;
  topCandidates: IdCardCandidateDiag[];
  selectedScore: number | null;
  selectedAngleDeg: number | null;
  selectedAspect: number | null;
  selectedCorners?: Array<{ x: number; y: number }>;
  destinationWidth: number | null;
  destinationHeight: number | null;
  residualSkewDeg: number | null;
  correctionType: IdCardCorrectionType;
  fallbackReason: IdCardFallbackReason;
  perspectiveApplied: boolean;
  deskewApplied: boolean;
};

export type NormalizedIdCardImageWithDiagnostics = NormalizedIdCardImage & {
  diagnostics?: IdCardNormalizationDiagnostics;
};

type CvModule = typeof OpenCV;
type CvMat = InstanceType<CvModule["Mat"]>;
type CvMatVector = InstanceType<CvModule["MatVector"]>;

let opencvPromise: Promise<CvModule> | null = null;

function getOpenCV(): Promise<CvModule> {
  if (!opencvPromise) {
    opencvPromise = loadOpenCV();
  }
  return opencvPromise;
}

function toBuffer(bytes: Uint8Array | Buffer): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

function deleteMat(mat: { delete: () => void } | null | undefined) {
  try {
    mat?.delete();
  } catch {
    // already deleted / invalid
  }
}

/**
 * Order quadrilateral as TL, TR, BR, BL.
 * Uses sum/diff extremes, then enforces clockwise winding in image space
 * (y-down) so getPerspectiveTransform source/dest stay consistent.
 */
export function orderCornersStable(pts: Point[]): [Point, Point, Point, Point] {
  if (pts.length !== 4) {
    throw new Error("orderCornersStable requires exactly 4 points.");
  }
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => a.x - a.y - (b.x - b.y));
  let tl = bySum[0]!;
  let br = bySum[3]!;
  let tr = byDiff[3]!;
  let bl = byDiff[0]!;

  // Degenerate / duplicate extremes: fall back to angle-from-centroid sort.
  const uniq = new Set([tl, tr, br, bl]);
  if (uniq.size < 4) {
    const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
    const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
    const sorted = [...pts].sort(
      (a, b) =>
        Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
    );
    // Image y-down: atan2 order is CCW on screen; take TL as min(x+y) among sorted.
    const start = sorted.reduce(
      (bestIdx, p, i) =>
        p.x + p.y < sorted[bestIdx]!.x + sorted[bestIdx]!.y ? i : bestIdx,
      0,
    );
    const ring = [
      sorted[start]!,
      sorted[(start + 1) % 4]!,
      sorted[(start + 2) % 4]!,
      sorted[(start + 3) % 4]!,
    ] as [Point, Point, Point, Point];
    // Ensure clockwise TL-TR-BR-BL
    const cross =
      (ring[1].x - ring[0].x) * (ring[2].y - ring[1].y) -
      (ring[1].y - ring[0].y) * (ring[2].x - ring[1].x);
    if (cross < 0) {
      return [ring[0], ring[3], ring[2], ring[1]];
    }
    return ring;
  }

  // Clockwise in image coordinates: TL → TR → BR has positive cross (y-down).
  const cross =
    (tr.x - tl.x) * (br.y - tr.y) - (tr.y - tl.y) * (br.x - tr.x);
  if (cross < 0) {
    [tr, bl] = [bl, tr];
  }
  return [tl, tr, br, bl];
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function aspectFromOrdered(corners: [Point, Point, Point, Point]) {
  const [tl, tr, br, bl] = corners;
  const width = (dist(tl, tr) + dist(bl, br)) / 2;
  const height = (dist(tl, bl) + dist(tr, br)) / 2;
  if (height < 1) return 1;
  return width / height;
}

function normalizedAspect(aspect: number) {
  return aspect >= 1 ? aspect : 1 / aspect;
}

/** Hard gate — rejects extreme non-card shapes. Soft scoring uses a narrower band. */
function hardAspectOk(aspect: number) {
  const a = normalizedAspect(aspect);
  return a >= 1.05 && a <= 2.55;
}

function softAspectScore(aspect: number) {
  const a = normalizedAspect(aspect);
  if (a >= 1.15 && a <= 2.35) return 1;
  if (a >= 1.08 && a <= 2.45) return 0.7;
  if (a >= 1.05 && a <= 2.55) return 0.4;
  return 0.15;
}

/** Broad ID-card aspect (landscape or portrait-held). */
export function isPlausibleCardAspect(aspect: number) {
  return softAspectScore(aspect) >= 0.7;
}

/**
 * Angle of the longer edge (degrees). Used for deskew / diagnostics.
 */
export function longEdgeAngleDeg(
  corners: [Point, Point, Point, Point],
): number {
  const [tl, tr, , bl] = orderCornersStable(corners);
  const top = dist(tl, tr);
  const left = dist(tl, bl);
  const dx = top >= left ? tr.x - tl.x : bl.x - tl.x;
  const dy = top >= left ? tr.y - tl.y : bl.y - tl.y;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * Fold an edge angle into (−45, 45] so deskew uses the smallest rotation
 * that makes the long edge horizontal.
 */
export function normalizeDeskewAngleDeg(angleDeg: number): number {
  let a = angleDeg % 180;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  if (a > 45) a -= 90;
  if (a < -45) a += 90;
  return a;
}

function meanLuminance(data: Buffer, channels: number): number {
  if (data.length === 0 || channels < 1) return 128;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += channels) {
    if (channels >= 3) {
      sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    } else {
      sum += data[i]!;
    }
    count += 1;
  }
  return count ? sum / count : 128;
}

function countBorderTouches(
  corners: [Point, Point, Point, Point],
  imageW: number,
  imageH: number,
): number {
  const margin = Math.min(imageW, imageH) * 0.015;
  let borderTouch = 0;
  for (const p of corners) {
    if (
      p.x <= margin ||
      p.y <= margin ||
      p.x >= imageW - margin ||
      p.y >= imageH - margin
    ) {
      borderTouch += 1;
    }
  }
  return borderTouch;
}

function sideLengthVariance(corners: [Point, Point, Point, Point]): number {
  const [tl, tr, br, bl] = corners;
  const sides = [dist(tl, tr), dist(tr, br), dist(br, bl), dist(bl, tl)];
  const meanSide = sides.reduce((a, b) => a + b, 0) / 4;
  return (
    sides.reduce((a, s) => a + (s - meanSide) ** 2, 0) /
    (4 * (meanSide ** 2 || 1))
  );
}

/**
 * Sharp preprocessing: EXIF orientation + bounded decode for CV / output.
 */
export async function preprocessIdCardImage(bytes: Buffer): Promise<{
  orientedPng: Buffer;
  width: number;
  height: number;
  orientationApplied: boolean;
  skipGeometry: boolean;
}> {
  const meta = await sharp(bytes).metadata();
  const orientationApplied = Boolean(meta.orientation && meta.orientation !== 1);

  const orientedMeta = await sharp(bytes).rotate().metadata();
  let width = orientedMeta.width ?? meta.width ?? 0;
  let height = orientedMeta.height ?? meta.height ?? 0;

  if (width < 1 || height < 1) {
    throw new Error("ID card image is too small or invalid.");
  }

  if (width < 8 || height < 8) {
    const orientedPng = await sharp(bytes).rotate().png().toBuffer();
    const finalMeta = await sharp(orientedPng).metadata();
    return {
      orientedPng,
      width: finalMeta.width ?? width,
      height: finalMeta.height ?? height,
      orientationApplied,
      skipGeometry: true,
    };
  }

  let pipeline = sharp(bytes).rotate();
  const maxEdge = Math.max(width, height);
  if (maxEdge > ID_CARD_OUTPUT_MAX_EDGE) {
    pipeline = sharp(bytes)
      .rotate()
      .resize({
        width: width >= height ? ID_CARD_OUTPUT_MAX_EDGE : undefined,
        height: height > width ? ID_CARD_OUTPUT_MAX_EDGE : undefined,
        fit: "inside",
        withoutEnlargement: true,
      });
  }

  const orientedPng = await pipeline.png().toBuffer();
  const finalMeta = await sharp(orientedPng).metadata();
  return {
    orientedPng,
    width: finalMeta.width ?? width,
    height: finalMeta.height ?? height,
    orientationApplied,
    skipGeometry: false,
  };
}

function scoreCandidate(
  candidate: Omit<CardCandidate, "score" | "sourcePass" | "angleDeg"> & {
    angleDeg?: number;
  },
  imageW: number,
  imageH: number,
): number {
  const { areaRatio, aspect, rectangularity, borderTouch, sideVariance } =
    candidate;

  let areaScore = 0;
  if (areaRatio >= 0.1 && areaRatio <= 0.78) areaScore = 1;
  else if (areaRatio >= 0.06 && areaRatio <= 0.9) areaScore = 0.65;
  else areaScore = 0.2;

  const aspectOk = softAspectScore(aspect);
  const rectScore = Math.min(1, Math.max(0, rectangularity));

  let borderScore = 1;
  if (borderTouch >= 3 && areaRatio > 0.82) {
    borderScore = 0.2;
  } else if (borderTouch >= 3) {
    borderScore = 0.55;
  } else if (borderTouch === 2 && areaRatio > 0.75) {
    borderScore = 0.7;
  } else if (borderTouch === 2) {
    borderScore = 0.9;
  }

  const perspectiveScore =
    sideVariance > 0.55 ? 0.25 : sideVariance > 0.32 ? 0.6 : 1;

  void imageW;
  void imageH;

  return Math.min(
    1,
    Math.max(
      0,
      0.26 * areaScore +
        0.22 * aspectOk +
        0.22 * rectScore +
        0.15 * borderScore +
        0.15 * perspectiveScore,
    ),
  );
}

function cornersAreSimilar(
  a: [Point, Point, Point, Point],
  b: [Point, Point, Point, Point],
  tol: number,
): boolean {
  const sa = [...a].sort((p, q) => p.x + p.y - (q.x + q.y));
  const sb = [...b].sort((p, q) => p.x + p.y - (q.x + q.y));
  for (let i = 0; i < 4; i++) {
    if (dist(sa[i]!, sb[i]!) > tol) return false;
  }
  return true;
}

function dedupeCandidates(
  candidates: CardCandidate[],
  imageW: number,
  imageH: number,
): CardCandidate[] {
  const tol = Math.min(imageW, imageH) * 0.04;
  const out: CardCandidate[] = [];
  for (const c of candidates) {
    const dup = out.find((o) => cornersAreSimilar(o.corners, c.corners, tol));
    if (!dup) {
      out.push(c);
    } else if (c.score > dup.score) {
      Object.assign(dup, c);
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Snap soft approxPolyDP corners to a fitted rotated rectangle. */
function refineCornersWithMinAreaRect(
  cv: CvModule,
  corners: [Point, Point, Point, Point],
): [Point, Point, Point, Point] {
  let ptsMat: CvMat | null = null;
  try {
    const ordered = orderCornersStable(corners);
    ptsMat = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      ordered.flatMap((p) => [p.x, p.y]),
    );
    const rr = cv.minAreaRect(ptsMat);
    if (rr.size.width < 8 || rr.size.height < 8) return corners;
    return cornersFromRotatedRect(rr);
  } catch {
    return corners;
  } finally {
    deleteMat(ptsMat);
  }
}

/** Four corners matching OpenCV boxPoints(RotatedRect) geometry. */
function cornersFromRotatedRect(rr: {
  center: { x: number; y: number };
  size: { width: number; height: number };
  angle: number;
}): [Point, Point, Point, Point] {
  const cx = rr.center.x;
  const cy = rr.center.y;
  const w = rr.size.width;
  const h = rr.size.height;
  const rad = (rr.angle * Math.PI) / 180;
  const b = Math.cos(rad) * 0.5;
  const a = Math.sin(rad) * 0.5;
  const p0 = { x: cx - a * h - b * w, y: cy + b * h - a * w };
  const p1 = { x: cx + a * h - b * w, y: cy - b * h - a * w };
  const p2 = { x: 2 * cx - p0.x, y: 2 * cy - p0.y };
  const p3 = { x: 2 * cx - p1.x, y: 2 * cy - p1.y };
  return orderCornersStable([p0, p1, p2, p3]);
}

function readApproxCorners(approx: CvMat): Point[] {
  const pts: Point[] = [];
  const data = approx.data32S as Int32Array | undefined;
  if (data && data.length >= 8) {
    for (let r = 0; r < 4; r++) {
      pts.push({ x: data[r * 2]!, y: data[r * 2 + 1]! });
    }
    return pts;
  }
  for (let r = 0; r < 4; r++) {
    pts.push({
      x: approx.intAt(r, 0),
      y: approx.intAt(r, 1),
    });
  }
  return pts;
}

function candidateFromCorners(
  cornersIn: Point[],
  area: number,
  imageW: number,
  imageH: number,
  imageArea: number,
  rectangularity: number,
  sourcePass: string,
): CardCandidate | null {
  if (cornersIn.length !== 4) return null;
  const corners = orderCornersStable(cornersIn);
  const aspect = aspectFromOrdered(corners);
  if (!hardAspectOk(aspect)) return null;

  const areaRatio = area / imageArea;
  if (areaRatio < 0.05 || areaRatio > 0.96) return null;
  if (rectangularity < 0.48) return null;

  const borderTouch = countBorderTouches(corners, imageW, imageH);
  const variance = sideLengthVariance(corners);
  const angleDeg = normalizeDeskewAngleDeg(longEdgeAngleDeg(corners));
  const base = {
    corners,
    areaRatio,
    aspect,
    rectangularity,
    borderTouch,
    sideVariance: variance,
    angleDeg,
  };
  return {
    ...base,
    sourcePass,
    score: scoreCandidate(base, imageW, imageH),
  };
}

function collectQuadsFromEdges(
  cv: CvModule,
  edges: CvMat,
  imageW: number,
  imageH: number,
  imageArea: number,
  sourcePass: string,
  epsFactors: number[],
  includeMinAreaRect: boolean,
): { candidates: CardCandidate[]; contourCount: number } {
  let contours: CvMatVector | null = null;
  let hierarchy: CvMat | null = null;
  const candidates: CardCandidate[] = [];
  let contourCount = 0;

  try {
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );
    contourCount = contours.size();

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      try {
        const peri = cv.arcLength(contour, true);
        if (peri < 40) continue;
        const contourArea = Math.abs(cv.contourArea(contour));
        if (contourArea / imageArea < 0.04) continue;

        let foundQuad = false;
        for (const eps of epsFactors) {
          let approx: CvMat | null = null;
          try {
            approx = new cv.Mat();
            cv.approxPolyDP(contour, approx, eps * peri, true);
            if (approx.rows !== 4) continue;
            if (!cv.isContourConvex(approx)) continue;

            const area = Math.abs(cv.contourArea(approx));
            const rect = cv.boundingRect(approx);
            const rectangularity =
              rect.width * rect.height > 0
                ? area / (rect.width * rect.height)
                : 0;
            const pts = readApproxCorners(approx);
            const cand = candidateFromCorners(
              pts,
              area,
              imageW,
              imageH,
              imageArea,
              rectangularity,
              `${sourcePass}:eps${eps}`,
            );
            if (cand) {
              candidates.push(cand);
              foundQuad = true;
            }
          } finally {
            deleteMat(approx);
          }
        }

        // Tier-2 support: strong rotated rectangle even when approx ≠ 4 pts.
        if (includeMinAreaRect && !foundQuad) {
          try {
            const rr = cv.minAreaRect(contour);
            const rw = rr.size.width;
            const rh = rr.size.height;
            if (rw < 8 || rh < 8) continue;
            const rectArea = rw * rh;
            const rectangularity =
              rectArea > 0 ? contourArea / rectArea : 0;
            if (rectangularity < 0.55) continue;

            const pts = cornersFromRotatedRect(rr);
            const cand = candidateFromCorners(
              pts,
              contourArea,
              imageW,
              imageH,
              imageArea,
              rectangularity,
              `${sourcePass}:minAreaRect`,
            );
            if (cand) candidates.push(cand);
          } catch {
            // minAreaRect / boxPoints unavailable or failed — skip
          }
        }
      } finally {
        deleteMat(contour);
      }
    }
  } finally {
    deleteMat(hierarchy);
    deleteMat(contours);
  }

  return { candidates, contourCount };
}

/**
 * Multi-pass card detection:
 * - plain + equalized grayscale
 * - several Canny thresholds
 * - morphological close to reconnect broken edges
 * - adaptive threshold pass
 * - bounded minAreaRect deskew candidates on primary pass
 * Caller owns `src` Mat lifetime.
 */
export function detectCardCandidates(
  cv: CvModule,
  src: CvMat,
): { candidates: CardCandidate[]; contourCount: number } {
  const imageW = src.cols;
  const imageH = src.rows;
  const imageArea = imageW * imageH;
  if (imageArea <= 0) return { candidates: [], contourCount: 0 };

  let gray: CvMat | null = null;
  let equalized: CvMat | null = null;
  let blurPlain: CvMat | null = null;
  let blurEq: CvMat | null = null;
  let edges: CvMat | null = null;
  let edgesClosed: CvMat | null = null;
  let adaptive: CvMat | null = null;
  let morph: CvMat | null = null;
  let kernel: CvMat | null = null;

  const all: CardCandidate[] = [];
  let contourCount = 0;

  // Slightly wider epsilon band for soft/anti-aliased phone-photo borders.
  const epsFactors = [0.012, 0.015, 0.02, 0.03, 0.045, 0.055];
  const cannyPairs: Array<[number, number, string]> = [
    [50, 150, "canny_50_150"],
    [30, 100, "canny_30_100"],
    [70, 200, "canny_70_200"],
  ];

  try {
    gray = new cv.Mat();
    equalized = new cv.Mat();
    blurPlain = new cv.Mat();
    blurEq = new cv.Mat();
    edges = new cv.Mat();
    edgesClosed = new cv.Mat();
    adaptive = new cv.Mat();
    morph = new cv.Mat();
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));

    if (src.channels() === 1) {
      src.copyTo(gray);
    } else {
      cv.cvtColor(src, gray, cv.COLOR_RGB2GRAY);
    }

    cv.equalizeHist(gray, equalized);
    cv.GaussianBlur(gray, blurPlain, new cv.Size(5, 5), 0);
    cv.GaussianBlur(equalized, blurEq, new cv.Size(5, 5), 0);

    const blurPasses: Array<[CvMat, string]> = [
      [blurPlain, "plain"],
      [blurEq, "eq"],
    ];

    for (const [blurMat, blurName] of blurPasses) {
      for (const [lo, hi, cannyName] of cannyPairs) {
        cv.Canny(blurMat, edges, lo, hi);
        cv.morphologyEx(edges, edgesClosed, cv.MORPH_CLOSE, kernel);
        const useMinArea =
          blurName === "plain" && cannyName === "canny_50_150";
        const r = collectQuadsFromEdges(
          cv,
          edgesClosed,
          imageW,
          imageH,
          imageArea,
          `${blurName}_${cannyName}`,
          epsFactors,
          useMinArea,
        );
        all.push(...r.candidates);
        contourCount += r.contourCount;
      }

      cv.adaptiveThreshold(
        blurMat,
        adaptive,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        31,
        7,
      );
      cv.morphologyEx(adaptive, morph, cv.MORPH_CLOSE, kernel);
      {
        const r = collectQuadsFromEdges(
          cv,
          morph,
          imageW,
          imageH,
          imageArea,
          `${blurName}_adaptive_close`,
          epsFactors,
          false,
        );
        all.push(...r.candidates);
        contourCount += r.contourCount;
      }
    }

    return {
      candidates: dedupeCandidates(all, imageW, imageH),
      contourCount,
    };
  } finally {
    deleteMat(kernel);
    deleteMat(morph);
    deleteMat(adaptive);
    deleteMat(edgesClosed);
    deleteMat(edges);
    deleteMat(blurEq);
    deleteMat(blurPlain);
    deleteMat(equalized);
    deleteMat(gray);
  }
}

export function shouldApplyPerspectiveCorrection(
  candidate: CardCandidate | null | undefined,
): { ok: boolean; reason: IdCardFallbackReason } {
  if (!candidate) return { ok: false, reason: "no_candidates" };
  if (candidate.score < ID_CARD_PERSPECTIVE_SCORE_THRESHOLD) {
    return { ok: false, reason: "below_threshold" };
  }
  if (candidate.areaRatio < 0.06 || candidate.areaRatio > 0.93) {
    return { ok: false, reason: "area_out_of_range" };
  }
  if (candidate.borderTouch >= 3 && candidate.areaRatio > 0.85) {
    return { ok: false, reason: "area_out_of_range" };
  }
  return { ok: true, reason: "none" };
}

/**
 * Tier 2 — reliable rotation/deskew without full perspective warp.
 */
export function shouldApplyDeskewCorrection(
  candidate: CardCandidate | null | undefined,
): { ok: boolean; reason: IdCardFallbackReason; angleDeg: number } {
  if (!candidate) return { ok: false, reason: "no_candidates", angleDeg: 0 };
  if (candidate.score < ID_CARD_DESKEW_SCORE_THRESHOLD) {
    return { ok: false, reason: "below_threshold", angleDeg: candidate.angleDeg };
  }
  if (candidate.areaRatio < 0.08 || candidate.areaRatio > 0.9) {
    return { ok: false, reason: "area_out_of_range", angleDeg: candidate.angleDeg };
  }
  if (candidate.rectangularity < 0.55) {
    return { ok: false, reason: "deskew_unsafe", angleDeg: candidate.angleDeg };
  }
  // Strong perspective distortion → affine deskew is the wrong tool.
  if (candidate.sideVariance > 0.38) {
    return { ok: false, reason: "deskew_unsafe", angleDeg: candidate.angleDeg };
  }
  if (candidate.borderTouch >= 3 && candidate.areaRatio > 0.82) {
    return { ok: false, reason: "deskew_unsafe", angleDeg: candidate.angleDeg };
  }
  const angle = normalizeDeskewAngleDeg(candidate.angleDeg);
  const abs = Math.abs(angle);
  if (abs < ID_CARD_DESKEW_MIN_ABS_ANGLE_DEG) {
    return { ok: false, reason: "deskew_unsafe", angleDeg: angle };
  }
  if (abs > ID_CARD_DESKEW_MAX_ABS_ANGLE_DEG) {
    return { ok: false, reason: "deskew_unsafe", angleDeg: angle };
  }
  return { ok: true, reason: "none", angleDeg: angle };
}

async function decodeToRgbMat(cv: CvModule, imageBytes: Buffer): Promise<CvMat> {
  const { data, info } = await sharp(imageBytes)
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error("Expected 3-channel RGB image for CV processing.");
  }

  const mat = new cv.Mat(info.height, info.width, cv.CV_8UC3);
  mat.data.set(data);
  return mat;
}

async function encodeMatJpeg(
  mat: CvMat,
  quality = 92,
): Promise<{ bytes: Buffer; width: number; height: number }> {
  const width = mat.cols;
  const height = mat.rows;
  const channels = mat.channels();
  const raw = Buffer.from(mat.data);
  const bytes = await sharp(raw, {
    raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
  })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  return { bytes, width, height };
}

function scaleCorners(
  corners: [Point, Point, Point, Point],
  scaleX: number,
  scaleY: number,
): [Point, Point, Point, Point] {
  return corners.map((p) => ({
    x: p.x * scaleX,
    y: p.y * scaleY,
  })) as [Point, Point, Point, Point];
}

function transformPoints(
  points: Point[],
  m00: number,
  m01: number,
  m02: number,
  m10: number,
  m11: number,
  m12: number,
): Point[] {
  return points.map((p) => ({
    x: m00 * p.x + m01 * p.y + m02,
    y: m10 * p.x + m11 * p.y + m12,
  }));
}

function ensureLandscapeMat(cv: CvModule, src: CvMat): CvMat {
  if (src.cols >= src.rows * 0.98) {
    return src;
  }
  const rotated = new cv.Mat();
  cv.rotate(src, rotated, cv.ROTATE_90_CLOCKWISE);
  deleteMat(src);
  return rotated;
}

/**
 * Measure residual in-plane skew of a corrected card Mat.
 *
 * Prefer the outer silhouette (large contour). Fall back to left/right
 * content-edge tilt across the frame. Never trust small internal objects
 * (photo box / QR) as the card orientation.
 */
export function measureResidualSkewDeg(cv: CvModule, src: CvMat): number {
  let gray: CvMat | null = null;
  let blur: CvMat | null = null;
  let edges: CvMat | null = null;
  let contours: CvMatVector | null = null;
  let hierarchy: CvMat | null = null;

  try {
    gray = new cv.Mat();
    blur = new cv.Mat();
    edges = new cv.Mat();
    if (src.channels() === 1) {
      src.copyTo(gray);
    } else {
      cv.cvtColor(src, gray, cv.COLOR_RGB2GRAY);
    }
    cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0);
    cv.Canny(blur, edges, 40, 120);

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE,
    );

    const imageArea = src.cols * src.rows;
    let bestArea = 0;
    let bestAngle = 0;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      try {
        const area = Math.abs(cv.contourArea(c));
        // Outer card only — ignore photo/QR-sized internal rectangles.
        if (area < imageArea * 0.35 || area > imageArea * 0.995) continue;
        if (area <= bestArea) continue;
        const rr = cv.minAreaRect(c);
        let angle = rr.angle;
        if (rr.size.width < rr.size.height) angle += 90;
        bestArea = area;
        bestAngle = normalizeDeskewAngleDeg(angle);
      } catch {
        // skip
      } finally {
        deleteMat(c);
      }
    }
    if (bestArea > 0) {
      return Math.abs(bestAngle);
    }

    // Frame-filling warp: no closed outer contour — use silhouette tilt.
    return measureSilhouetteTiltDeg(gray);
  } catch {
    return 0;
  } finally {
    deleteMat(hierarchy);
    deleteMat(contours);
    deleteMat(edges);
    deleteMat(blur);
    deleteMat(gray);
  }
}

/** Left/right content-edge tilt between ~20% and ~80% image height. */
function measureSilhouetteTiltDeg(gray: CvMat): number {
  const w = gray.cols;
  const h = gray.rows;
  if (w < 16 || h < 16) return 0;
  const data = gray.data as Uint8Array;
  const y0 = Math.floor(h * 0.2);
  const y1 = Math.floor(h * 0.8);
  const dy = Math.max(1, y1 - y0);

  function edgeX(y: number): { L: number; R: number } {
    const row = y * w;
    let L = 0;
    let R = w - 1;
    for (let x = 0; x < w; x++) {
      if (data[row + x]! > 40) {
        L = x;
        break;
      }
    }
    for (let x = w - 1; x >= 0; x--) {
      if (data[row + x]! > 40) {
        R = x;
        break;
      }
    }
    return { L, R };
  }

  const top = edgeX(y0);
  const bot = edgeX(y1);
  const tiltL = (Math.atan2(bot.L - top.L, dy) * 180) / Math.PI;
  const tiltR = (Math.atan2(bot.R - top.R, dy) * 180) / Math.PI;
  return Math.max(Math.abs(tiltL), Math.abs(tiltR));
}

/**
 * Small residual rotation fix on an already-cropped card Mat.
 * Returns a new Mat (caller deletes); may return src unchanged ownership
 * only when no correction — always returns a Mat the caller owns uniquely
 * when changed; when unchanged returns the same reference.
 */
function applyMicroDeskewIfNeeded(
  cv: CvModule,
  src: CvMat,
): { mat: CvMat; applied: boolean; residualBefore: number; residualAfter: number } {
  const residualBefore = measureResidualSkewDeg(cv, src);
  if (
    residualBefore < ID_CARD_MICRO_DESKEW_MIN_DEG ||
    residualBefore > ID_CARD_MICRO_DESKEW_MAX_DEG
  ) {
    return {
      mat: src,
      applied: false,
      residualBefore,
      residualAfter: residualBefore,
    };
  }

  let gray: CvMat | null = null;
  let edges: CvMat | null = null;
  let contours: CvMatVector | null = null;
  let hierarchy: CvMat | null = null;
  let M: CvMat | null = null;
  let rotated: CvMat | null = null;

  try {
    gray = new cv.Mat();
    edges = new cv.Mat();
    if (src.channels() === 1) src.copyTo(gray);
    else cv.cvtColor(src, gray, cv.COLOR_RGB2GRAY);
    cv.Canny(gray, edges, 40, 120);
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE,
    );

    const imageArea = src.cols * src.rows;
    let bestArea = 0;
    let bestAngle = 0;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      try {
        const area = Math.abs(cv.contourArea(c));
        // Same outer-card gate as measureResidualSkewDeg — ignore QR/photo.
        if (area < imageArea * 0.35 || area > imageArea * 0.995) continue;
        if (area <= bestArea) continue;
        const rr = cv.minAreaRect(c);
        let angle = rr.angle;
        if (rr.size.width < rr.size.height) angle += 90;
        bestArea = area;
        bestAngle = normalizeDeskewAngleDeg(angle);
      } finally {
        deleteMat(c);
      }
    }

    // No reliable outer contour (frame-filling warp): use silhouette tilt sign.
    if (bestArea === 0) {
      let grayForTilt: CvMat | null = gray;
      const tiltAbs = measureSilhouetteTiltDeg(gray!);
      if (tiltAbs < ID_CARD_MICRO_DESKEW_MIN_DEG) {
        return {
          mat: src,
          applied: false,
          residualBefore,
          residualAfter: residualBefore,
        };
      }
      // Estimate signed tilt from left edge only.
      const w0 = gray!.cols;
      const h0 = gray!.rows;
      const data = gray!.data as Uint8Array;
      const yA = Math.floor(h0 * 0.2);
      const yB = Math.floor(h0 * 0.8);
      let lA = 0;
      let lB = 0;
      for (let x = 0; x < w0; x++) {
        if (data[yA * w0 + x]! > 40) {
          lA = x;
          break;
        }
      }
      for (let x = 0; x < w0; x++) {
        if (data[yB * w0 + x]! > 40) {
          lB = x;
          break;
        }
      }
      bestAngle = normalizeDeskewAngleDeg(
        (Math.atan2(lB - lA, Math.max(1, yB - yA)) * 180) / Math.PI,
      );
      void grayForTilt;
    }
    if (Math.abs(bestAngle) < ID_CARD_MICRO_DESKEW_MIN_DEG) {
      return {
        mat: src,
        applied: false,
        residualBefore,
        residualAfter: residualBefore,
      };
    }

    // Rotate opposite to measured skew (OpenCV positive = CCW).
    const rotation = bestAngle;
    const w = src.cols;
    const h = src.rows;
    const cx = w / 2;
    const cy = h / 2;
    M = cv.getRotationMatrix2D(new cv.Point(cx, cy), rotation, 1);
    const data = M.data64F as Float64Array;
    const absCos = Math.abs(data[0]!);
    const absSin = Math.abs(data[1]!);
    const boundW = Math.max(32, Math.floor(h * absSin + w * absCos));
    const boundH = Math.max(32, Math.floor(h * absCos + w * absSin));
    data[2]! += boundW / 2 - cx;
    data[5]! += boundH / 2 - cy;

    rotated = new cv.Mat();
    cv.warpAffine(
      src,
      rotated,
      M,
      new cv.Size(boundW, boundH),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
    );

    // Tight crop: drop near-black / border-replicate margins.
    let gray2: CvMat | null = null;
    let bin: CvMat | null = null;
    try {
      gray2 = new cv.Mat();
      bin = new cv.Mat();
      if (rotated.channels() === 1) rotated.copyTo(gray2);
      else cv.cvtColor(rotated, gray2, cv.COLOR_RGB2GRAY);
      cv.threshold(gray2, bin, 8, 255, cv.THRESH_BINARY);
      const bounds = cv.boundingRect(bin);
      const pad = 2;
      const x0 = Math.max(0, bounds.x - pad);
      const y0 = Math.max(0, bounds.y - pad);
      const cw = Math.min(rotated.cols - x0, bounds.width + pad * 2);
      const ch = Math.min(rotated.rows - y0, bounds.height + pad * 2);
      if (cw >= 32 && ch >= 32) {
        const roi = rotated.roi(new cv.Rect(x0, y0, cw, ch));
        const cropped = new cv.Mat();
        roi.copyTo(cropped);
        deleteMat(roi);
        deleteMat(rotated);
        rotated = cropped;
      }
    } finally {
      deleteMat(bin);
      deleteMat(gray2);
    }

    let out = ensureLandscapeMat(cv, rotated);
    rotated = null;
    const residualAfter = measureResidualSkewDeg(cv, out);
    // Reject micro-deskew if it did not improve (or worsened) residual skew.
    if (residualAfter >= residualBefore - 0.15) {
      deleteMat(out);
      return {
        mat: src,
        applied: false,
        residualBefore,
        residualAfter: residualBefore,
      };
    }
    deleteMat(src);
    return {
      mat: out,
      applied: true,
      residualBefore,
      residualAfter,
    };
  } catch {
    deleteMat(rotated);
    return {
      mat: src,
      applied: false,
      residualBefore,
      residualAfter: residualBefore,
    };
  } finally {
    deleteMat(M);
    deleteMat(hierarchy);
    deleteMat(contours);
    deleteMat(edges);
    deleteMat(gray);
  }
}

function isAcceptableCorrectedGeometry(
  cv: CvModule,
  mat: CvMat,
): { ok: boolean; residualSkewDeg: number } {
  const residualSkewDeg = measureResidualSkewDeg(cv, mat);
  const aspect = mat.cols / Math.max(1, mat.rows);
  const landscapeOk = aspect >= 1.05 && aspect <= 2.6;
  const skewOk = residualSkewDeg <= ID_CARD_MAX_RESIDUAL_SKEW_DEG;
  return { ok: landscapeOk && skewOk, residualSkewDeg };
}

export function applyPerspectiveCorrection(
  cv: CvModule,
  src: CvMat,
  corners: [Point, Point, Point, Point],
): CvMat {
  let ordered = orderCornersStable(corners);
  let [tl, tr, br, bl] = ordered;
  let outW = Math.max(
    32,
    Math.round(Math.max(dist(br, bl), dist(tr, tl))),
  );
  let outH = Math.max(
    32,
    Math.round(Math.max(dist(tr, br), dist(tl, bl))),
  );

  if (outH > outW * 1.05) {
    ordered = [tr, br, bl, tl];
    [tl, tr, br, bl] = ordered;
    const tmp = outW;
    outW = outH;
    outH = tmp;
  }

  const maxEdge = Math.max(outW, outH);
  if (maxEdge > ID_CARD_OUTPUT_MAX_EDGE) {
    const scale = ID_CARD_OUTPUT_MAX_EDGE / maxEdge;
    outW = Math.max(32, Math.round(outW * scale));
    outH = Math.max(32, Math.round(outH * scale));
  }

  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    tl.x,
    tl.y,
    tr.x,
    tr.y,
    br.x,
    br.y,
    bl.x,
    bl.y,
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    outW - 1,
    0,
    outW - 1,
    outH - 1,
    0,
    outH - 1,
  ]);

  let M: CvMat | null = null;
  const warped = new cv.Mat();
  try {
    M = cv.getPerspectiveTransform(srcTri, dstTri);
    cv.warpPerspective(
      src,
      warped,
      M,
      new cv.Size(outW, outH),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
    );
    // Destination already prefers landscape; force if near-square portrait slip.
    return ensureLandscapeMat(cv, warped);
  } catch (error) {
    deleteMat(warped);
    throw error;
  } finally {
    deleteMat(M);
    deleteMat(dstTri);
    deleteMat(srcTri);
  }
}

/**
 * Tier 2: rotate using minAreaRect angle, crop to transformed card bounds,
 * force landscape. Caller owns `src`. Returned Mat must be deleted by caller.
 */
export function applyDeskewCorrection(
  cv: CvModule,
  src: CvMat,
  corners: [Point, Point, Point, Point],
  skewAngleDeg: number,
): CvMat {
    let ptsMat: CvMat | null = null;
  let M: CvMat | null = null;
  let rotated: CvMat | null = null;
  let cropped: CvMat | null = null;

  try {
    const ordered = orderCornersStable(corners);
    ptsMat = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      ordered.flatMap((p) => [p.x, p.y]),
    );

    // Prefer OpenCV minAreaRect angle over approxPolyDP edge atan2.
    let rotation = normalizeDeskewAngleDeg(skewAngleDeg);
    let cropCorners: Point[] = ordered;
    try {
      const rr = cv.minAreaRect(ptsMat);
      let angle = rr.angle;
      if (rr.size.width < rr.size.height) {
        angle += 90;
      }
      rotation = normalizeDeskewAngleDeg(angle);
      cropCorners = cornersFromRotatedRect(rr);
    } catch {
      // Fall back to long-edge angle / provided corners.
    }

    const w = src.cols;
    const h = src.rows;
    const cx = w / 2;
    const cy = h / 2;

    M = cv.getRotationMatrix2D(new cv.Point(cx, cy), rotation, 1);
    const data = M.data64F as Float64Array;
    const absCos = Math.abs(data[0]!);
    const absSin = Math.abs(data[1]!);
    const boundW = Math.max(32, Math.floor(h * absSin + w * absCos));
    const boundH = Math.max(32, Math.floor(h * absCos + w * absSin));
    data[2]! += boundW / 2 - cx;
    data[5]! += boundH / 2 - cy;

    rotated = new cv.Mat();
    cv.warpAffine(
      src,
      rotated,
      M,
      new cv.Size(boundW, boundH),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
    );

    const mapped = transformPoints(
      cropCorners,
      data[0]!,
      data[1]!,
      data[2]!,
      data[3]!,
      data[4]!,
      data[5]!,
    );
    const xs = mapped.map((p) => p.x);
    const ys = mapped.map((p) => p.y);
    const pad = Math.max(2, Math.round(Math.min(boundW, boundH) * 0.008));
    let x0 = Math.floor(Math.min(...xs) - pad);
    let y0 = Math.floor(Math.min(...ys) - pad);
    let x1 = Math.ceil(Math.max(...xs) + pad);
    let y1 = Math.ceil(Math.max(...ys) + pad);
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(boundW, x1);
    y1 = Math.min(boundH, y1);
    const cropW = Math.max(32, x1 - x0);
    const cropH = Math.max(32, y1 - y0);

    const roi = rotated.roi(new cv.Rect(x0, y0, cropW, cropH));
    cropped = new cv.Mat();
    roi.copyTo(cropped);
    deleteMat(roi);

    let out = cropped;
    cropped = null;
    out = ensureLandscapeMat(cv, out);

    const maxEdge = Math.max(out.cols, out.rows);
    if (maxEdge > ID_CARD_OUTPUT_MAX_EDGE) {
      const scale = ID_CARD_OUTPUT_MAX_EDGE / maxEdge;
      const resized = new cv.Mat();
      cv.resize(
        out,
        resized,
        new cv.Size(
          Math.max(32, Math.round(out.cols * scale)),
          Math.max(32, Math.round(out.rows * scale)),
        ),
        0,
        0,
        cv.INTER_AREA,
      );
      deleteMat(out);
      out = resized;
    }

    return out;
  } catch (error) {
    deleteMat(cropped);
    deleteMat(rotated);
    rotated = null;
    throw error;
  } finally {
    deleteMat(ptsMat);
    deleteMat(M);
    deleteMat(rotated);
  }
}

export async function applySafeEnhancement(bytes: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mean = meanLuminance(data, info.channels);

  let pipeline = sharp(bytes);
  if (mean < 95) {
    pipeline = pipeline.modulate({ brightness: 1.08 }).normalize();
  } else if (mean < 125) {
    pipeline = pipeline.normalize();
  } else if (mean > 200) {
    pipeline = pipeline.linear(0.96, 8);
  }

  return pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
}

async function fallbackNormalize(
  orientedPng: Buffer,
  reason: IdCardFallbackReason,
  diagnostics?: IdCardNormalizationDiagnostics,
): Promise<NormalizedIdCardImageWithDiagnostics> {
  const enhanced = await applySafeEnhancement(orientedPng);
  const meta = await sharp(enhanced).metadata();
  const result: NormalizedIdCardImageWithDiagnostics = {
    bytes: enhanced,
    format: "jpeg",
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    mode: "fallback_exif_enhance",
    confidence: 0,
    perspectiveApplied: false,
    deskewApplied: false,
    correctionType: "fallback",
    fallbackReason: reason,
  };
  if (diagnostics) {
    result.diagnostics = {
      ...diagnostics,
      fallbackReason: reason,
      correctionType: "fallback",
      perspectiveApplied: false,
      deskewApplied: false,
    };
  }
  return result;
}

function toDiagList(candidates: CardCandidate[]): IdCardCandidateDiag[] {
  return candidates.slice(0, 5).map((c) => ({
    areaRatio: Number(c.areaRatio.toFixed(4)),
    aspect: Number(c.aspect.toFixed(4)),
    rectangularity: Number(c.rectangularity.toFixed(4)),
    borderTouch: c.borderTouch,
    sideVariance: Number(c.sideVariance.toFixed(4)),
    angleDeg: Number(c.angleDeg.toFixed(2)),
    score: Number(c.score.toFixed(4)),
    sourcePass: c.sourcePass,
    corners: c.corners.map((p) => ({
      x: Math.round(p.x),
      y: Math.round(p.y),
    })),
  }));
}

function emptyDiag(
  pre: { width: number; height: number },
  reason: IdCardFallbackReason,
): IdCardNormalizationDiagnostics {
  return {
    inputWidth: pre.width,
    inputHeight: pre.height,
    workingWidth: 0,
    workingHeight: 0,
    contourCount: 0,
    quadCandidateCount: 0,
    topCandidates: [],
    selectedScore: null,
    selectedAngleDeg: null,
    selectedAspect: null,
    destinationWidth: null,
    destinationHeight: null,
    residualSkewDeg: null,
    correctionType: "fallback",
    fallbackReason: reason,
    perspectiveApplied: false,
    deskewApplied: false,
  };
}

/**
 * Normalize one ID-card side image for printing.
 * Hard failures (corrupt/unsupported) throw.
 * Soft CV failures use safe fallback (never throw for weak detection).
 */
export async function normalizeIdCardImage(
  input: NormalizeIdCardImageInput,
): Promise<NormalizedIdCardImageWithDiagnostics> {
  const format = normalizeIdCardImageFormat(input.format);
  if (!format) {
    throw new Error("ID card image must be a JPEG or PNG.");
  }

  const bytes = toBuffer(input.bytes);
  if (bytes.byteLength === 0) {
    throw new Error("ID card image is empty.");
  }
  if (bytes.byteLength > ID_CARD_MAX_IMAGE_BYTES) {
    throw new Error(
      `ID card image must be less than ${Math.round(ID_CARD_MAX_IMAGE_BYTES / (1024 * 1024))} MB.`,
    );
  }

  try {
    await sharp(bytes).metadata();
  } catch {
    throw new Error("ID card image could not be read. Use a valid JPEG or PNG.");
  }

  const pre = await preprocessIdCardImage(bytes);
  const wantDiag = Boolean(input.includeDiagnostics);

  if (pre.skipGeometry) {
    return fallbackNormalize(
      pre.orientedPng,
      "skip_geometry",
      wantDiag ? emptyDiag(pre, "skip_geometry") : undefined,
    );
  }

  let srcFull: CvMat | null = null;
  let srcWork: CvMat | null = null;
  let corrected: CvMat | null = null;
  let workIsAlias = false;

  try {
    const cv = await getOpenCV();
    srcFull = await decodeToRgbMat(cv, pre.orientedPng);

    const workScale = Math.min(
      1,
      ID_CARD_CV_MAX_EDGE / Math.max(srcFull.cols, srcFull.rows),
    );

    if (workScale < 1) {
      srcWork = new cv.Mat();
      cv.resize(
        srcFull,
        srcWork,
        new cv.Size(
          Math.max(8, Math.round(srcFull.cols * workScale)),
          Math.max(8, Math.round(srcFull.rows * workScale)),
        ),
        0,
        0,
        cv.INTER_AREA,
      );
    } else {
      srcWork = srcFull;
      workIsAlias = true;
    }

    const { candidates, contourCount } = detectCardCandidates(cv, srcWork);
    const best = candidates[0];
    const perspectiveDecision = shouldApplyPerspectiveCorrection(best);
    const deskewDecision = shouldApplyDeskewCorrection(best);

    const baseDiag: IdCardNormalizationDiagnostics | undefined = wantDiag
      ? {
          inputWidth: pre.width,
          inputHeight: pre.height,
          workingWidth: srcWork.cols,
          workingHeight: srcWork.rows,
          contourCount,
          quadCandidateCount: candidates.length,
          topCandidates: toDiagList(candidates),
          selectedScore: best ? Number(best.score.toFixed(4)) : null,
          selectedAngleDeg: best
            ? Number(normalizeDeskewAngleDeg(best.angleDeg).toFixed(2))
            : null,
          selectedAspect: best ? Number(best.aspect.toFixed(4)) : null,
          selectedCorners: best
            ? best.corners.map((p) => ({
                x: Math.round(p.x),
                y: Math.round(p.y),
              }))
            : undefined,
          destinationWidth: null,
          destinationHeight: null,
          residualSkewDeg: null,
          correctionType: "fallback",
          fallbackReason: perspectiveDecision.ok
            ? "none"
            : deskewDecision.ok
              ? "none"
              : deskewDecision.reason !== "no_candidates"
                ? deskewDecision.reason
                : perspectiveDecision.reason,
          perspectiveApplied: false,
          deskewApplied: false,
        }
      : undefined;

    const scaleX = srcFull.cols / srcWork.cols;
    const scaleY = srcFull.rows / srcWork.rows;

    async function finalizeCorrected(
      mat: CvMat,
      mode: "perspective" | "deskew",
      confidence: number,
      angleDeg: number,
      aspect: number,
      sourceCorners: [Point, Point, Point, Point],
    ): Promise<NormalizedIdCardImageWithDiagnostics | null> {
      let working = mat;
      const micro = applyMicroDeskewIfNeeded(cv, working);
      working = micro.mat;

      const check = isAcceptableCorrectedGeometry(cv, working);
      if (!check.ok) {
        deleteMat(working);
        return null;
      }

      const destW = working.cols;
      const destH = working.rows;
      const encoded = await encodeMatJpeg(working, 92);
      deleteMat(working);

      const enhanced = await applySafeEnhancement(encoded.bytes);
      const meta = await sharp(enhanced).metadata();
      const result: NormalizedIdCardImageWithDiagnostics = {
        bytes: enhanced,
        format: "jpeg",
        width: meta.width ?? encoded.width,
        height: meta.height ?? encoded.height,
        mode,
        confidence,
        perspectiveApplied: mode === "perspective",
        deskewApplied: mode === "deskew" || micro.applied,
        correctionType: mode,
        fallbackReason: "none",
      };
      if (baseDiag) {
        result.diagnostics = {
          ...baseDiag,
          fallbackReason: "none",
          correctionType: mode,
          perspectiveApplied: mode === "perspective",
          deskewApplied: mode === "deskew" || micro.applied,
          selectedAngleDeg: Number(angleDeg.toFixed(2)),
          selectedAspect: Number(aspect.toFixed(4)),
          selectedCorners: sourceCorners.map((p) => ({
            x: Math.round(p.x),
            y: Math.round(p.y),
          })),
          destinationWidth: destW,
          destinationHeight: destH,
          residualSkewDeg: Number(check.residualSkewDeg.toFixed(2)),
        };
      }
      return result;
    }

    // --- Tier 1: perspective (corners refined via minAreaRect for clean rotation) ---
    if (perspectiveDecision.ok && best) {
      const refined = refineCornersWithMinAreaRect(cv, best.corners);
      const fullCorners = scaleCorners(refined, scaleX, scaleY);
      try {
        corrected = applyPerspectiveCorrection(cv, srcFull, fullCorners);
      } catch {
        deleteMat(corrected);
        corrected = null;
      }

      if (corrected) {
        const owned = corrected;
        corrected = null;
        const finalized = await finalizeCorrected(
          owned,
          "perspective",
          best.score,
          normalizeDeskewAngleDeg(best.angleDeg),
          best.aspect,
          fullCorners,
        );
        if (finalized) {
          if (!workIsAlias) deleteMat(srcWork);
          srcWork = null;
          deleteMat(srcFull);
          srcFull = null;
          return finalized;
        }
        // Geometry worsened — try Tier 2 / fallback below.
      }
    }

    // --- Tier 2: conservative deskew (when perspective unavailable / failed / rejected) ---
    if (deskewDecision.ok && best) {
      const refined = refineCornersWithMinAreaRect(cv, best.corners);
      const fullCorners = scaleCorners(refined, scaleX, scaleY);
      try {
        corrected = applyDeskewCorrection(
          cv,
          srcFull,
          fullCorners,
          deskewDecision.angleDeg,
        );
      } catch {
        deleteMat(corrected);
        corrected = null;
      }

      if (corrected) {
        const owned = corrected;
        corrected = null;
        const finalized = await finalizeCorrected(
          owned,
          "deskew",
          best.score,
          deskewDecision.angleDeg,
          best.aspect,
          fullCorners,
        );
        if (finalized) {
          if (!workIsAlias) deleteMat(srcWork);
          srcWork = null;
          deleteMat(srcFull);
          srcFull = null;
          return finalized;
        }
      }
    }

    // --- Tier 3: safe fallback ---
    const reason: IdCardFallbackReason = !best
      ? "no_candidates"
      : perspectiveDecision.ok || deskewDecision.ok
        ? "geometry_worsened"
        : perspectiveDecision.reason === "below_threshold" &&
            deskewDecision.reason !== "none"
          ? deskewDecision.reason === "deskew_unsafe"
            ? "deskew_unsafe"
            : perspectiveDecision.reason
          : perspectiveDecision.reason === "warp_failed"
            ? "warp_failed"
            : perspectiveDecision.reason;

    if (!workIsAlias) deleteMat(srcWork);
    srcWork = null;
    deleteMat(srcFull);
    srcFull = null;
    return fallbackNormalize(
      pre.orientedPng,
      reason === "none" ? "below_threshold" : reason,
      baseDiag
        ? { ...baseDiag, fallbackReason: reason === "none" ? "below_threshold" : reason }
        : undefined,
    );
  } catch {
    deleteMat(corrected);
    if (!workIsAlias) deleteMat(srcWork);
    deleteMat(srcFull);
    return fallbackNormalize(
      pre.orientedPng,
      "cv_exception",
      wantDiag ? emptyDiag(pre, "cv_exception") : undefined,
    );
  }
}

/**
 * Test/dev helper: run normalization with diagnostics always attached.
 */
export async function diagnoseIdCardImage(
  input: Omit<NormalizeIdCardImageInput, "includeDiagnostics">,
): Promise<NormalizedIdCardImageWithDiagnostics> {
  return normalizeIdCardImage({ ...input, includeDiagnostics: true });
}
