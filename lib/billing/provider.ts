import type {
  CreateOneTimeCheckoutInput,
  CreateOneTimeCheckoutResult,
  CreateSubscriptionCheckoutInput,
  CreateSubscriptionCheckoutResult,
  NormalizedBillingEvent,
  NormalizedPaymentResult,
} from "@/lib/billing/types";

export interface OneTimePaymentProvider {
  createOneTimeCheckout(
    input: CreateOneTimeCheckoutInput,
  ): Promise<CreateOneTimeCheckoutResult>;
  /**
   * Server-side verify of a provider order/payment (never trust the browser).
   * Does not activate Premium — BillingService applies normalized results.
   */
  verifyOneTimePayment(input: {
    providerOrderId: string;
  }): Promise<NormalizedPaymentResult>;
}

export interface SubscriptionPaymentProvider {
  createSubscriptionCheckout(
    input: CreateSubscriptionCheckoutInput,
  ): Promise<CreateSubscriptionCheckoutResult>;
  cancelSubscription(input: {
    providerSubscriptionId: string;
  }): Promise<{ providerSubscriptionId: string; status: string }>;
}

export type WebhookNormalizeResult =
  | { ok: true; event: NormalizedBillingEvent; duplicate?: false }
  | { ok: true; duplicate: true; eventId: string; eventType: string }
  | { ok: false; status: 400 | 401; error: string };

export interface WebhookNormalizer {
  /**
   * Verify provider signature and map to a normalized event.
   * Returns null when this normalizer does not handle the payload family
   * (e.g. subscription vs PG) — caller may fall back to legacy handlers.
   */
  verifyAndNormalize(input: {
    rawBody: string;
    signature: string | null;
    timestamp: string | null;
    now?: Date;
  }): Promise<WebhookNormalizeResult | null>;
}

export type PaymentProviderAdapter = {
  id: "cashfree";
  oneTime?: OneTimePaymentProvider;
  subscription?: SubscriptionPaymentProvider;
  /** Normalizes Payment Gateway (one-time) webhooks. */
  oneTimeWebhook?: WebhookNormalizer;
};
