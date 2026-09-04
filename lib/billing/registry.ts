import { getBillingProviderId } from "@/lib/billing/config";
import { createCashfreeAdapter } from "@/lib/billing/cashfree-adapter";
import type { PaymentProviderAdapter } from "@/lib/billing/provider";
import type { BillingProviderId } from "@/lib/billing/types";

const adapters: Record<BillingProviderId, () => PaymentProviderAdapter> = {
  cashfree: createCashfreeAdapter,
};

export function getPaymentProviderAdapter(
  providerId?: BillingProviderId,
): PaymentProviderAdapter {
  const id = providerId || getBillingProviderId();
  const factory = adapters[id];
  if (!factory) {
    throw new Error(`Billing provider is not configured: ${id}`);
  }
  return factory();
}
