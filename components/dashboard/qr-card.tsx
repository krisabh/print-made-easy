"use client";

import { useRef } from "react";
import { Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

type QrCardProps = {
  shopName: string;
  shopCode: string;
  uploadUrl: string;
  qrDataUrl: string;
};

export function QrCard({
  shopName,
  shopCode,
  uploadUrl,
  qrDataUrl,
}: QrCardProps) {
  const printRef = useRef<HTMLDivElement>(null);

  function downloadQr() {
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = `${shopCode}-qr.png`;
    link.click();
  }

  function printQr() {
    const popup = window.open("", "_blank", "width=480,height=640");
    if (!popup) return;
    popup.document.write(`
      <html>
        <head>
          <title>${shopCode} QR</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 32px; }
            img { width: 280px; height: 280px; }
            h1 { font-size: 20px; margin-bottom: 8px; }
            p { color: #475569; font-size: 14px; }
          </style>
        </head>
        <body>
          <h1>${shopName}</h1>
          <p>Shop Code: ${shopCode}</p>
          <img src="${qrDataUrl}" alt="Shop QR Code" />
          <p>${uploadUrl}</p>
          <script>window.onload = () => { window.print(); };</script>
        </body>
      </html>
    `);
    popup.document.close();
  }

  return (
    <div className="max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div ref={printRef} className="text-center">
        <h2 className="text-lg font-semibold text-slate-900">{shopName}</h2>
        <p className="mt-1 text-sm text-slate-500">Shop Code: {shopCode}</p>
        <img
          src={qrDataUrl}
          alt={`QR code for ${shopCode}`}
          className="mx-auto mt-6 size-56 rounded-xl border border-slate-200 bg-white p-3"
        />
        <p className="mt-4 break-all text-sm text-slate-600">{uploadUrl}</p>
        <p className="mt-2 text-xs text-slate-400">
          This QR is permanent for your shop. Customers scan it to upload documents.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={downloadQr}
          className="h-11 bg-blue-600 text-white hover:bg-blue-700"
        >
          <Download className="size-4" />
          Download QR
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={printQr}>
          <Printer className="size-4" />
          Print QR
        </Button>
      </div>
    </div>
  );
}
