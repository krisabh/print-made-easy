import { UploadFormLoader } from "@/components/upload-form-loader";
import { getShopDefaultColorSupported } from "@/lib/print-agent-service";
import {
  getShopWithPricing,
  toPricingRates,
} from "@/lib/pricing-service";
import { hasSubscriptionAccess } from "@/lib/subscription";
import type { ShopUploadContext } from "@/types";

/** Always resolve current default printer capability from the DB. */
export const dynamic = "force-dynamic";

type UploadPageProps = {
  params: Promise<{ shopCode: string }>;
};

export default async function UploadPage({ params }: UploadPageProps) {
  const { shopCode } = await params;
  const shop = await getShopWithPricing(shopCode);

  if (!shop || !shop.printPrice) {
    return (
      <main className="min-h-screen bg-white px-4 py-10">
        <div className="mx-auto flex w-full max-w-md flex-col items-center justify-center rounded-2xl border border-slate-200 px-6 py-16 text-center shadow-sm">
          <div
            className="flex size-12 items-center justify-center rounded-full bg-red-50 text-lg font-semibold text-red-500"
            aria-hidden="true"
          >
            !
          </div>
          <h1 className="mt-4 text-xl font-semibold text-slate-900">
            Link unavailable
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Sorry, this print shop link is no longer available.
          </p>
        </div>
      </main>
    );
  }

  const shopHasAccess = await hasSubscriptionAccess(shop.id);
  if (!shopHasAccess) {
    return (
      <main className="min-h-screen bg-[#f7f8fa] px-4 py-6 sm:py-10">
        <div className="mx-auto w-full max-w-md space-y-5">
          <header className="space-y-1">
            <p className="text-xs font-medium tracking-wide text-blue-600 uppercase">
              PrintMadeEasy
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {shop.shopName}
            </h1>
          </header>

          <div className="rounded-2xl border border-amber-200 bg-white px-6 py-10 text-center shadow-sm">
            <div
              className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-50 text-lg font-semibold text-amber-700"
              aria-hidden="true"
            >
              !
            </div>
            <h2 className="mt-4 text-xl font-semibold text-slate-900">
              Printing temporarily unavailable
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              This print shop is currently unavailable to receive new print
              orders.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Please contact the shop or try again later.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const colorSupported = await getShopDefaultColorSupported(shop.id);

  const shopContext: ShopUploadContext = {
    shopId: shop.id,
    shopCode: shop.shopCode,
    shopName: shop.shopName,
    colorSupported,
    pricing: toPricingRates(shop.printPrice),
  };

  return (
    <main className="min-h-screen bg-[#f7f8fa] px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-md space-y-5">
        <header className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-blue-600 uppercase">
            PrintMadeEasy
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {shop.shopName}
          </h1>
          <p className="text-sm text-slate-500">Print your documents easily</p>
        </header>

        <UploadFormLoader shop={shopContext} />
      </div>
    </main>
  );
}
