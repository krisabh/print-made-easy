import QRCode from "qrcode";

import { QrCard } from "@/components/dashboard/qr-card";
import { getAppBaseUrl } from "@/lib/app-url";
import { DEMO_SHOP_CODE, getDemoShop } from "@/lib/dashboard-service";

export default async function QrPage() {
  const shop = await getDemoShop();

  if (!shop) {
    return <p className="text-sm text-slate-500">Unable to load QR code.</p>;
  }

  const appUrl = await getAppBaseUrl();
  const uploadUrl = `${appUrl}/upload/${shop.shopCode || DEMO_SHOP_CODE}`;
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
        {uploadUrl.includes("localhost") && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This QR uses localhost and will not work from a phone. Set
            NEXT_PUBLIC_APP_URL to your PC LAN IP (example:
            http://192.168.1.10:3000) and restart the server.
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
