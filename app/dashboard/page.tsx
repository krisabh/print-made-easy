import { JobsBoard } from "@/components/dashboard/jobs-board";
import { requireShop } from "@/lib/auth";
import {
  getDashboardSummary,
  getShopJobs,
} from "@/lib/dashboard-service";

export default async function DashboardPage() {
  const { shop } = await requireShop();

  const [summary, jobs] = await Promise.all([
    getDashboardSummary(shop.id),
    getShopJobs({ shopId: shop.id, date: "today", status: "ALL" }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Dashboard</h2>
        <p className="mt-1 text-sm text-slate-500">
          Overview of today&apos;s print activity for your shop.
        </p>
      </div>
      <JobsBoard
        initialJobs={jobs}
        initialSummary={summary}
        showSummary
      />
    </div>
  );
}
