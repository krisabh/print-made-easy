import { JobsBoard } from "@/components/dashboard/jobs-board";
import { SubscriptionGateBanner } from "@/components/dashboard/subscription-gate-banner";
import {
  getDashboardSummary,
  getShopJobs,
} from "@/lib/dashboard-service";
import { requireDashboardSession } from "@/lib/require-product-access";

export default async function JobsPage() {
  const { session, access } = await requireDashboardSession();
  const { shop } = session;

  const [summary, jobs] = await Promise.all([
    getDashboardSummary(shop.id),
    getShopJobs({ shopId: shop.id, date: "today", status: "ALL" }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Jobs</h2>
        <p className="mt-1 text-sm text-slate-500">
          Search, filter, preview, and manage incoming print jobs.
        </p>
      </div>
      <SubscriptionGateBanner access={access} />
      <JobsBoard
        initialJobs={jobs}
        initialSummary={summary}
        printingLocked={!access.hasAccess}
      />
    </div>
  );
}
