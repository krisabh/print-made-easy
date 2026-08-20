import Link from "next/link";

import {
  formatAnalyticsMoneyInr,
  formatAnalyticsNumber,
  type AdminAnalytics,
} from "@/lib/admin-analytics";

function Card({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      {detail ? <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p> : null}
    </div>
  );
}

function BarChart({
  title,
  rows,
  valueKey,
  valueLabel,
}: {
  title: string;
  rows: Array<{ label: string; [key: string]: string | number }>;
  valueKey: string;
  valueLabel: string;
}) {
  const max = Math.max(1, ...rows.map((row) => Number(row[valueKey]) || 0));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No data in the selected period.</p>
      ) : (
        <div className="mt-5 space-y-3">
          {rows.map((row) => {
            const value = Number(row[valueKey]) || 0;
            return (
              <div key={String(row.label)} className="grid grid-cols-[78px_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate text-slate-500">{row.label}</span>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(2, (value / max) * 100)}%` }} />
                </div>
                <span className="font-semibold text-slate-800">{formatAnalyticsNumber(value)} {valueLabel}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StatusPills({ rows }: { rows: AdminAnalytics["subscriptions"]["statuses"] }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {rows.map((row) => (
        <div key={row.status} className="rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold text-slate-500">{row.status.replace("_", " ")}</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{formatAnalyticsNumber(row.count)}</p>
        </div>
      ))}
    </div>
  );
}

export function AdminAnalyticsDashboard({ analytics }: { analytics: AdminAnalytics }) {
  const { business, printing, subscriptions, agentHealth } = analytics;
  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="Total shops" value={formatAnalyticsNumber(business.totalShops)} />
        <Card label="Active shops" value={formatAnalyticsNumber(business.activeShops)} />
        <Card label="Trial shops" value={formatAnalyticsNumber(business.trialShops)} />
        <Card label="Premium shops" value={formatAnalyticsNumber(business.premiumShops)} />
        <Card label="Past due shops" value={formatAnalyticsNumber(business.pastDueShops)} />
        <Card label="Cancelled shops" value={formatAnalyticsNumber(business.cancelledShops)} />
        <Card label="Expired shops" value={formatAnalyticsNumber(business.expiredShops)} />
        <Card label="Estimated MRR" value={formatAnalyticsMoneyInr(business.estimatedMrrInr)} detail="Not collected revenue." />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <BarChart title="New shops" rows={analytics.shopGrowth} valueKey="shops" valueLabel="shops" />
        <BarChart title="Print jobs over time" rows={printing.trend} valueKey="jobs" valueLabel="jobs" />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Subscription health</h3>
            <p className="mt-1 text-sm text-slate-500">Current subscription-status snapshot.</p>
          </div>
          <p className="max-w-md text-right text-xs leading-5 text-slate-500">{subscriptions.statusTrendNote}</p>
        </div>
        <StatusPills rows={subscriptions.statuses} />
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">Trial conversion: </span>
          {subscriptions.trialConversion.ratePercent == null
            ? "No ended trials yet."
            : `${subscriptions.trialConversion.ratePercent}% (${subscriptions.trialConversion.convertedCount}/${subscriptions.trialConversion.endedTrialCount})`}
          <span className="ml-1">Approximate — {subscriptions.trialConversion.note}</span>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Printing analytics</h3>
          <p className="mt-1 text-sm text-slate-500">Jobs created during {analytics.range.label.toLowerCase()}.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Card label="Print jobs" value={formatAnalyticsNumber(printing.totalJobs)} />
          <Card label="Submitted pages" value={formatAnalyticsNumber(printing.submittedPages)} detail="Not necessarily physically printed pages." />
          <Card label="Completed jobs" value={formatAnalyticsNumber(printing.completedJobs)} detail="Ready for pickup or delivered." />
          <Card label="Cancelled jobs" value={formatAnalyticsNumber(printing.cancelledJobs)} detail="Failure history is not available." />
          <Card label="Jobs with recorded error" value={formatAnalyticsNumber(printing.jobsWithRecordedError)} detail="Not an immutable failure count." />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h4 className="font-semibold text-slate-900">Print-mode breakdown</h4>
            <div className="mt-4 grid grid-cols-2 gap-4">
              {printing.modes.map((row) => (
                <div key={row.mode} className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-500">{row.mode === "BW" ? "B&W" : "Color"}</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{formatAnalyticsNumber(row.submittedPages)}</p>
                  <p className="mt-1 text-xs text-slate-500">submitted pages · {formatAnalyticsNumber(row.jobs)} jobs</p>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h4 className="font-semibold text-slate-900">Job-status breakdown</h4>
            <div className="mt-4 flex flex-wrap gap-2">
              {printing.statuses.length === 0 ? <p className="text-sm text-slate-500">No jobs in the selected period.</p> : printing.statuses.map((row) => (
                <span key={row.status} className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
                  {row.status.replaceAll("_", " ")}: <strong>{formatAnalyticsNumber(row.jobs)}</strong>
                </span>
              ))}
            </div>
          </section>
        </div>
        <p className="text-xs leading-5 text-slate-500">{printing.physicalPagesNote}</p>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="font-semibold text-slate-900">Top shops by submitted pages</h3>
            <p className="mt-1 text-sm text-slate-500">Maximum 10 shops in the selected period.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                <tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Shop</th><th className="px-4 py-3">Pages</th><th className="px-4 py-3">Jobs</th><th className="px-4 py-3">B&W / Color</th><th className="px-4 py-3">Agent</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analytics.topShops.length === 0 ? <tr><td colSpan={6} className="px-4 py-7 text-center text-slate-500">No shop activity in the selected period.</td></tr> : analytics.topShops.map((shop) => (
                  <tr key={shop.shopId} className="text-slate-700">
                    <td className="px-4 py-3 font-semibold">{shop.rank}</td>
                    <td className="px-4 py-3"><Link href={`/admin/shops/${shop.shopId}`} className="font-medium text-slate-900 hover:text-blue-700 hover:underline">{shop.shopName}</Link><p className="font-mono text-xs text-slate-500">{shop.shopCode}</p></td>
                    <td className="px-4 py-3 font-semibold">{formatAnalyticsNumber(shop.submittedPages)}</td>
                    <td className="px-4 py-3">{formatAnalyticsNumber(shop.jobs)}</td>
                    <td className="px-4 py-3">{formatAnalyticsNumber(shop.bwPages)} / {formatAnalyticsNumber(shop.colorPages)}</td>
                    <td className="px-4 py-3">{shop.agentStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-slate-900">Agent health</h3>
          <p className="mt-1 text-sm text-slate-500">{agentHealth.snapshotNote}</p>
          <div className="mt-5 space-y-3">
            {[['Online', agentHealth.online, 'bg-emerald-500'], ['Offline', agentHealth.offline, 'bg-amber-500'], ['Never connected', agentHealth.neverConnected, 'bg-slate-400']].map(([label, count, color]) => (
              <div key={String(label)} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span className="flex items-center gap-2 text-sm text-slate-700"><span className={`h-2.5 w-2.5 rounded-full ${color}`} />{label}</span><strong className="text-slate-900">{formatAnalyticsNumber(Number(count))}</strong></div>
            ))}
          </div>
          <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950">
            <p className="font-semibold">Revenue disclosure</p>
            <p className="mt-1 leading-5">{business.collectedRevenueNote}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
