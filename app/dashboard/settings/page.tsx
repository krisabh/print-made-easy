import { SettingsForm } from "@/components/dashboard/settings-form";
import { getDemoShop, serializeShopForDashboard } from "@/lib/dashboard-service";

export default async function SettingsPage() {
  const shop = await getDemoShop();

  if (!shop) {
    return <p className="text-sm text-slate-500">Unable to load settings.</p>;
  }

  const serialized = serializeShopForDashboard(shop);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Shop profile and document retention information.
        </p>
      </div>
      <SettingsForm
        initialValues={{
          shopName: serialized.shopName,
          phone: serialized.phone,
          address: serialized.address,
          currency: serialized.settings.currency,
          timezone: serialized.settings.timezone,
        }}
      />
    </div>
  );
}
