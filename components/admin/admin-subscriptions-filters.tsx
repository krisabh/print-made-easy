import Link from "next/link";

type Props = {
  initialSearch: string;
  initialStatus: string;
  initialPlan: string;
};

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "TRIALING", label: "Trialing" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAST_DUE", label: "Past Due" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "EXPIRED", label: "Expired" },
] as const;

const PLAN_OPTIONS = [
  { value: "", label: "All plans" },
  { value: "TRIAL", label: "Trial" },
  { value: "PREMIUM", label: "Premium" },
] as const;

export function AdminSubscriptionsFilters({
  initialSearch,
  initialStatus,
  initialPlan,
}: Props) {
  const hasFilters = Boolean(
    initialSearch.trim() || initialStatus || initialPlan,
  );

  return (
    <form
      method="get"
      action="/admin/subscriptions"
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <input
          type="search"
          name="search"
          defaultValue={initialSearch}
          placeholder="Search shop, code or owner..."
          className="h-11 w-full flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none ring-blue-600 placeholder:text-slate-400 focus:ring-2"
        />
        <select
          name="status"
          defaultValue={initialStatus}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none ring-blue-600 focus:ring-2"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value || "all-status"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          name="plan"
          defaultValue={initialPlan}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none ring-blue-600 focus:ring-2"
        >
          {PLAN_OPTIONS.map((opt) => (
            <option key={opt.value || "all-plan"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Apply
        </button>
        {hasFilters ? (
          <Link
            href="/admin/subscriptions"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}
