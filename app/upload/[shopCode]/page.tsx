import { UploadFormLoader } from "@/components/upload-form-loader";
import {
  getShopWithPricing,
  toPricingRates,
} from "@/lib/pricing-service";
import type { ShopUploadContext } from "@/types";

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

  const shopContext: ShopUploadContext = {
    shopId: shop.id,
    shopCode: shop.shopCode,
    shopName: shop.shopName,
    pricing: toPricingRates(shop.printPrice),
  };

  return (
    <main className="min-h-screen bg-[#f7f8fa] px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-md space-y-5">
        <header className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-blue-600 uppercase">
            Print Made Easy
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
