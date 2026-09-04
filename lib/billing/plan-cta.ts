import type { BillingMode } from "@/lib/billing/types";
import type { PublicSubscriptionView } from "@/lib/subscription";

export type BillingPlanCtaKind =
  | "premium_active"
  | "access_until_period_end"
  | "past_due_grace"
  | "checkout";

export type BillingPlanCta = {
  kind: BillingPlanCtaKind;
  /** True only when an enabled Pay/Subscribe button should render. */
  payEnabled: boolean;
  label: string;
  headline?: string;
  detail?: string | null;
  validUntil?: string | null;
};

function formatValidUntil(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Maps server PublicSubscriptionView → My Plan / Billing Premium CTA.
 * Source of truth is subscription/access from the server — never URL/checkout.
 */
export function resolveBillingPlanCta(
  subscription: PublicSubscriptionView | null,
  input: {
    billingMode: BillingMode;
    premiumPriceInr: number;
    busy?: boolean;
  },
): BillingPlanCta {
  const premiumActive =
    subscription?.status === "ACTIVE" &&
    subscription.plan === "PREMIUM" &&
    subscription.hasAccess &&
    !subscription.cancelAtPeriodEnd;

  const cancelAtPeriodEnd =
    Boolean(subscription?.cancelAtPeriodEnd) &&
    subscription?.status === "ACTIVE" &&
    Boolean(subscription.hasAccess);

  const cancelledUntilPeriodEnd =
    subscription?.status === "CANCELLED" && Boolean(subscription.hasAccess);

  const pastDue =
    subscription?.status === "PAST_DUE" && Boolean(subscription.hasAccess);

  const canSubscribe = Boolean(subscription?.canSubscribe);
  const busy = Boolean(input.busy);
  const validUntil = formatValidUntil(subscription?.currentPeriodEnd);

  if (premiumActive) {
    return {
      kind: "premium_active",
      payEnabled: false,
      label: "Premium Active",
      headline: "You are already a Premium member.",
      detail: subscription?.detail || null,
      validUntil,
    };
  }

  if (cancelAtPeriodEnd || cancelledUntilPeriodEnd) {
    return {
      kind: "access_until_period_end",
      payEnabled: false,
      label: "Access until period end",
      detail: subscription?.detail || null,
      validUntil,
    };
  }

  if (pastDue) {
    return {
      kind: "past_due_grace",
      payEnabled: false,
      label: "Payment issue — grace period active",
      detail: subscription?.detail || null,
      validUntil: null,
    };
  }

  const checkoutLabel =
    input.billingMode === "ONE_TIME"
      ? `Pay ₹${input.premiumPriceInr}`
      : `Subscribe for ₹${input.premiumPriceInr}/month`;

  return {
    kind: "checkout",
    payEnabled: !busy && canSubscribe,
    label: busy ? "Processing…" : checkoutLabel,
  };
}
