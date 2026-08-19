import { AdminShopsSearch } from "@/components/admin/admin-shops-search";
import { AdminShopsTable } from "@/components/admin/admin-shops-table";
import { listAdminShops } from "@/lib/admin-shops";
import { requireAdmin } from "@/lib/auth";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

type PageProps = {
  searchParams: Promise<{
    search?: string;
    q?: string;
    page?: string;
  }>;
};

export default async function AdminShopsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const search = (params.search || params.q || "").trim();
  const page = Number(params.page || "1");

  const result = await listAdminShops({
    search,
    page,
    pageSize: 20,
  });

  const cards = [
    { label: "Total Shops", value: result.summary.totalShops },
    { label: "Active Shops", value: result.summary.activeShops },
    { label: "Trial Shops", value: result.summary.trialShops },
    { label: "Premium Shops", value: result.summary.premiumShops },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Shop Management</h2>
        <p className="mt-1 text-sm text-slate-500">
          Read-only directory of all PrintMadeEasy shops.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm"
          >
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {card.label}
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
              {formatNumber(card.value)}
            </p>
          </div>
        ))}
      </div>

      <AdminShopsSearch initialSearch={search} />
      <AdminShopsTable result={result} search={search} />
    </div>
  );
}
