import Link from "next/link";
import type { ReactNode } from "react";

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

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {note ? <p className="mt-1 text-sm text-slate-500">{note}</p> : null}
      </div>
      {children}
    </section>
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
        <p className="mt-6 text-sm text-slate-500">No data in the reporting period.</p>
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

function formatAverageInr(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

export function AdminAnalyticsDashboard({ analytics }: { analytics: AdminAnalytics }) {
  const { business, printing, subscriptions, agentHealth, payments, coupons } = analytics;
  const period = analytics.range.label;

  return (
    <div className="space-y-8">
      <Section
        title="Current platform state"
        note="These counts are the current database snapshot. They are not filtered by the reporting period."
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Card label="Total shops" value={formatAnalyticsNumber(business.totalShops)} />
          <Card label="Active shops" value={formatAnalyticsNumber(business.activeShops)} detail="Shop account is active." />
          <Card label="Deactivated shops" value={formatAnalyticsNumber(business.deactivatedShops)} detail="Shop account is deactivated. This is not a subscription status." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Card label="Trialing" value={formatAnalyticsNumber(business.trialShops)} />
          <Card label="Premium" value={formatAnalyticsNumber(business.premiumShops)} detail="Premium plan and active status." />
          <Card label="Past due" value={formatAnalyticsNumber(business.pastDueShops)} />
          <Card label="Cancelled" value={formatAnalyticsNumber(business.cancelledShops)} detail="Subscription status. Not a deactivated shop." />
          <Card label="Expired" value={formatAnalyticsNumber(business.expiredShops)} />
        </div>
      </Section>

      <Section
        title="Revenue and payments"
        note={`Payment totals use the reporting period (${period}). List-price MRR is a current snapshot.`}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Card
            label="List-price MRR"
            value={formatAnalyticsMoneyInr(business.listPriceMrrInr)}
            detail={`${business.listPriceMrrNote} Current list price ${formatAnalyticsMoneyInr(business.listPriceInr)}.`}
          />
          <Card
            label="Collected revenue"
            value={formatAnalyticsMoneyInr(payments.collectedRevenueInr)}
            detail={payments.collectedRevenueNote}
          />
          <Card label="Successful payments" value={formatAnalyticsNumber(payments.successfulCount)} detail="Paid during the reporting period." />
          <Card label="Pending payments" value={formatAnalyticsNumber(payments.pendingCount)} detail="Created during the reporting period and still pending." />
          <Card label="Failed payments" value={formatAnalyticsNumber(payments.failedCount)} detail="Created during the reporting period and currently failed." />
          <Card
            label="Average successful payment"
            value={formatAverageInr(payments.averageSuccessfulPaymentInr)}
            detail="Collected revenue divided by successful payments in the reporting period."
          />
        </div>
      </Section>

      <Section title="Subscription funnel">
        <div className="grid gap-6 xl:grid-cols-2">
          <BarChart title="New shops" rows={analytics.shopGrowth} valueKey="shops" valueLabel="shops" />
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-5 text-sm text-amber-950">
            <p className="text-xs font-semibold tracking-wide uppercase">Trial conversion</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight">
              {subscriptions.trialConversion.ratePercent == null
                ? "No ended trials yet"
                : `${subscriptions.trialConversion.ratePercent}%`}
            </p>
            {subscriptions.trialConversion.ratePercent != null ? (
              <p className="mt-2">
                {formatAnalyticsNumber(subscriptions.trialConversion.convertedCount ?? 0)} of{" "}
                {formatAnalyticsNumber(subscriptions.trialConversion.endedTrialCount ?? 0)} ended trials are currently Premium.
              </p>
            ) : null}
            <p className="mt-3 text-xs leading-5">{subscriptions.trialConversion.note}</p>
          </div>
        </div>
      </Section>

      <Section
        title="Coupon activity"
        note={`Counts for ${period}. Discount rupees are not calculated.`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Card label="Coupon redemptions" value={formatAnalyticsNumber(coupons.redemptionCount)} detail="Redemptions recorded during the reporting period." />
          <Card label="Successful payments using coupons" value={formatAnalyticsNumber(coupons.successfulPaymentsUsingCoupons)} detail="Successful payments in the reporting period that have a redemption." />
        </div>
      </Section>

      <Section
        title="Printing activity"
        note={`Jobs created during ${period}. Submitted pages are not necessarily physically printed pages.`}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Card label="Print jobs" value={formatAnalyticsNumber(printing.totalJobs)} />
          <Card label="Submitted pages" value={formatAnalyticsNumber(printing.submittedPages)} detail="Sum of submitted pages. Not physical printed pages." />
          <Card label="Completed jobs" value={formatAnalyticsNumber(printing.completedJobs)} detail="Ready for pickup or delivered." />
          <Card label="Cancelled jobs" value={formatAnalyticsNumber(printing.cancelledJobs)} />
          <Card label="Jobs with recorded error" value={formatAnalyticsNumber(printing.jobsWithRecordedError)} detail="Not an immutable failure count." />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <BarChart title="Print jobs over time" rows={printing.trend} valueKey="jobs" valueLabel="jobs" />
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h4 className="font-semibold text-slate-900">Print-mode breakdown</h4>
            <div className="mt-4 grid grid-cols-2 gap-4">
              {printing.modes.map((row) => (
                <div key={row.mode} className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-500">{row.mode === "BW" ? "B&W pages" : "Color pages"}</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{formatAnalyticsNumber(row.submittedPages)}</p>
                  <p className="mt-1 text-xs text-slate-500">submitted pages · {formatAnalyticsNumber(row.jobs)} jobs</p>
                </div>
              ))}
            </div>
          </section>
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h4 className="font-semibold text-slate-900">Job-status breakdown</h4>
          <div className="mt-4 flex flex-wrap gap-2">
            {printing.statuses.length === 0 ? <p className="text-sm text-slate-500">No jobs in the reporting period.</p> : printing.statuses.map((row) => (
              <span key={row.status} className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
                {row.status.replaceAll("_", " ")}: <strong>{formatAnalyticsNumber(row.jobs)}</strong>
              </span>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">{printing.physicalPagesNote}</p>
        </section>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="font-semibold text-slate-900">Top shops by submitted pages</h3>
            <p className="mt-1 text-sm text-slate-500">Maximum 10 shops in the reporting period.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                <tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Shop</th><th className="px-4 py-3">Pages</th><th className="px-4 py-3">Jobs</th><th className="px-4 py-3">B&W / Color</th><th className="px-4 py-3">Agent</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analytics.topShops.length === 0 ? <tr><td colSpan={6} className="px-4 py-7 text-center text-slate-500">No shop activity in the reporting period.</td></tr> : analytics.topShops.map((shop) => (
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
      </Section>

      <Section title="Agent health" note={agentHealth.snapshotNote}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card label="Online" value={formatAnalyticsNumber(agentHealth.online)} detail="Live agent snapshot." />
          <Card label="Offline" value={formatAnalyticsNumber(agentHealth.offline)} detail="Live agent snapshot." />
          <Card label="Never connected" value={formatAnalyticsNumber(agentHealth.neverConnected)} detail="Live agent snapshot." />
        </div>
      </Section>
    </div>
  );
}
