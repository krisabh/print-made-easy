import { PricingForm } from "@/components/dashboard/pricing-form";
import { requireShop } from "@/lib/auth";
import { serializeShopForDashboard } from "@/lib/dashboard-service";

export default async function PricingPage() {
  const { shop } = await requireShop();
  const serialized = serializeShopForDashboard(shop);

  if (!serialized.pricing) {
    return (
      <p className="text-sm text-slate-500">
        Pricing configuration is missing for this shop.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Pricing</h2>
        <p className="mt-1 text-sm text-slate-500">
          Manage per-page rates and minimum charge for customer uploads.
        </p>
      </div>
      <PricingForm initialPricing={serialized.pricing} />
    </div>
  );
}
