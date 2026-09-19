/**
 * Environment helpers for choosing mobile vs desktop PDF preview strategy.
 * No pdfjs dependency — safe to import from Node smoke tests.
 */

export type PdfPreviewEnv = {
  userAgent?: string;
  maxTouchPoints?: number;
  matchesNarrow?: boolean;
  matchesCoarsePointer?: boolean;
};

/** @deprecated Alias of PdfPreviewEnv */
export type PdfOpenFallbackEnv = PdfPreviewEnv;

/**
 * Mobile / narrow / coarse-pointer browsers often leave PDF blob iframes blank.
 * Prefer canvas rendering (pdfjs) for those environments.
 */
export function needsInlinePdfCanvasPreview(env: PdfPreviewEnv = {}): boolean {
  const ua = env.userAgent ?? "";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) {
    return true;
  }
  if (env.matchesNarrow === true) {
    return true;
  }
  if (env.matchesCoarsePointer === true && (env.maxTouchPoints ?? 0) > 0) {
    return true;
  }
  return false;
}

/** @deprecated Use needsInlinePdfCanvasPreview */
export const needsMobilePdfOpenFallback = needsInlinePdfCanvasPreview;

export function readPdfPreviewEnv(): PdfPreviewEnv {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return {};
  }
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    matchesNarrow: window.matchMedia?.("(max-width: 768px)")?.matches ?? false,
    matchesCoarsePointer:
      window.matchMedia?.("(pointer: coarse)")?.matches ?? false,
  };
}

/** @deprecated Prefer readPdfPreviewEnv */
export const readPdfOpenFallbackEnv = readPdfPreviewEnv;
