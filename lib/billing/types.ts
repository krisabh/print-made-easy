import type { PREMIUM_PLAN } from "@/lib/billing/plan";

export type BillingProviderId = "cashfree";

export type BillingMode = "ONE_TIME" | "SUBSCRIPTION";

export type PaymentStatus =
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED";

export type CheckoutKind =
  | "cashfree_payment"
  | "cashfree_subscription";

export type NormalizedBillingEventType =
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED"
  | "PAYMENT_CANCELLED"
  | "SUBSCRIPTION_ACTIVATED"
  | "SUBSCRIPTION_CANCELLED_AT_PERIOD_END"
  | "SUBSCRIPTION_CANCELLED"
  | "SUBSCRIPTION_PAYMENT_SUCCEEDED"
  | "SUBSCRIPTION_PAYMENT_FAILED"
  | "SUBSCRIPTION_EXPIRED"
  | "IGNORED";

export type NormalizedPaymentResult = {
  provider: BillingProviderId;
  mode: BillingMode;
  status: Extract<PaymentStatus, "SUCCESS" | "FAILED" | "CANCELLED">;
  amountInr: number;
  currency: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  shopIdHint?: string | null;
  paidAt?: Date | null;
  failureReason?: string | null;
  rawEventType?: string;
};

export type NormalizedBillingEvent = {
  type: NormalizedBillingEventType;
  provider: BillingProviderId;
  eventId: string;
  payment?: NormalizedPaymentResult;
  providerSubscriptionIds?: string[];
  providerCustomerId?: string | null;
  providerPlanId?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  occurredAt?: Date | null;
};

export type CreateCheckoutCustomer = {
  name: string;
  email: string;
  phone: string;
};

export type CreateOneTimeCheckoutInput = {
  shopId: string;
  shopCode: string;
  customer: CreateCheckoutCustomer;
  returnUrl: string;
  amountInr: number;
  currency: string;
  /** Merchant order id chosen by BillingService (opaque to provider). */
  providerOrderId: string;
};

export type CreateOneTimeCheckoutResult = {
  provider: BillingProviderId;
  mode: "ONE_TIME";
  checkoutKind: CheckoutKind;
  checkoutSessionId: string;
  orderId: string;
  environment: "sandbox" | "production";
};

export type CreateSubscriptionCheckoutInput = {
  shopId: string;
  shopCode: string;
  customer: CreateCheckoutCustomer;
  returnUrl: string;
};

export type CreateSubscriptionCheckoutResult = {
  provider: BillingProviderId;
  mode: "SUBSCRIPTION";
  checkoutKind: "cashfree_subscription";
  checkoutSessionId: string;
  subscriptionId: string;
  environment: "sandbox" | "production";
  providerCustomerId?: string | null;
  providerPlanId?: string | null;
};

export type BillingCheckoutResponse = {
  provider: BillingProviderId;
  mode: BillingMode;
  checkoutKind: CheckoutKind;
  checkoutSessionId: string;
  orderId?: string;
  subscriptionId?: string;
  environment: "sandbox" | "production";
  amountInr: (typeof PREMIUM_PLAN)["amountInr"];
  currency: (typeof PREMIUM_PLAN)["currency"];
};
