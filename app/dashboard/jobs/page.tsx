import { JobsBoard } from "@/components/dashboard/jobs-board";
import {
  getDashboardSummary,
  getDemoShop,
  getShopJobs,
} from "@/lib/dashboard-service";

export default async function JobsPage() {
  const shop = await getDemoShop();

  if (!shop) {
    return (
      <p className="text-sm text-slate-500">Unable to load jobs.</p>
    );
  }

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
      <JobsBoard initialJobs={jobs} initialSummary={summary} />
    </div>
  );
}
