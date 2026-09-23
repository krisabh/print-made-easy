import { AdminCouponsPanel } from "@/components/admin/admin-coupons-panel";
import { listActiveShopsForCoupons, listAdminCoupons } from "@/lib/admin-coupons";
import { requireAdmin } from "@/lib/auth";

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function AdminCouponsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const page = Number(params.page || "1");
  const [result, shops] = await Promise.all([
    listAdminCoupons({ page }),
    listActiveShopsForCoupons(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Coupons</h2>
        <p className="mt-1 text-sm text-slate-500">
          Create and manage discount codes. Coupons are not applied at checkout yet.
        </p>
      </div>
      <AdminCouponsPanel
        coupons={result.coupons}
        shops={shops}
        page={result.page}
        totalPages={result.totalPages}
        total={result.total}
      />
    </div>
  );
}
