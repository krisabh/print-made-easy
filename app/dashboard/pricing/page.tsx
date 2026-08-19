import { Suspense } from "react";

import { SaasPricingPlans } from "@/components/dashboard/saas-pricing-plans";
import { requireShop } from "@/lib/auth";
import { getCashfreeJsMode } from "@/lib/cashfree";
import {
  getShopSubscription,
  toPublicSubscriptionView,
} from "@/lib/subscription";

export default async function PricingPage() {
  const { shop } = await requireShop();
  const subscription = await getShopSubscription(shop.id);

  let cashfreeJsMode: "sandbox" | "production" = "sandbox";
  try {
    cashfreeJsMode = getCashfreeJsMode();
  } catch {
    cashfreeJsMode = "sandbox";
  }

  return (
    <div className="pb-6">
      <Suspense fallback={<p className="text-sm text-slate-500">Loading plans…</p>}>
        <SaasPricingPlans
          subscription={toPublicSubscriptionView(subscription)}
          cashfreeJsMode={cashfreeJsMode}
        />
      </Suspense>
    </div>
  );
}
