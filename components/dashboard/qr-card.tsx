"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Download, Printer } from "lucide-react";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";

/** Agent 1.5.2 PY mark — used at the QR card / sheet top-left (not inside modules). */
export const QR_BRAND_ICON_SRC = "/brand/printyantra-qr-icon.png";

/** @deprecated Alias kept for smoke/import compatibility. */
export const QR_CENTER_ICON_SRC = QR_BRAND_ICON_SRC;

/**
 * Product label for on-screen QR card + printable sheet.
 *
 * Literal (not SITE.name import) so the Client Component SSR and hydration
 * graphs always embed the same string. Must stay identical to SITE.name.
 */
export const QR_PRODUCT_NAME = "PrintYantra" as const;

const QR_SITE_URL = "https://printyantra.com";

const QR_NOT_PAYMENT_LABEL = "NOT A PAYMENT QR";

type QrCardProps = {
  shopName: string;
  shopCode: string;
  uploadUrl: string;
  /** Defaults to QR_PRODUCT_NAME; page may pass SITE.name for an explicit match. */
  productName?: typeof QR_PRODUCT_NAME;
};

/** Plain scannable QR — no center overlay (keeps modules clear). */
async function buildQrDataUrl(uploadUrl: string, size = 640) {
  return QRCode.toDataURL(uploadUrl, {
    errorCorrectionLevel: "H",
    margin: 3,
    width: size,
    color: {
      dark: "#0f172a",
      light: "#ffffff",
    },
  });
}

async function buildPrintableSheetDataUrl(options: {
  shopName: string;
  shopCode: string;
  uploadUrl: string;
  qrDataUrl: string;
  productName?: typeof QR_PRODUCT_NAME;
}) {
  const width = 1200;
  const height = 1680;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return options.qrDataUrl;

  const brandLabel = options.productName ?? QR_PRODUCT_NAME;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#eff6ff";
  ctx.fillRect(0, 0, width, 140);

  // Top-left: PY icon + website URL (not centered in QR modules).
  try {
    const logo = await loadImage(QR_BRAND_ICON_SRC);
    const logoSize = 56;
    ctx.drawImage(logo, 48, 42, logoSize, logoSize);
  } catch {
    // Continue without icon if it fails to load.
  }
  ctx.fillStyle = "#1d4ed8";
  ctx.font = "700 28px Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(brandLabel, 120, 66);
  ctx.fillStyle = "#475569";
  ctx.font = "500 22px Arial, sans-serif";
  ctx.fillText(QR_SITE_URL, 120, 98);

  ctx.textAlign = "center";

  ctx.fillStyle = "#0f172a";
  ctx.font = "700 54px Arial, sans-serif";
  wrapCenteredText(ctx, options.shopName.toUpperCase(), width / 2, 230, width - 160, 58);

  ctx.fillStyle = "#1d4ed8";
  ctx.font = "700 42px Arial, sans-serif";
  ctx.fillText("PRINT DOCUMENTS HERE", width / 2, 360);

  const qrImage = await loadImage(options.qrDataUrl);
  const qrSize = 640;
  const qrX = (width - qrSize) / 2;
  const qrY = 420;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(qrX - 24, qrY - 24, qrSize + 48, qrSize + 48, 28);
  ctx.fill();
  ctx.stroke();
  ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

  // Exact warning — bold red text below the QR (not inside modules).
  ctx.fillStyle = "#dc2626";
  ctx.font = "700 40px Arial, sans-serif";
  ctx.fillText(QR_NOT_PAYMENT_LABEL, width / 2, qrY + qrSize + 78);

  ctx.fillStyle = "#0f172a";
  ctx.font = "600 30px Arial, sans-serif";
  ctx.fillText("Scan to upload your documents", width / 2, qrY + qrSize + 140);

  ctx.fillStyle = "#475569";
  ctx.font = "500 24px Arial, sans-serif";
  ctx.fillText("Can't scan?", width / 2, qrY + qrSize + 196);

  ctx.fillStyle = "#1d4ed8";
  ctx.font = "500 22px Arial, sans-serif";
  wrapCenteredText(ctx, options.uploadUrl, width / 2, qrY + qrSize + 242, width - 140, 30);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 20px Arial, sans-serif";
  ctx.fillText(`Shop code: ${options.shopCode}`, width / 2, height - 56);

  return canvas.toDataURL("image/png");
}

function wrapCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);

  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    ctx.fillText(line, x, startY + index * lineHeight);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image."));
    image.src = src;
  });
}

