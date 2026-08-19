import { AdminOverviewCards } from "@/components/admin/admin-overview-cards";
import { getAdminOverviewMetrics } from "@/lib/admin-metrics";
import { requireAdmin } from "@/lib/auth";

export default async function AdminOverviewPage() {
  await requireAdmin();
  const metrics = await getAdminOverviewMetrics();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Overview</h2>
        <p className="mt-1 text-sm text-slate-500">
          System-wide PrintMadeEasy metrics.
        </p>
      </div>
      <AdminOverviewCards metrics={metrics} />
    </div>
  );
}
