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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Print Jobs</h2>
          <p className="mt-1 text-sm text-slate-500">
            Track customer print jobs, status and print activity.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 shadow-sm">
          <span
            className="size-1.5 rounded-full bg-emerald-500"
            aria-hidden="true"
          />
          <span className="font-medium text-slate-700">Live updates</span>
          <span className="text-slate-400">·</span>
          <span>Every 5 seconds</span>
        </div>
      </div>
      <SubscriptionGateBanner access={access} />
      <JobsBoard
        initialJobs={jobs}
        initialSummary={summary}
        showSummary
        printingLocked={!access.hasAccess}
      />
    </div>
  );
}
