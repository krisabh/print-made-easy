/**
 * Canonical print-settings (Phase A/B/C).
 *
 * Web: import via @/lib/print-settings.
 * Agent: identical copy at print-agent/src/print-settings.ts.
 *
 * PrintJob.copies remains pricing SOT. printSettings.copies is print-only.
 */

export const PRINT_SETTINGS_VERSION = 1 as const;

export type PrintOrientationV1 = "portrait" | "landscape";
export type PrintPaperSizeV1 = "A4";
/** fit = Sumatra "fit"; noscale = Actual size (Sumatra noscale). */
export type PrintScaleV1 = "fit" | "noscale";
export type PrintMarginsV1 = "normal" | "none";

export type PrintSettingsV1 = {
  v: typeof PRINT_SETTINGS_VERSION;
  orientation: PrintOrientationV1;
  copies: number;
  paperSize: PrintPaperSizeV1;
  scale: PrintScaleV1;
  margins: PrintMarginsV1;
  /** "all" or Sumatra page list, e.g. "1-5,8". Does not affect pricing. */
  pageRange: string;
};

/** Canonical defaults - do not duplicate elsewhere. */
export const DEFAULT_PRINT_SETTINGS_V1: PrintSettingsV1 = {
  v: PRINT_SETTINGS_VERSION,
  orientation: "portrait",
  copies: 1,
  paperSize: "A4",
  scale: "fit",
  margins: "normal",
  pageRange: "all",
};

const ORIENTATIONS = new Set<string>(["portrait", "landscape"]);
const PAPER_SIZES = new Set<string>(["A4"]);
const SCALES = new Set<string>(["fit", "noscale"]);
const MARGINS = new Set<string>(["normal", "none"]);

const MAX_COPIES = 999;
const PAGE_RANGE_RE = /^(\d+(-\d+)?)(,\s*\d+(-\d+)?)*$/;

/**
 * Build a stored v1 settings object. Always pass PrintJob.copies so
 * printSettings.copies stays aligned with the pricing source of truth.
 */
export function buildPrintSettingsV1(input: {
  copies: number;
  orientation?: PrintOrientationV1;
  scale?: PrintScaleV1;
  margins?: PrintMarginsV1;
  pageRange?: string;
  paperSize?: PrintPaperSizeV1;
}): PrintSettingsV1 {
  const orientation: PrintOrientationV1 =
    input.orientation === "landscape" ? "landscape" : "portrait";
  const scale: PrintScaleV1 =
    input.scale === "noscale" ? "noscale" : "fit";
  const margins: PrintMarginsV1 =
    input.margins === "none" ? "none" : "normal";
  const paperSize: PrintPaperSizeV1 =
    input.paperSize === "A4" ? "A4" : DEFAULT_PRINT_SETTINGS_V1.paperSize;

  return {
    ...DEFAULT_PRINT_SETTINGS_V1,
    orientation,
    scale,
    margins,
    paperSize,
    pageRange: normalizePageRangeInput(input.pageRange),
    copies: normalizeCopies(input.copies, DEFAULT_PRINT_SETTINGS_V1.copies),
  };
}

export function buildDefaultPrintSettingsV1(
  jobCopies: number = DEFAULT_PRINT_SETTINGS_V1.copies,
): PrintSettingsV1 {
  return buildPrintSettingsV1({ copies: jobCopies });
}

export type ResolvedPrintSettings =
  | {
      /** null / missing / non-object - preserve today's print behavior. */
      source: "legacy";
      settings: null;
    }
  | {
      source: "v1";
      settings: PrintSettingsV1;
      repaired: boolean;
    };

export type ResolvePrintSettingsOptions = {
  fallbackCopies?: number;
};

