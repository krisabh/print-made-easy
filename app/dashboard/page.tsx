import { JobsBoard } from "@/components/dashboard/jobs-board";
import { SubscriptionStatusCard } from "@/components/dashboard/subscription-status-card";
import {
  getDashboardSummary,
  getShopJobs,
} from "@/lib/dashboard-service";
import { requireProductAccess } from "@/lib/require-product-access";
import {
  getShopSubscription,
  toPublicSubscriptionView,
} from "@/lib/subscription";

export default async function DashboardPage() {
  const { session, access } = await requireProductAccess();
  const { shop } = session;

  const [summary, jobs, subscription] = await Promise.all([
    getDashboardSummary(shop.id),
    getShopJobs({ shopId: shop.id, date: "today", status: "ALL" }),
    getShopSubscription(shop.id),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Dashboard</h2>
        <p className="mt-1 text-sm text-slate-500">
          Overview of today&apos;s print activity for your shop.
        </p>
      </div>
      <SubscriptionStatusCard
        subscription={toPublicSubscriptionView(subscription)}
        showGraceWarning={access.isGracePeriod}
      />
      <JobsBoard
        initialJobs={jobs}
        initialSummary={summary}
        showSummary
      />
    </div>
  );
}
