import { DashboardShell } from "@/components/dashboard/shell";
import {
  DEMO_SHOP_CODE,
  getDemoShop,
  serializeShopForDashboard,
} from "@/lib/dashboard-service";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const shop = await getDemoShop();

  if (!shop) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Shop unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">
            Demo shop {DEMO_SHOP_CODE} could not be loaded. Check your database
            connection and seed data.
          </p>
        </div>
      </main>
    );
  }

  const serialized = serializeShopForDashboard(shop);

  return (
    <DashboardShell
      shopName={serialized.shopName}
      shopCode={serialized.shopCode}
    >
      {children}
    </DashboardShell>
  );
}
