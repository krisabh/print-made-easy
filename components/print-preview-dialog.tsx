"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  needsInlinePdfCanvasPreview,
  readPdfPreviewEnv,
} from "@/lib/pdf-preview-env";
import { extensionFromFileName } from "@/lib/print-file-category";
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  BRIGHTNESS_STEP,
  CONTENT_SCALE_MAX,
  CONTENT_SCALE_MIN,
  CONTENT_SCALE_STEP,
} from "@/lib/print-settings";
import type { renderPdfPageToCanvas as RenderPdfPageToCanvas } from "@/lib/client-pdf-preview";

export type PreviewPrintMode = "BW" | "COLOR";
export type PreviewOrientation = "portrait" | "landscape";
export type PreviewMargins = "normal" | "none";
/** Sumatra page-fit mode (not the customer content Scale %). */
export type PreviewScale = "fit" | "noscale";

export type NormalPreviewFile = {
  id: string;
  file: File;
};

type PreviewPage =
  | {
      kind: "image";
      key: string;
      url: string;
      label: string;
      fileName: string;
    }
  | {
      kind: "pdf";
      key: string;
      url: string;
      label: string;
      fileName: string;
      estimatedPages: number;
    }
  | {
      kind: "unavailable";
      key: string;
      label: string;
      fileName: string;
      message: string;
    };

type PrintPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  loading?: boolean;
  error?: string | null;
  /** When set, shows a single PDF preview (ID-card A4). */
  pdfUrl?: string | null;
  /** Normal-print multi-page items. */
  pages?: PreviewPage[];
  pageIndex?: number;
  onPageIndexChange?: (index: number) => void;
  printMode?: PreviewPrintMode;
  orientation?: PreviewOrientation;
  margins?: PreviewMargins;
  /** Sumatra fit mode — visual hint only for images. */
  pageFit?: PreviewScale;
  /** Soft note shown under the viewer (settings / range hints). */
  settingsNote?: string | null;
  /** Print type label for the info strip. */
  printTypeLabel?: string;
  fileInfoLabel?: string | null;
  brightness: number;
  contentScale: number;
  onBrightnessChange: (value: number) => void;
  onContentScaleChange: (value: number) => void;
  onResetAdjustments: () => void;
  /** Called when customer confirms adjustments (keeps dialog values). */
  onApply?: () => void;
  applyLabel?: string;
  /** When true, brightness/scale changes re-fetch server PDF (ID card). */
  adjustmentsPending?: boolean;
};

export type { PdfOpenFallbackEnv, PdfPreviewEnv } from "@/lib/pdf-preview-env";
export {
  needsInlinePdfCanvasPreview,
  needsMobilePdfOpenFallback,
  readPdfOpenFallbackEnv,
  readPdfPreviewEnv,
} from "@/lib/pdf-preview-env";

export function buildNormalPreviewPages(
  files: NormalPreviewFile[],
  pageCounts: Record<string, number>,
): PreviewPage[] {
  const pages: PreviewPage[] = [];
  for (const item of files) {
    const ext = extensionFromFileName(item.file.name);
    if (ext === "pdf") {
      pages.push({
        kind: "pdf",
        key: item.id,
        url: URL.createObjectURL(item.file),
        label: "PDF document",
        fileName: item.file.name,
        estimatedPages: pageCounts[item.id] ?? 1,
      });
      continue;
    }
    if (ext === "png" || ext === "jpg" || ext === "jpeg") {
      pages.push({
        kind: "image",
        key: item.id,
        url: URL.createObjectURL(item.file),
        label: "Image page",
        fileName: item.file.name,
      });
      continue;
    }
    pages.push({
      kind: "unavailable",
      key: item.id,
      label: "Unsupported for preview",
      fileName: item.file.name,
      message: "Preview isn't available for this file type.",
    });
  }
  return pages;
}

export function revokePreviewPages(pages: PreviewPage[]) {
  for (const page of pages) {
    if (page.kind === "image" || page.kind === "pdf") {
      URL.revokeObjectURL(page.url);
    }
  }
}