export function QrCard({
  shopName,
  shopCode,
  uploadUrl,
  productName = QR_PRODUCT_NAME,
}: QrCardProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    buildQrDataUrl(uploadUrl)
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setError("Unable to generate QR code.");
      });
    return () => {
      cancelled = true;
    };
  }, [uploadUrl]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(uploadUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Unable to copy link. Select and copy the URL manually.");
    }
  }, [uploadUrl]);

  async function downloadSheet() {
    if (!qrDataUrl) return;
    setBusy(true);
    setError(null);
    try {
      const sheet = await buildPrintableSheetDataUrl({
        shopName,
        shopCode,
        uploadUrl,
        qrDataUrl,
        productName,
      });
      const link = document.createElement("a");
      link.href = sheet;
      link.download = `${shopCode}-print-qr-sheet.png`;
      link.click();
    } catch {
      setError("Unable to prepare the printable QR sheet.");
    } finally {
      setBusy(false);
    }
  }

  async function printSheet() {
    if (!qrDataUrl) return;
    setBusy(true);
    setError(null);
    try {
      const sheet = await buildPrintableSheetDataUrl({
        shopName,
        shopCode,
        uploadUrl,
        qrDataUrl,
        productName,
      });
      const popup = window.open("", "_blank", "width=720,height=960");
      if (!popup) {
        setError("Allow pop-ups to print the QR sheet.");
        return;
      }
      popup.document.write(`
        <html>
          <head>
            <title>${shopName} — Print Documents QR</title>
            <style>
              body { margin: 0; background: #fff; display: flex; justify-content: center; }
              img { width: min(100vw, 720px); height: auto; }
            </style>
          </head>
          <body>
            <img src="${sheet}" alt="Print documents QR sheet" />
            <script>window.onload = () => { window.print(); };</script>
          </body>
        </html>
      `);
      popup.document.close();
    } catch {
      setError("Unable to open the printable QR sheet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-blue-100 bg-blue-50 px-5 py-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- brand mark next to site URL */}
            <img
              src={QR_BRAND_ICON_SRC}
              alt=""
              width={40}
              height={40}
              className="size-10 shrink-0 rounded-lg bg-white object-contain p-1 shadow-sm ring-1 ring-slate-200/80"
            />
            <div className="min-w-0 text-left">
              <p
                className="text-[11px] font-semibold tracking-[0.16em] text-blue-700 uppercase"
                data-qr-brand={productName}
              >
                {productName}
              </p>
              <p className="mt-0.5 truncate text-sm font-medium text-slate-600">
                {QR_SITE_URL}
              </p>
            </div>
          </div>
          <h2 className="mt-3 text-center text-2xl font-bold tracking-tight text-slate-900">
            {shopName}
          </h2>
          <p className="mt-2 text-center text-sm font-semibold tracking-wide text-blue-700 uppercase">
            Print Documents Here
          </p>
        </div>

        <div className="px-5 py-6 text-center">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`Print documents QR for ${shopName}`}
              className="mx-auto size-56 rounded-xl border border-slate-200 bg-white p-2 sm:size-64"
            />
          ) : (
            <div className="mx-auto flex size-56 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500 sm:size-64">
              Generating QR…
            </div>
          )}
          <p
            className="mt-4 text-base font-bold tracking-wide text-red-600 uppercase"
            aria-label={QR_NOT_PAYMENT_LABEL}
          >
            {QR_NOT_PAYMENT_LABEL}
          </p>
          <p className="mt-3 text-sm font-medium text-slate-700">
            Scan to upload your documents
          </p>
          <p className="mt-1 text-xs text-slate-400">Shop code: {shopCode}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">
          Can&apos;t scan the QR code?
        </p>
        <p className="mt-1 text-sm text-slate-500">Open this link instead</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <input
            readOnly
            value={uploadUrl}
            aria-label="Customer upload link"
            className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0"
            onClick={copyLink}
          >
            {copied ? (
              <>
                <Check className="size-4 text-emerald-600" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-4" />
                Copy Link
              </>
            )}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={downloadSheet}
          disabled={!qrDataUrl || busy}
          className="h-11 bg-blue-600 text-white hover:bg-blue-700"
        >
          <Download className="size-4" />
          {busy ? "Preparing…" : "Download QR Sheet"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={printSheet}
          disabled={!qrDataUrl || busy}
        >
          <Printer className="size-4" />
          Print QR Sheet
        </Button>
      </div>
    </div>
  );
}
