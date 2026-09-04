import { Suspense } from "react";

import { SaasPricingPlans } from "@/components/dashboard/saas-pricing-plans";
import { requireShop } from "@/lib/auth";
import { getBillingConfig } from "@/lib/billing/config";
import { PREMIUM_PLAN } from "@/lib/billing/plan";
import { getCashfreeJsMode } from "@/lib/cashfree";
import {
  getShopSubscription,
  toPublicSubscriptionView,
} from "@/lib/subscription";

/** Always read current Subscription entitlement — never serve a cached Trial snapshot. */
export const dynamic = "force-dynamic";

export default async function PlanBillingPage() {
  const { shop } = await requireShop();
  const subscription = await getShopSubscription(shop.id);
  const billing = getBillingConfig();

  let cashfreeJsMode: "sandbox" | "production" = "sandbox";
  try {
    cashfreeJsMode = getCashfreeJsMode();
  } catch {
    cashfreeJsMode = "sandbox";
  }

  return (
    <div className="space-y-5 pb-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">My Plan / Billing</h2>
        <p className="mt-1 text-sm text-slate-500">
          View your current plan and manage your PrintMadeEasy subscription.
        </p>
      </div>

      <Suspense fallback={<p className="text-sm text-slate-500">Loading plans…</p>}>
        <SaasPricingPlans
          subscription={toPublicSubscriptionView(subscription)}
          cashfreeJsMode={cashfreeJsMode}
          premiumPriceInr={PREMIUM_PLAN.amountInr}
          billingMode={billing.mode}
        />
      </Suspense>
    </div>
  );
}
