import type { AdminOverviewMetrics } from "@/lib/admin-metrics";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

const CARDS: Array<{
  key: keyof AdminOverviewMetrics;
  label: string;
}> = [
  { key: "totalShops", label: "Total Shops" },
  { key: "premiumShops", label: "Premium Shops" },
  { key: "trialShops", label: "Trial Shops" },
  { key: "expiredSubscriptions", label: "Expired" },
  { key: "pastDueSubscriptions", label: "Past Due" },
  { key: "activeShops", label: "Active Shops" },
  { key: "totalPrintJobs", label: "Print Jobs" },
  { key: "totalPagesPrinted", label: "Pages Printed" },
];

type AdminOverviewCardsProps = {
  metrics: AdminOverviewMetrics;
};

export function AdminOverviewCards({ metrics }: AdminOverviewCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {CARDS.map((card) => (
        <div
          key={card.key}
          className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm"
        >
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {card.label}
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
            {formatNumber(metrics[card.key])}
          </p>
        </div>
      ))}
    </div>
  );
}
