import { PricingForm } from "@/components/dashboard/pricing-form";
import { SubscriptionGateBanner } from "@/components/dashboard/subscription-gate-banner";
import { serializeShopForDashboard } from "@/lib/dashboard-service";
import { requireDashboardSession } from "@/lib/require-product-access";

export default async function PrintPricingPage() {
  const { session, access } = await requireDashboardSession();
  const serialized = serializeShopForDashboard(session.shop);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Print Pricing</h2>
        <p className="mt-1 text-sm text-slate-500">
          Set the prices your customers pay for printing at your shop.
        </p>
      </div>

      <SubscriptionGateBanner access={access} />

      {serialized.pricing ? (
        <PricingForm
          initialPricing={serialized.pricing}
          editingLocked={!access.hasAccess}
        />
      ) : (
        <p className="text-sm text-slate-500">
          Pricing configuration is missing for this shop.
        </p>
      )}
    </div>
  );
}
