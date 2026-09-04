/**
 * Canonical print-settings foundation (Phase A/B).
 *
 * Single source of truth for v1 defaults + safe parsing.
 * Web app imports this module; the Print Agent keeps an identical copy at
 * `print-agent/src/print-settings.ts` (packaging / rootDir constraints).
 * Keep both files byte-identical - enforced by phase8a/phase8b smoke.
 *
 * PrintJob.copies remains the pricing/billing source of truth.
 * printSettings.copies is a printing instruction only and must not diverge
 * silently when settings are stored.
 */

export const PRINT_SETTINGS_VERSION = 1 as const;

export type PrintOrientationV1 = "portrait" | "landscape";
export type PrintPaperSizeV1 = "A4";
export type PrintScaleV1 = "fit";
export type PrintMarginsV1 = "normal";

export type PrintSettingsV1 = {
  v: typeof PRINT_SETTINGS_VERSION;
  orientation: PrintOrientationV1;
  copies: number;
  paperSize: PrintPaperSizeV1;
  scale: PrintScaleV1;
  margins: PrintMarginsV1;
};

/** Canonical defaults - do not duplicate elsewhere. */
export const DEFAULT_PRINT_SETTINGS_V1: PrintSettingsV1 = {
  v: PRINT_SETTINGS_VERSION,
  orientation: "portrait",
  copies: 1,
  paperSize: "A4",
  scale: "fit",
  margins: "normal",
};

const ORIENTATIONS = new Set<string>(["portrait", "landscape"]);
const PAPER_SIZES = new Set<string>(["A4"]);
const SCALES = new Set<string>(["fit"]);
const MARGINS = new Set<string>(["normal"]);

const MAX_COPIES = 999;

/**
 * Build a stored v1 settings object. Always pass PrintJob.copies so
 * printSettings.copies stays aligned with the pricing source of truth.
 */
export function buildPrintSettingsV1(input: {
  copies: number;
  orientation?: PrintOrientationV1;
}): PrintSettingsV1 {
  const orientation: PrintOrientationV1 =
    input.orientation === "landscape" ? "landscape" : "portrait";

  return {
    ...DEFAULT_PRINT_SETTINGS_V1,
    orientation,
    copies: normalizeCopies(input.copies, DEFAULT_PRINT_SETTINGS_V1.copies),
  };
}

/**
 * Build stored v1 defaults (portrait). Pass jobCopies so printSettings.copies
 * matches PrintJob.copies when settings are persisted.
 */
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
      /** True when at least one field was corrected or defaulted. */
      repaired: boolean;
    };

export type ResolvePrintSettingsOptions = {
  /**
   * When printSettings.copies is invalid/missing, prefer PrintJob.copies
   * so the printing instruction stays aligned with pricing.
   */
  fallbackCopies?: number;
};

/**
 * Safely parse DB/API printSettings. Never throws.
 * Unknown fields are ignored. Invalid known fields fall back to defaults.
 */
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
    // Unknown version: treat as unusable (do not invent behavior).
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
    },
  };
}

/** True when Agent / printer path should keep pre-settings behavior. */
export function shouldUseLegacyPrintBehavior(
  resolved: ResolvedPrintSettings,
): boolean {
  return resolved.source === "legacy";
}

export type JobPrintPlan = {
  /** Image->PDF page orientation. Legacy -> portrait (today). */
  imageOrientation: PrintOrientationV1;
  /**
   * Sumatra orientation flag. Undefined = omit (legacy / portrait default).
   * Only "landscape" is passed for v1 landscape jobs.
   */
  sumatraOrientation: "landscape" | undefined;
};

/**
 * Resolve how the Agent should print from optional printSettings.
 * Never throws. Legacy/malformed -> today's portrait behavior.
 */
export function planJobPrint(
  rawSettings: unknown,
  jobCopies: number,
): JobPrintPlan {
  try {
    const resolved = resolvePrintSettings(rawSettings, {
      fallbackCopies: jobCopies,
    });

    if (shouldUseLegacyPrintBehavior(resolved) || !resolved.settings) {
      return {
        imageOrientation: "portrait",
        sumatraOrientation: undefined,
      };
    }

    if (resolved.settings.orientation === "landscape") {
      return {
        imageOrientation: "landscape",
        sumatraOrientation: "landscape",
      };
    }

    return {
      imageOrientation: "portrait",
      sumatraOrientation: undefined,
    };
  } catch {
    return {
      imageOrientation: "portrait",
      sumatraOrientation: undefined,
    };
  }
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
