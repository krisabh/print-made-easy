import type { BillingMode, BillingProviderId } from "@/lib/billing/types";

export function getBillingProviderId(): BillingProviderId {
  const raw = (process.env.BILLING_PROVIDER || "cashfree").trim().toLowerCase();
  if (raw === "cashfree") return "cashfree";
  // Unknown providers fall back to cashfree until adapters exist.
  return "cashfree";
}

export function getBillingMode(): BillingMode {
  const raw = (process.env.BILLING_MODE || "one_time").trim().toLowerCase();
  if (raw === "subscription") return "SUBSCRIPTION";
  return "ONE_TIME";
}

export function getBillingConfig() {
  return {
    provider: getBillingProviderId(),
    mode: getBillingMode(),
  };
}
