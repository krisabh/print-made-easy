import { QrCard } from "@/components/dashboard/qr-card";
import { SubscriptionGateBanner } from "@/components/dashboard/subscription-gate-banner";
import { getAppBaseUrl } from "@/lib/app-url";
import { requireDashboardSession } from "@/lib/require-product-access";

export default async function QrPage() {
  const { session, access } = await requireDashboardSession();
  const { shop } = session;

  const appUrl = await getAppBaseUrl();
  const uploadUrl = `${appUrl}/upload/${shop.shopCode}`;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">QR Code</h2>
        <p className="mt-1 text-sm text-slate-500">
          Permanent shop QR for customer document uploads. Customers scan to
          print — this is not a payment QR.
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
      <SubscriptionGateBanner access={access} />
      {!access.hasAccess ? (
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          Your QR link still opens, but customers cannot submit new print orders
          until you subscribe.
        </p>
      ) : null}
      <QrCard
        shopName={shop.shopName}
        shopCode={shop.shopCode}
        uploadUrl={uploadUrl}
      />
    </div>
  );
}
