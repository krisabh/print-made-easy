import { requireAdmin } from "@/lib/auth";
import { getAdminAnalytics, normalizeAdminAnalyticsRange } from "@/lib/admin-analytics";
import { AdminAnalyticsDashboard } from "@/components/admin/admin-analytics-dashboard";
import { AdminAnalyticsRangeSelector } from "@/components/admin/admin-analytics-range-selector";

type PageProps = { searchParams: Promise<{ range?: string }> };

export default async function AdminAnalyticsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const range = normalizeAdminAnalyticsRange(params.range);
  const analytics = await getAdminAnalytics({ range });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Analytics</h2>
          <p className="mt-1 text-sm text-slate-500">
            Business, subscription, printing, and shop activity analytics.
          </p>
        </div>
        <AdminAnalyticsRangeSelector range={range} />
      </div>
      <p className="text-xs text-slate-500">Calendar boundaries use Asia/Kolkata. Selected period: {analytics.range.label}.</p>
      <AdminAnalyticsDashboard analytics={analytics} />
    </div>
  );
}
