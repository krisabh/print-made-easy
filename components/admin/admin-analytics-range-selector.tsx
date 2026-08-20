import Link from "next/link";

import {
  ADMIN_ANALYTICS_RANGES,
  type AdminAnalyticsRange,
} from "@/lib/admin-analytics";

const LABELS: Record<AdminAnalyticsRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
  year: "This year",
};

export function AdminAnalyticsRangeSelector({ range }: { range: AdminAnalyticsRange }) {
  return (
    <nav aria-label="Analytics date range" className="flex flex-wrap gap-2">
      {ADMIN_ANALYTICS_RANGES.map((item) => (
        <Link
          key={item}
          href={`/admin/analytics?range=${item}`}
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
            item === range
              ? "bg-blue-600 text-white shadow-sm"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          {LABELS[item]}
        </Link>
      ))}
    </nav>
  );
}
