"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Loader2 } from "lucide-react";

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
import type { renderPdfPageToCanvas as RenderPdfPageToCanvas } from "@/lib/client-pdf-preview";

export type PreviewPrintMode = "BW" | "COLOR";
export type PreviewOrientation = "portrait" | "landscape";
export type PreviewMargins = "normal" | "none";
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
    }
  | {
      kind: "pdf";
      key: string;
      url: string;
      label: string;
      estimatedPages: number;
    }
  | {
      kind: "unavailable";
      key: string;
      label: string;
      message: string;
    };

type PrintPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Optional subtitle under the title (e.g. page indicator). */
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
  scale?: PreviewScale;
  /** Soft note shown under the viewer (settings / range hints). */
  settingsNote?: string | null;
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
      });
      continue;
    }
    pages.push({
      kind: "unavailable",
      key: item.id,
      label: "Unsupported for preview",
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

/**
 * Renders a PDF page to canvas so mobile browsers can show content inside
 * the dialog (blob iframes are often blank on iOS/Android).
 */
function PdfCanvasPreview({
  url,
  grayscale,
  className,
}: {
  url: string;
  grayscale?: boolean;
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

  return (
    <div className="flex flex-col gap-2">
      <div
        className={[
          className,
          "flex items-center justify-center bg-white",
          grayscale ? "grayscale" : "",
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
            disabled={pdfPage <= 1}
            onClick={() => setPdfPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Prev page
          </Button>
          <p className="text-xs text-slate-500">
            PDF page {pdfPage}/{pdfPageCount}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pdfPage >= pdfPageCount}
            onClick={() => setPdfPage((p) => Math.min(pdfPageCount, p + 1))}
          >
            Next page
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
  frameClass,
  preferCanvas,
}: {
  url: string;
  title: string;
  grayscale: boolean;
  frameClass: string;
  preferCanvas: boolean;
}) {
  if (preferCanvas) {
    return (
      <PdfCanvasPreview
        url={url}
        grayscale={grayscale}
        className={frameClass}
      />
    );
  }

  return (
    <div className={frameClass}>
      <iframe
        title={title}
        src={url}
        className={[
          "h-full w-full rounded-md border-0 bg-white",
          grayscale ? "grayscale" : "",
        ].join(" ")}
      />
    </div>
  );
}

export function PrintPreviewDialog({
  open,
  onOpenChange,
  title,
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
  scale = "fit",
  settingsNote = null,
}: PrintPreviewDialogProps) {
  const safeIndex =
    pages.length === 0 ? 0 : Math.min(Math.max(0, pageIndex), pages.length - 1);
  const current = pages[safeIndex];
  const totalPages = pdfUrl ? 1 : pages.length;
  const grayscale = printMode === "BW";
  const [preferCanvas, setPreferCanvas] = useState(false);

  const frameClass = useMemo(() => {
    // Match NORMAL_A4_MARGIN_PT visually: normal ≈ larger pad; none ≈ tight.
    const pad = margins === "none" ? "p-1" : "p-5 sm:p-6";
    const aspect =
      orientation === "landscape" ? "aspect-[1.414/1]" : "aspect-[1/1.414]";
    return [
      "mx-auto w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm",
      aspect,
      pad,
    ].join(" ");
  }, [margins, orientation]);

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
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto sm:max-w-lg"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle className="pr-8">{title}</DialogTitle>
          <DialogDescription>
            {description ??
              (pdfUrl
                ? "Page 1 of 1 · Preview only — nothing is submitted yet."
                : totalPages > 0
                  ? `Page ${safeIndex + 1} of ${totalPages} · Preview only — nothing is submitted yet.`
                  : "Preview only — nothing is submitted yet.")}
          </DialogDescription>
        </DialogHeader>

        {settingsNote ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {settingsNote}
          </p>
        ) : null}

        <div className="min-h-[280px]">
          {loading ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-slate-600">
              <Loader2 className="size-8 animate-spin text-blue-600" />
              <p className="text-sm">Generating preview…</p>
            </div>
          ) : error ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-xl bg-amber-50 px-4 text-center">
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
              frameClass={frameClass}
              preferCanvas={preferCanvas}
            />
          ) : current?.kind === "unavailable" ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-xl bg-slate-50 px-4 text-center">
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
                className={[
                  "h-full w-full",
                  scale === "noscale" ? "object-none" : "object-contain",
                  grayscale ? "grayscale" : "",
                ].join(" ")}
              />
            </div>
          ) : current?.kind === "pdf" ? (
            <PdfPreviewSurface
              url={current.url}
              title="Document preview"
              grayscale={grayscale}
              frameClass={frameClass}
              preferCanvas={preferCanvas}
            />
          ) : (
            <div className="flex min-h-[280px] items-center justify-center text-sm text-slate-500">
              Nothing to preview.
            </div>
          )}
        </div>

        {!loading && !error && !pdfUrl && pages.length > 1 ? (
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safeIndex <= 0}
              onClick={() => onPageIndexChange?.(safeIndex - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Previous
            </Button>
            <p className="text-xs text-slate-500">
              {current?.label ?? "Page"} · {safeIndex + 1}/{pages.length}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safeIndex >= pages.length - 1}
              onClick={() => onPageIndexChange?.(safeIndex + 1)}
            >
              Next
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Tiny helper export so smoke tests can assert client preview classification. */
export function classifyPreviewExtension(fileName: string): "image" | "pdf" | "unavailable" {
  const ext = extensionFromFileName(fileName);
  if (ext === "pdf") return "pdf";
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return "image";
  return "unavailable";
}

export function usePreviewPageState() {
  const [pageIndex, setPageIndex] = useState(0);
  return { pageIndex, setPageIndex };
}
