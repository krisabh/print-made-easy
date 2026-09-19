"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { extensionFromFileName } from "@/lib/print-file-category";

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

export type PdfOpenFallbackEnv = {
  userAgent?: string;
  maxTouchPoints?: number;
  /** Optional matchMedia; pass a stub in tests. */
  matchesNarrow?: boolean;
  matchesCoarsePointer?: boolean;
};

/**
 * Many mobile browsers (iOS Safari/Chrome, Android Chrome) do not reliably
 * render PDF blobs inside an iframe/`<object>`. Desktop Chrome/Edge/Firefox
 * typically do. When this returns true, the dialog still attempts inline
 * preview where practical and always offers an "Open PDF" action that opens
 * the same blob/object URL in a new tab (no download-only path, no server persist).
 */
export function needsMobilePdfOpenFallback(
  env: PdfOpenFallbackEnv = {},
): boolean {
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

/** Read live browser signals (client-only). Safe no-op defaults on server. */
export function readPdfOpenFallbackEnv(): PdfOpenFallbackEnv {
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

function PdfOpenFallbackActions({
  url,
  label = "Open PDF",
}: {
  url: string;
  label?: string;
}) {
  return (
    <div className="mt-3 flex flex-col items-stretch gap-2 sm:items-center">
      <p className="text-center text-xs text-slate-600">
        If the preview above is blank, open the PDF in a new tab.
      </p>
      <Button
        type="button"
        variant="default"
        className="w-full sm:w-auto"
        onClick={() => {
          window.open(url, "_blank", "noopener,noreferrer");
        }}
      >
        <ExternalLink className="size-4" aria-hidden="true" />
        {label}
      </Button>
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
  const [offerPdfOpenFallback, setOfferPdfOpenFallback] = useState(false);

  const frameClass = useMemo(() => {
    const pad = margins === "none" ? "p-1" : "p-3 sm:p-4";
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
      setOfferPdfOpenFallback(false);
      return;
    }
    setOfferPdfOpenFallback(needsMobilePdfOpenFallback(readPdfOpenFallbackEnv()));
  }, [open]);

  const activePdfUrl =
    pdfUrl ?? (current?.kind === "pdf" ? current.url : null);
  const showPdfOpenFallback =
    offerPdfOpenFallback && Boolean(activePdfUrl) && !loading && !error;

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
            <div>
              <div className={frameClass}>
                <iframe
                  title="ID card A4 preview"
                  src={pdfUrl}
                  className={[
                    "h-full w-full rounded-md border-0 bg-white",
                    grayscale ? "grayscale" : "",
                  ].join(" ")}
                />
              </div>
              {showPdfOpenFallback ? (
                <PdfOpenFallbackActions url={pdfUrl} label="Open PDF" />
              ) : null}
            </div>
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
            <div>
              <div className={frameClass}>
                <iframe
                  title="Document preview"
                  src={current.url}
                  className={[
                    "h-full w-full rounded-md border-0 bg-white",
                    grayscale ? "grayscale" : "",
                  ].join(" ")}
                />
              </div>
              {showPdfOpenFallback ? (
                <PdfOpenFallbackActions url={current.url} label="View PDF" />
              ) : null}
            </div>
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
