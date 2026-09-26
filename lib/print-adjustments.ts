/**
 * Brightness + content-scale helpers for printable artifacts.
 *
 * Semantics (preview and final print must share these):
 * - brightness 100% = neutral / original (no pixel change)
 * - brightness <100% = darker (linear gain)
 * - brightness >100% = brighter (linear gain)
 * - contentScale 100% = neutral fit size; lower shrinks, higher enlarges (clamped to box)
 *
 * Server applies sharp.linear(factor, 0). Preview should use the same baked
 * artifact when possible; CSS filter is only a live fallback and must not
 * double-apply when the PDF/image is already baked.
 */

import sharp from "sharp";

import {
  normalizeBrightnessPercent,
  normalizeContentScalePercent,
} from "@/lib/print-settings";

export type PrintAdjustmentOptions = {
  brightness?: unknown;
  contentScale?: unknown;
};

export function resolvePrintAdjustments(input?: PrintAdjustmentOptions): {
  brightness: number;
  contentScale: number;
  factor: number;
  scaleFactor: number;
} {
  const brightness = normalizeBrightnessPercent(input?.brightness);
  const contentScale = normalizeContentScalePercent(input?.contentScale);
  return {
    brightness,
    contentScale,
    factor: brightness / 100,
    scaleFactor: contentScale / 100,
  };
}

/**
 * Apply brightness to image bytes. 100% returns original buffer (copy).
 * Uses linear gain so 50% darkens and 150% brightens predictably.
 * Matches the intended preview semantics (factor = percent / 100).
 */
export async function applyBrightnessToImageBytes(
  bytes: Uint8Array | Buffer,
  brightnessPercent: unknown,
): Promise<Buffer> {
  const brightness = normalizeBrightnessPercent(brightnessPercent);
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (brightness === 100) {
    return Buffer.from(input);
  }
  const factor = brightness / 100;
  const meta = await sharp(input).metadata();
  const adjusted = sharp(input).rotate().linear(factor, 0);
  if (meta.format === "png") {
    return adjusted.png().toBuffer();
  }
  return adjusted.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/**
 * Scale a fitted draw box by contentScale%, then clamp so it never
 * overflows the available slot (preserves aspect ratio).
 */
export function scaleDrawInBox(
  fitted: { width: number; height: number; x: number; y: number },
  box: { width: number; height: number },
  contentScalePercent: unknown,
): { width: number; height: number; x: number; y: number } {
  const scaleFactor = normalizeContentScalePercent(contentScalePercent) / 100;
  if (scaleFactor === 1) {
    return { ...fitted };
  }

  let width = fitted.width * scaleFactor;
  let height = fitted.height * scaleFactor;
  const overflow = Math.max(width / box.width, height / box.height, 1);
  if (overflow > 1) {
    width /= overflow;
    height /= overflow;
  }

  return {
    width,
    height,
    x: (box.width - width) / 2,
    y: (box.height - height) / 2,
  };
}
