import Link from "next/link";

import { getCurrentPremiumPriceInr } from "@/lib/admin-settings";
import type { SubscriptionAccessState } from "@/lib/subscription";

type SubscriptionGateBannerProps = {
  access: SubscriptionAccessState;
};

export async function SubscriptionGateBanner({ access }: SubscriptionGateBannerProps) {
  const premiumPriceInr = await getCurrentPremiumPriceInr();
  if (access.hasAccess) {
    if (access.isGracePeriod) {
      return (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950">
          <p className="text-sm font-semibold">Payment issue</p>
          <p className="mt-1 text-sm opacity-90">
            {access.detail ||
              "Your payment could not be completed. Access continues during the grace period."}
          </p>
          <Link
            href="/dashboard/pricing"
            className="mt-3 inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Manage subscription
          </Link>
        </div>
      );
    }
    return null;
  }

  const trialExpired = access.reason === "trial_expired";
  const pastDueExpired = access.reason === "past_due_expired";

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950">
      <p className="text-sm font-semibold">
        {trialExpired
          ? "Your free trial has ended"
          : pastDueExpired
            ? "Payment required"
            : "Subscription required"}
      </p>
      <p className="mt-1 text-sm opacity-90">
        {trialExpired
          ? "Subscribe to continue using PrintYantra."
          : pastDueExpired
            ? access.detail ||
              "Your Premium payment failed and the grace period has ended. Restore payment to unlock printing."
            : access.detail || "Subscribe to restore printing for your shop."}
      </p>
      <p className="mt-2 text-xs opacity-80">
        You can still view Dashboard, Profile, and Billing. Printing and new
        customer uploads stay disabled until payment is restored.
      </p>
      <Link
        href="/dashboard/pricing"
        className="mt-3 inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
      >
        {pastDueExpired
          ? "Restore Premium"
          : `Subscribe for ₹${premiumPriceInr}/month`}
      </Link>
    </div>
  );
}
