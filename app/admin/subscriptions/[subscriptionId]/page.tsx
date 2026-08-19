import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminSubscriptionDetailView } from "@/components/admin/admin-subscription-detail";
import { getAdminSubscriptionDetail } from "@/lib/admin-subscriptions";
import { requireAdmin } from "@/lib/auth";

type PageProps = {
  params: Promise<{ subscriptionId: string }>;
};

export default async function AdminSubscriptionDetailPage({ params }: PageProps) {
  await requireAdmin();
  const { subscriptionId } = await params;
  const subscription = await getAdminSubscriptionDetail(subscriptionId);

  if (!subscription) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-blue-600 uppercase">
            Subscription detail
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">
            {subscription.shop.shopName}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{subscription.statusLabel}</p>
        </div>
        <Link
          href="/admin/subscriptions"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to subscriptions
        </Link>
      </div>

      <AdminSubscriptionDetailView subscription={subscription} />
    </div>
  );
}
