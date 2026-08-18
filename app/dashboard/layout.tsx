import { DashboardShell } from "@/components/dashboard/shell";
import { requireShop } from "@/lib/auth";
import { serializeShopForDashboard } from "@/lib/dashboard-service";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { shop } = await requireShop();
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
