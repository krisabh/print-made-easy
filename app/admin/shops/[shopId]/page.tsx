import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminShopDetailView } from "@/components/admin/admin-shop-detail";
import { getAdminShopDetail } from "@/lib/admin-shops";
import { requireAdmin } from "@/lib/auth";

type PageProps = {
  params: Promise<{ shopId: string }>;
};

export default async function AdminShopDetailPage({ params }: PageProps) {
  await requireAdmin();
  const { shopId } = await params;
  const shop = await getAdminShopDetail(shopId);

  if (!shop) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-blue-600 uppercase">
            Shop detail
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">
            {shop.shopName}
          </h2>
          <p className="mt-1 font-mono text-sm text-slate-500">{shop.shopCode}</p>
        </div>
        <Link
          href="/admin/shops"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to shops
        </Link>
      </div>

      <AdminShopDetailView shop={shop} />
    </div>
  );
}
