/**
 * Client-only PDF → canvas helpers for mobile print preview.
 * pdfjs-dist is loaded dynamically so Node smoke tests never evaluate it.
 * Preview only — never replaces the print PDF.
 */

"use client";

let workerConfigured = false;

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured && typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    workerConfigured = true;
  }
  return pdfjs;
}

async function loadPdfFromUrl(url: string) {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    url,
    disableRange: true,
    disableStream: true,
  });
  return loadingTask.promise;
}

/**
 * Render one PDF page into a canvas element. Returns page count.
 * Scales to fit the canvas parent width (devicePixelRatio-aware).
 */
export async function renderPdfPageToCanvas(
  url: string,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  options?: { maxCssWidth?: number },
): Promise<{ pageCount: number; pageNumber: number }> {
  const pdf = await loadPdfFromUrl(url);
  try {
    const pageCount = pdf.numPages;
    const safePage = Math.min(Math.max(1, pageNumber), pageCount);
    const page = await pdf.getPage(safePage);

    const maxCssWidth =
      options?.maxCssWidth ?? canvas.parentElement?.clientWidth ?? 360;
    const unscaled = page.getViewport({ scale: 1 });
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const cssScale = Math.min(1.5, maxCssWidth / unscaled.width);
    const viewport = page.getViewport({ scale: cssScale * dpr });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context unavailable.");
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
    }).promise;

    return { pageCount, pageNumber: safePage };
  } finally {
    await pdf.cleanup();
  }
}

export async function getPdfPageCountFromUrl(url: string): Promise<number> {
  const pdf = await loadPdfFromUrl(url);
  try {
    return pdf.numPages;
  } finally {
    await pdf.cleanup();
  }
}
