import Link from "next/link";

import {
  formatAdminCreatedDate,
  formatAdminLastSeen,
  type AdminShopListResult,
} from "@/lib/admin-shops";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

type AdminShopsTableProps = {
  result: AdminShopListResult;
  search: string;
};

export function AdminShopsTable({ result, search }: AdminShopsTableProps) {
  const { shops, page, totalPages, total } = result;
  const q = search.trim();

  function pageHref(nextPage: number) {
    const params = new URLSearchParams();
    if (q) params.set("search", q);
    params.set("page", String(nextPage));
    return `/admin/shops?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">Shop</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Subscription</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Printers</th>
              <th className="px-4 py-3">Jobs</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {shops.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-sm text-slate-500"
                >
                  No shops found{q ? ` for “${q}”` : ""}.
                </td>
              </tr>
            ) : (
              shops.map((shop) => (
                <tr
                  key={shop.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80"
                >
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/admin/shops/${shop.id}`}
                      className="font-medium text-slate-900 hover:text-blue-700 hover:underline"
                    >
                      {shop.shopName}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">
                      {shop.shopCode}
                    </p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p className="font-medium text-slate-900">
                      {shop.owner.name || "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {shop.owner.email || "—"}
                    </p>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-800">
                    {shop.subscription.label}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p
                      className={
                        shop.agent.status === "Online"
                          ? "font-medium text-emerald-700"
                          : shop.agent.status === "Offline"
                            ? "font-medium text-amber-700"
                            : "text-slate-500"
                      }
                    >
                      {shop.agent.status}
                    </p>
                    {shop.agent.lastSeen ? (
                      <p className="mt-0.5 text-xs text-slate-500">
                        Last seen: {formatAdminLastSeen(shop.agent.lastSeen)}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-800">
                    {formatNumber(shop.printerCount)}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-800">
                    {formatNumber(shop.jobCount)}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-600">
                    {formatAdminCreatedDate(shop.createdAt)}
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
            ? "0 shops"
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
    </div>
  );
}