export function resolvePrintSettings(
  raw: unknown,
  options?: ResolvePrintSettingsOptions,
): ResolvedPrintSettings {
  if (raw == null) {
    return { source: "legacy", settings: null };
  }

  if (typeof raw === "string") {
    try {
      return resolvePrintSettings(JSON.parse(raw) as unknown, options);
    } catch {
      return { source: "legacy", settings: null };
    }
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { source: "legacy", settings: null };
  }

  const obj = raw as Record<string, unknown>;
  let repaired = false;

  const version = obj.v;
  if (version !== PRINT_SETTINGS_VERSION && version !== undefined) {
    if (typeof version !== "number" || version !== 1) {
      return { source: "legacy", settings: null };
    }
  }
  if (version === undefined) {
    repaired = true;
  }

  const orientationRaw = obj.orientation;
  let orientation: PrintOrientationV1 = DEFAULT_PRINT_SETTINGS_V1.orientation;
  if (typeof orientationRaw === "string" && ORIENTATIONS.has(orientationRaw)) {
    orientation = orientationRaw as PrintOrientationV1;
  } else if (orientationRaw !== undefined) {
    repaired = true;
  } else {
    repaired = true;
  }

  const fallbackCopies =
    options?.fallbackCopies !== undefined
      ? normalizeCopies(
          options.fallbackCopies,
          DEFAULT_PRINT_SETTINGS_V1.copies,
        )
      : DEFAULT_PRINT_SETTINGS_V1.copies;

  let copies = fallbackCopies;
  if (obj.copies === undefined) {
    repaired = true;
  } else {
    const normalized = tryNormalizeCopies(obj.copies);
    if (normalized === null) {
      repaired = true;
      copies = fallbackCopies;
    } else {
      copies = normalized;
    }
  }

  const paperSizeRaw = obj.paperSize;
  let paperSize: PrintPaperSizeV1 = DEFAULT_PRINT_SETTINGS_V1.paperSize;
  if (typeof paperSizeRaw === "string" && PAPER_SIZES.has(paperSizeRaw)) {
    paperSize = paperSizeRaw as PrintPaperSizeV1;
  } else if (paperSizeRaw !== undefined) {
    repaired = true;
  } else {
    repaired = true;
  }

  const scaleRaw = obj.scale;
  let scale: PrintScaleV1 = DEFAULT_PRINT_SETTINGS_V1.scale;
  if (typeof scaleRaw === "string" && SCALES.has(scaleRaw)) {
    scale = scaleRaw as PrintScaleV1;
  } else if (scaleRaw !== undefined) {
    repaired = true;
  } else {
    repaired = true;
  }

  const marginsRaw = obj.margins;
  let margins: PrintMarginsV1 = DEFAULT_PRINT_SETTINGS_V1.margins;
  if (typeof marginsRaw === "string" && MARGINS.has(marginsRaw)) {
    margins = marginsRaw as PrintMarginsV1;
  } else if (marginsRaw !== undefined) {
    repaired = true;
  } else {
    repaired = true;
  }

  let pageRange = DEFAULT_PRINT_SETTINGS_V1.pageRange;
  if (obj.pageRange === undefined) {
    // Pre-Phase-C v1 objects omit pageRange — default "all" without treating as broken.
    pageRange = "all";
  } else {
    const normalized = tryNormalizePageRange(obj.pageRange);
    if (normalized === null) {
      repaired = true;
      pageRange = "all";
    } else {
      pageRange = normalized;
    }
  }

  return {
    source: "v1",
    repaired,
    settings: {
      v: PRINT_SETTINGS_VERSION,
      orientation,
      copies,
      paperSize,
      scale,
      margins,
      pageRange,
    },
  };
}

export function shouldUseLegacyPrintBehavior(
  resolved: ResolvedPrintSettings,
): boolean {
  return resolved.source === "legacy";
}

/** True if string is a safe Sumatra pages token (or "all"). */
export function isValidPageRange(value: unknown): boolean {
  return tryNormalizePageRange(value) !== null;
}

export type JobPrintPlan = {
  imageOrientation: PrintOrientationV1;
  sumatraOrientation: "landscape" | undefined;
  /** Sumatra scale. Legacy jobs use fit (today). */
  scale: PrintScaleV1;
  /** Undefined means all pages. */
  pages: string | undefined;
  /** Image conversion margin in PDF points. */
  imageMarginPt: number;
  paperSize: PrintPaperSizeV1;
};

/**
 * Resolve how the Agent should print from optional printSettings.
 * Never throws. Legacy/malformed -> today's behavior.
 */
export function planJobPrint(
  rawSettings: unknown,
  jobCopies: number,
): JobPrintPlan {
  const legacy: JobPrintPlan = {
    imageOrientation: "portrait",
    sumatraOrientation: undefined,
    scale: "fit",
    pages: undefined,
    imageMarginPt: 24,
    paperSize: "A4",
  };

  try {
    const resolved = resolvePrintSettings(rawSettings, {
      fallbackCopies: jobCopies,
    });

    if (shouldUseLegacyPrintBehavior(resolved) || !resolved.settings) {
      return legacy;
    }

    const s = resolved.settings;
    return {
      imageOrientation: s.orientation === "landscape" ? "landscape" : "portrait",
      sumatraOrientation:
        s.orientation === "landscape" ? "landscape" : undefined,
      scale: s.scale === "noscale" ? "noscale" : "fit",
      pages: s.pageRange === "all" ? undefined : s.pageRange,
      imageMarginPt: s.margins === "none" ? 0 : 24,
      paperSize: "A4",
    };
  } catch {
    return legacy;
  }
}

function tryNormalizePageRange(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return "all";
  if (trimmed.toLowerCase() === "all") return "all";
  if (!PAGE_RANGE_RE.test(trimmed)) return null;

  const parts = trimmed.split(",").map((p) => p.trim());
  for (const part of parts) {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map((n) => Number(n));
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1) {
        return null;
      }
      if (a > b) return null;
    } else {
      const n = Number(part);
      if (!Number.isInteger(n) || n < 1) return null;
    }
  }
  return parts.join(",");
}

function normalizePageRangeInput(value: string | undefined): string {
  return tryNormalizePageRange(value ?? "all") ?? "all";
}

function tryNormalizeCopies(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const n = Math.floor(value);
  if (n < 1 || n > MAX_COPIES) {
    return null;
  }
  return n;
}

function normalizeCopies(value: unknown, fallback: number): number {
  return tryNormalizeCopies(value) ?? fallback;
}