function snapPercent(value: number, min: number, max: number, step: number) {
  const snapped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

/**
 * Renders a PDF page to canvas so mobile browsers can show content inside
 * the dialog (blob iframes are often blank on iOS/Android).
 */
function PdfCanvasPreview({
  url,
  grayscale,
  brightness,
  contentScale,
  className,
}: {
  url: string;
  grayscale?: boolean;
  brightness: number;
  contentScale: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPageCount, setPdfPageCount] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setPdfPage(1);
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas || !url) return;

    setStatus("loading");
    setErrorMessage(null);

    (async () => {
      try {
        const { renderPdfPageToCanvas } = (await import(
          "@/lib/client-pdf-preview"
        )) as {
          renderPdfPageToCanvas: typeof RenderPdfPageToCanvas;
        };
        const result = await renderPdfPageToCanvas(url, pdfPage, canvas);
        if (cancelled) return;
        setPdfPageCount(result.pageCount);
        setPdfPage(result.pageNumber);
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Preview couldn't render this PDF.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, pdfPage]);

  const filterStyle = {
    filter: [
      grayscale ? "grayscale(1)" : null,
      `brightness(${brightness / 100})`,
    ]
      .filter(Boolean)
      .join(" "),
    transform: `scale(${contentScale / 100})`,
    transformOrigin: "center center",
  } as const;

  return (
    <div className="flex flex-col gap-2">
      <div
        className={[
          className,
          "flex items-center justify-center overflow-hidden bg-white",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {status === "loading" ? (
          <div className="flex flex-col items-center gap-2 text-slate-600">
            <Loader2 className="size-7 animate-spin text-blue-600" />
            <p className="text-xs">Rendering preview…</p>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="px-3 text-center text-sm text-amber-900">
            {errorMessage ?? "Preview couldn't render this PDF."}
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          style={filterStyle}
          className={[
            "max-h-full max-w-full rounded-md",
            status === "ready" ? "block" : "hidden",
          ].join(" ")}
        />
      </div>
      {pdfPageCount > 1 && status === "ready" ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10"
            disabled={pdfPage <= 1}
            onClick={() => setPdfPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Prev
          </Button>
          <p className="text-xs text-slate-500">
            Page {pdfPage} of {pdfPageCount}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10"
            disabled={pdfPage >= pdfPageCount}
            onClick={() => setPdfPage((p) => Math.min(pdfPageCount, p + 1))}
          >
            Next
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PdfPreviewSurface({
  url,
  title,
  grayscale,
  brightness,
  contentScale,
  frameClass,
  preferCanvas,
}: {
  url: string;
  title: string;
  grayscale: boolean;
  brightness: number;
  contentScale: number;
  frameClass: string;
  preferCanvas: boolean;
}) {
  if (preferCanvas) {
    return (
      <PdfCanvasPreview
        url={url}
        grayscale={grayscale}
        brightness={brightness}
        contentScale={contentScale}
        className={frameClass}
      />
    );
  }

  return (
    <div className={frameClass}>
      <div
        className="h-full w-full overflow-hidden"
        style={{
          filter: [
            grayscale ? "grayscale(1)" : null,
            `brightness(${brightness / 100})`,
          ]
            .filter(Boolean)
            .join(" "),
        }}
      >
        <iframe
          title={title}
          src={url}
          className="h-full w-full rounded-md border-0 bg-white"
          style={{
            transform: `scale(${contentScale / 100})`,
            transformOrigin: "center center",
          }}
        />
      </div>
    </div>
  );
}

function AdjustmentControls({
  brightness,
  contentScale,
  onBrightnessChange,
  onContentScaleChange,
  onReset,
  disabled,
}: {
  brightness: number;
  contentScale: number;
  onBrightnessChange: (v: number) => void;
  onContentScaleChange: (v: number) => void;
  onReset: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:p-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="preview-brightness" className="text-sm font-medium text-slate-800">
            Brightness
          </label>
          <span className="tabular-nums text-sm font-semibold text-slate-900">
            {brightness}%
          </span>
        </div>
        <input
          id="preview-brightness"
          type="range"
          min={BRIGHTNESS_MIN}
          max={BRIGHTNESS_MAX}
          step={BRIGHTNESS_STEP}
          value={brightness}
          disabled={disabled}
          onChange={(e) =>
            onBrightnessChange(
              snapPercent(
                Number(e.target.value),
                BRIGHTNESS_MIN,
                BRIGHTNESS_MAX,
                BRIGHTNESS_STEP,
              ),
            )
          }
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600 disabled:opacity-50"
          aria-valuemin={BRIGHTNESS_MIN}
          aria-valuemax={BRIGHTNESS_MAX}
          aria-valuenow={brightness}
          aria-label="Brightness"
        />
        <div className="flex justify-between text-[11px] text-slate-400">
          <span>{BRIGHTNESS_MIN}%</span>
          <span>100%</span>
          <span>{BRIGHTNESS_MAX}%</span>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-800">Scale</p>
        <div className="flex items-center justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            disabled={disabled || contentScale <= CONTENT_SCALE_MIN}
            aria-label="Decrease scale"
            onClick={() =>
              onContentScaleChange(
                snapPercent(
                  contentScale - CONTENT_SCALE_STEP,
                  CONTENT_SCALE_MIN,
                  CONTENT_SCALE_MAX,
                  CONTENT_SCALE_STEP,
                ),
              )
            }
          >
            <Minus className="size-4" />
          </Button>
          <span className="min-w-16 text-center text-base font-semibold tabular-nums text-slate-900">
            {contentScale}%
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            disabled={disabled || contentScale >= CONTENT_SCALE_MAX}
            aria-label="Increase scale"
            onClick={() =>
              onContentScaleChange(
                snapPercent(
                  contentScale + CONTENT_SCALE_STEP,
                  CONTENT_SCALE_MIN,
                  CONTENT_SCALE_MAX,
                  CONTENT_SCALE_STEP,
                ),
              )
            }
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <p className="text-center text-[11px] text-slate-500">
          Print size on the page · {CONTENT_SCALE_MIN}%–{CONTENT_SCALE_MAX}%
        </p>
      </div>

      <div className="flex justify-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || (brightness === 100 && contentScale === 100)}
          onClick={onReset}
          className="text-slate-600"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Reset
        </Button>
      </div>
    </div>
  );
}

export function PrintPreviewDialog({
  open,
  onOpenChange,
  title = "Preview & Adjust",
  description,
  loading = false,
  error = null,
  pdfUrl = null,
  pages = [],
  pageIndex = 0,
  onPageIndexChange,
  printMode = "COLOR",
  orientation = "portrait",
  margins = "normal",
  pageFit = "fit",
  settingsNote = null,
  printTypeLabel = "Normal Print",
  fileInfoLabel = null,
  brightness,
  contentScale,
  onBrightnessChange,
  onContentScaleChange,
  onResetAdjustments,
  onApply,
  applyLabel = "Save & Continue",
  adjustmentsPending = false,
}: PrintPreviewDialogProps) {
  const safeIndex =
    pages.length === 0 ? 0 : Math.min(Math.max(0, pageIndex), pages.length - 1);
  const current = pages[safeIndex];
  const totalPages = pdfUrl ? 1 : pages.length;
  const grayscale = printMode === "BW";
  const [preferCanvas, setPreferCanvas] = useState(false);

  const frameClass = useMemo(() => {
    const pad = margins === "none" ? "p-1" : "p-4 sm:p-5";
    const aspect =
      orientation === "landscape" ? "aspect-[1.414/1]" : "aspect-[1/1.414]";
    return [
      "mx-auto w-full max-w-[min(100%,22rem)] overflow-hidden rounded-md border border-slate-300 bg-white shadow-md",
      aspect,
      pad,
    ].join(" ");
  }, [margins, orientation]);

  const infoLine = useMemo(() => {
    if (fileInfoLabel) return fileInfoLabel;
    if (pdfUrl) return printTypeLabel;
    if (current?.kind === "pdf") {
      return `${current.fileName} · ${current.estimatedPages} page${current.estimatedPages === 1 ? "" : "s"} · ${printTypeLabel}`;
    }
    if (current?.fileName) {
      return `${current.fileName} · ${printTypeLabel}`;
    }
    return printTypeLabel;
  }, [current, fileInfoLabel, pdfUrl, printTypeLabel]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) {
      setPreferCanvas(false);
      return;
    }
    setPreferCanvas(needsInlinePdfCanvasPreview(readPdfPreviewEnv()));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(92vh,900px)] w-full max-w-[calc(100%-1rem)] flex-col gap-3 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-slate-100 px-4 pb-3 pt-4 pr-12 sm:px-5">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {description ??
              "Adjust brightness and print scale. Nothing is submitted until you choose Submit Print Job."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 sm:px-5">
          <p className="truncate text-xs text-slate-500" title={infoLine}>
            {infoLine}
          </p>

          {settingsNote ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {settingsNote}
            </p>
          ) : null}

          <div className="rounded-xl bg-slate-100/90 px-3 py-4 sm:px-4">
            <p className="mb-2 text-center text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
              Print preview
            </p>
            <div className="min-h-[220px]">
              {loading || adjustmentsPending ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-slate-600">
                  <Loader2 className="size-8 animate-spin text-blue-600" />
                  <p className="text-sm">
                    {adjustmentsPending
                      ? "Updating preview…"
                      : "Generating preview…"}
                  </p>
                </div>
              ) : error ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl bg-amber-50 px-4 text-center">
                  <p className="text-sm font-medium text-amber-950">{error}</p>
                  <p className="text-xs text-amber-800">
                    You can still submit the print job.
                  </p>
                </div>
              ) : pdfUrl ? (
                <PdfPreviewSurface
                  url={pdfUrl}
                  title="ID card A4 preview"
                  grayscale={grayscale}
                  brightness={100}
                  contentScale={100}
                  frameClass={frameClass}
                  preferCanvas={preferCanvas}
                />
              ) : current?.kind === "unavailable" ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl bg-white/70 px-4 text-center">
                  <Eye className="size-6 text-slate-400" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-800">
                    {current.message}
                  </p>
                  <p className="text-xs text-slate-500">
                    You can still submit the print job.
                  </p>
                </div>
              ) : current?.kind === "image" ? (
                <div className={frameClass}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={current.url}
                    alt=""
                    style={{
                      filter: [
                        grayscale ? "grayscale(1)" : null,
                        `brightness(${brightness / 100})`,
                      ]
                        .filter(Boolean)
                        .join(" "),
                      transform: `scale(${contentScale / 100})`,
                      transformOrigin: "center center",
                    }}
                    className={[
                      "h-full w-full",
                      pageFit === "noscale" ? "object-none" : "object-contain",
                    ].join(" ")}
                  />
                </div>
              ) : current?.kind === "pdf" ? (
                <PdfPreviewSurface
                  url={current.url}
                  title="Document preview"
                  grayscale={grayscale}
                  brightness={brightness}
                  contentScale={contentScale}
                  frameClass={frameClass}
                  preferCanvas={preferCanvas}
                />
              ) : (
                <div className="flex min-h-[220px] items-center justify-center text-sm text-slate-500">
                  Nothing to preview.
                </div>
              )}
            </div>
          </div>

          {!loading && !error && !pdfUrl && pages.length > 1 ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10"
                disabled={safeIndex <= 0}
                onClick={() => onPageIndexChange?.(safeIndex - 1)}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                Previous
              </Button>
              <p className="text-xs text-slate-500">
                {safeIndex + 1} / {totalPages}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10"
                disabled={safeIndex >= pages.length - 1}
                onClick={() => onPageIndexChange?.(safeIndex + 1)}
              >
                Next
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ) : null}

          <AdjustmentControls
            brightness={brightness}
            contentScale={contentScale}
            onBrightnessChange={onBrightnessChange}
            onContentScaleChange={onContentScaleChange}
            onReset={onResetAdjustments}
            disabled={loading}
          />
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
          >
            Back
          </Button>
          <Button
            type="button"
            className="min-h-11 bg-blue-600 text-white hover:bg-blue-700"
            onClick={() => {
              onApply?.();
              onOpenChange(false);
            }}
          >
            {applyLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Tiny helper export so smoke tests can assert client preview classification. */
export function classifyPreviewExtension(
  fileName: string,
): "image" | "pdf" | "unavailable" {
  const ext = extensionFromFileName(fileName);
  if (ext === "pdf") return "pdf";
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return "image";
  return "unavailable";
}

export function usePreviewPageState() {
  const [pageIndex, setPageIndex] = useState(0);
  return { pageIndex, setPageIndex };
}
