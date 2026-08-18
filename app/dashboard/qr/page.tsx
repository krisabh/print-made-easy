import QRCode from "qrcode";

import { QrCard } from "@/components/dashboard/qr-card";
import { requireShop } from "@/lib/auth";
import { getAppBaseUrl } from "@/lib/app-url";

export default async function QrPage() {
  const { shop } = await requireShop();

  const appUrl = await getAppBaseUrl();
  const uploadUrl = `${appUrl}/upload/${shop.shopCode}`;
  const qrDataUrl = await QRCode.toDataURL(uploadUrl, {
    margin: 2,
    width: 512,
    color: {
      dark: "#0f172a",
      light: "#ffffff",
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">QR Code</h2>
        <p className="mt-1 text-sm text-slate-500">
          Permanent shop QR for customer document uploads.
        </p>
        {uploadUrl.includes("localhost") || uploadUrl.includes("127.0.0.1") ? (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This QR uses localhost and will not work from a phone. Set
            NEXT_PUBLIC_APP_URL to your public site URL (example:
            https://clauras.com) or your PC LAN IP for local testing, then
            restart the server.
          </p>
        ) : uploadUrl.startsWith("https://") ? (
          <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Customers can scan this QR from any network. It opens your public
            upload page at {uploadUrl}.
          </p>
        ) : (
          <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            For local testing, phone and PC must be on the same Wi‑Fi. For
            production, set NEXT_PUBLIC_APP_URL to your https domain.
          </p>
        )}
      </div>
      <QrCard
        shopName={shop.shopName}
        shopCode={shop.shopCode}
        uploadUrl={uploadUrl}
        qrDataUrl={qrDataUrl}
      />
    </div>
  );
}
