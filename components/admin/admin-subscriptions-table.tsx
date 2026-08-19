import Link from "next/link";

import {
  formatAdminMoneyInr,
  type AdminSubscriptionListResult,
} from "@/lib/admin-subscriptions";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

type Props = {
  result: AdminSubscriptionListResult;
  search: string;
  status: string;
  plan: string;
};

export function AdminSubscriptionsTable({
  result,
  search,
  status,
  plan,
}: Props) {
  const { subscriptions, page, totalPages, total } = result;

  function pageHref(nextPage: number) {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (plan) params.set("plan", plan);
    params.set("page", String(nextPage));
    return `/admin/subscriptions?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">Shop</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Access</th>
              <th className="px-4 py-3">Period</th>
              <th className="px-4 py-3">Cancellation</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-sm text-slate-500"
                >
                  No subscriptions found.
                </td>
              </tr>
            ) : (
              subscriptions.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80"
                >
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/admin/subscriptions/${row.id}`}
                      className="font-medium text-slate-900 hover:text-blue-700 hover:underline"
                    >
                      {row.shopName}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">
                      {row.shopCode}
                    </p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p className="font-medium text-slate-900">
                      {row.ownerName || "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {row.ownerEmail || "—"}
                    </p>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-800">
                    {row.plan === "PREMIUM" ? "Premium" : "Trial"}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-800">
                    {row.statusLabel}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span
                      className={
                        row.hasAccess
                          ? "font-medium text-emerald-700"
                          : "font-medium text-amber-700"
                      }
                    >
                      {row.accessLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-600">
                    {row.periodLabel}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-600">
                    {row.cancellationLabel}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <p>
          {total === 0
            ? "0 subscriptions"
            : `Showing page ${page} of ${totalPages} · ${formatNumber(total)} total`}
        </p>
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
            >
              Previous
            </Link>
          ) : (
            <span className="rounded-lg border border-slate-100 px-3 py-2 text-slate-300">
              Previous
            </span>
          )}
          <span className="px-2">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={pageHref(page + 1)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
            >
              Next
            </Link>
          ) : (
            <span className="rounded-lg border border-slate-100 px-3 py-2 text-slate-300">
              Next
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Estimated MRR uses Active Premium ×{" "}
        {formatAdminMoneyInr(result.summary.planPriceInr)}/month. Collected
        revenue is not available yet.
      </p>
    </div>
  );
}
