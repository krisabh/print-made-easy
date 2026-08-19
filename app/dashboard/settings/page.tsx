import { PricingForm } from "@/components/dashboard/pricing-form";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { serializeShopForDashboard } from "@/lib/dashboard-service";
import { requireProductAccess } from "@/lib/require-product-access";

export default async function SettingsPage() {
  const { session } = await requireProductAccess();
  const { shop } = session;
  const serialized = serializeShopForDashboard(shop);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Shop profile, customer print rates, and document retention information.
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
      {serialized.pricing ? (
        <PricingForm initialPricing={serialized.pricing} />
      ) : (
        <p className="text-sm text-slate-500">
          Pricing configuration is missing for this shop.
        </p>
      )}
    </div>
  );
}
