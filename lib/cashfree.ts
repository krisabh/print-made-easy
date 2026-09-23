import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

import { PREMIUM_PLAN } from "@/lib/billing/plan";

export const CASHFREE_PROVIDER = "CASHFREE";
export const CASHFREE_API_VERSION = "2025-01-01";

/** @deprecated Import from `@/lib/billing/plan` — re-exported for compatibility. */
export { PREMIUM_PLAN };

export type CashfreeEnvironment = "sandbox" | "production";

export type CashfreeCreateSubscriptionResult = {
  subscriptionId: string;
  cfSubscriptionId: string;
  subscriptionSessionId: string;
  subscriptionStatus: string;
  planId: string | null;
  customerId: string | null;
};

export type CashfreeClientConfig = {
  clientId: string;
  clientSecret: string;
  environment: CashfreeEnvironment;
  /** Optional pre-created Cashfree plan_id; otherwise PERIODIC plan is sent inline. */
  planId?: string | null;
};

function getBaseUrl(environment: CashfreeEnvironment) {
  return environment === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

export function getCashfreeConfig(): CashfreeClientConfig {
  const clientId = process.env.CASHFREE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET?.trim() || "";
  const rawEnv = (process.env.CASHFREE_ENVIRONMENT || "sandbox")
    .trim()
    .toLowerCase();
  const environment: CashfreeEnvironment =
    rawEnv === "production" ? "production" : "sandbox";
  const planId = process.env.CASHFREE_PLAN_ID?.trim() || null;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Cashfree is not configured. Set CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET.",
    );
  }

  return { clientId, clientSecret, environment, planId };
}

export function getCashfreeJsMode(environment?: CashfreeEnvironment) {
  const env = environment || getCashfreeConfig().environment;
  return env === "production" ? "production" : "sandbox";
}

/**
 * Verify Cashfree subscription webhook signature.
 * Docs: HMAC-SHA256(timestamp + rawBody) with client secret, Base64 compare.
 */
export function verifyCashfreeWebhookSignature(input: {
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  rawBody: string;
  secret?: string;
}) {
  const signature = input.signature?.trim() || "";
  const timestamp = input.timestamp?.trim() || "";
  const secret =
    input.secret ||
    process.env.CASHFREE_WEBHOOK_SECRET?.trim() ||
    process.env.CASHFREE_CLIENT_SECRET?.trim() ||
    "";

  if (!signature || !timestamp || !secret || !input.rawBody) {
    return false;
  }

  const computed = createHmac("sha256", secret)
    .update(timestamp + input.rawBody)
    .digest("base64");

  try {
    const a = Buffer.from(computed);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function hashWebhookPayload(rawBody: string) {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function buildWebhookEventId(payload: {
  type?: string;
  event_time?: string;
  data?: Record<string, unknown>;
}) {
  const type = payload.type || "UNKNOWN";
  const eventTime = payload.event_time || "";
  const data = payload.data || {};
  const subscriptionDetails =
    (data.subscription_details as Record<string, unknown> | undefined) || {};
  const payment =
    (data.payment as Record<string, unknown> | undefined) ||
    (data.payment_details as Record<string, unknown> | undefined) ||
    {};

  const subscriptionKey =
    String(
      subscriptionDetails.cf_subscription_id ||
        subscriptionDetails.subscription_id ||
        data.cf_subscription_id ||
        data.subscription_id ||
        "",
    ) || "none";

  // Cashfree may nest payment ids or place them at data root (PAYMENT_FAILED).
  const paymentKey = String(
    payment.payment_id ||
      payment.cf_payment_id ||
      data.payment_id ||
      data.cf_payment_id ||
      (data.authorization_details as Record<string, unknown> | undefined)
        ?.payment_id ||
      "none",
  );

  return `${type}:${subscriptionKey}:${eventTime}:${paymentKey}`.slice(0, 191);
}

function authHeaders(config: CashfreeClientConfig) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-api-version": CASHFREE_API_VERSION,
    "x-client-id": config.clientId,
    "x-client-secret": config.clientSecret,
  };
}

export function buildMerchantSubscriptionId(shopCode: string) {
  const stamp = Date.now().toString(36);
  const rand = randomBytes(3).toString("hex");
  // Cashfree merchant subscription_id — alphanumeric, keep short.
  return `PME-${shopCode}-${stamp}${rand}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50);
}

export async function createCashfreeSubscription(input: {
  config?: CashfreeClientConfig;
  merchantSubscriptionId: string;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  returnUrl: string;
  /** Server-resolved price. Callers must pass the current Admin amount. */
  amountInr: number;
  fetchImpl?: typeof fetch;
}): Promise<CashfreeCreateSubscriptionResult> {
  const config = input.config || getCashfreeConfig();
  const fetchImpl = input.fetchImpl || fetch;
  if (
    !Number.isInteger(input.amountInr) ||
    input.amountInr < 1 ||
    input.amountInr > 100_000
  ) {
    throw new Error("Cashfree checkout amount is invalid.");
  }
  const amountInr = input.amountInr;
  const phone = input.customer.phone.replace(/\D/g, "").slice(-10) || "9999999999";

  const planDetails = config.planId
    ? {
        plan_id: config.planId,
      }
    : {
        plan_name: PREMIUM_PLAN.planName,
        plan_type: "PERIODIC",
        plan_amount: amountInr,
        plan_max_amount: amountInr,
        plan_intervals: PREMIUM_PLAN.intervals,
        plan_interval_type: PREMIUM_PLAN.intervalType,
        plan_currency: PREMIUM_PLAN.currency,
        plan_note: "PrintYantra Premium monthly subscription",
      };

  const body = {
    subscription_id: input.merchantSubscriptionId,
    customer_details: {
      customer_name: input.customer.name.slice(0, 100),
      customer_email: input.customer.email.slice(0, 255),
      customer_phone: phone,
    },
    plan_details: planDetails,
    authorization_details: {
      authorization_amount: amountInr,
      authorization_amount_refund: false,
      payment_methods: ["upi", "card"],
    },
    subscription_meta: {
      return_url: input.returnUrl,
      notification_channel: ["EMAIL"],
    },
    subscription_expiry_time: "2099-12-31T23:59:59Z",
  };

  const response = await fetchImpl(
    `${getBaseUrl(config.environment)}/subscriptions`,
    {
      method: "POST",
      headers: authHeaders(config),
      body: JSON.stringify(body),
    },
  );

  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    const message =
      (typeof data.message === "string" && data.message) ||
      (typeof data.error === "string" && data.error) ||
      `Cashfree subscription create failed (${response.status})`;
    throw new Error(message);
  }

  const subscriptionSessionId = String(data.subscription_session_id || "");
  const subscriptionId = String(data.subscription_id || input.merchantSubscriptionId);
  const cfSubscriptionId = String(data.cf_subscription_id || subscriptionId);

  if (!subscriptionSessionId) {
    throw new Error("Cashfree did not return a subscription session.");
  }

  const plan = (data.plan_details as Record<string, unknown> | undefined) || {};
  const customer =
    (data.customer_details as Record<string, unknown> | undefined) || {};

  return {
    subscriptionId,
    cfSubscriptionId,
    subscriptionSessionId,
    subscriptionStatus: String(data.subscription_status || "INITIALIZED"),
    planId: plan.plan_id ? String(plan.plan_id) : config.planId ?? null,
    customerId: customer.customer_id ? String(customer.customer_id) : null,
  };
}

/**
 * Cancel a Cashfree subscription (stops future charges).
 * Docs: POST /pg/subscriptions/{subscription_id}/manage with action CANCEL.
 * Uses the merchant subscription_id that was used at create time.
 */
export async function cancelCashfreeSubscription(input: {
  config?: CashfreeClientConfig;
  /** Merchant subscription_id used when the subscription was created. */
  subscriptionId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ subscriptionId: string; subscriptionStatus: string }> {
  const config = input.config || getCashfreeConfig();
  const fetchImpl = input.fetchImpl || fetch;
  const subscriptionId = input.subscriptionId.trim();
  if (!subscriptionId) {
    throw new Error("Cashfree subscription id is required to cancel.");
  }

  const response = await fetchImpl(
    `${getBaseUrl(config.environment)}/subscriptions/${encodeURIComponent(subscriptionId)}/manage`,
    {
      method: "POST",
      headers: authHeaders(config),
      body: JSON.stringify({
        subscription_id: subscriptionId,
        action: "CANCEL",
      }),
    },
  );

  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    const message =
      (typeof data.message === "string" && data.message) ||
      (typeof data.error === "string" && data.error) ||
      `Cashfree subscription cancel failed (${response.status})`;
    throw new Error(message);
  }

  return {
    subscriptionId: String(data.subscription_id || subscriptionId),
    subscriptionStatus: String(data.subscription_status || "CANCELLED"),
  };
}

export function addMonths(from: Date, months: number) {
  const next = new Date(from.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

/**
 * Cashfree replaces the literal `{order_id}` token on redirect.
 * Existing query params such as `payment=return` are preserved.
 */
export function withCashfreeOrderPlaceholder(returnUrl: string) {
  if (returnUrl.includes("{order_id}")) return returnUrl;
  const join = returnUrl.includes("?") ? "&" : "?";
  return `${returnUrl}${join}order_id={order_id}`;
}

/** Per-order webhook target. Cashfree delivers this even when the dashboard URL is stale. */
export function cashfreeNotifyUrl(returnUrl: string) {
  const parsable = returnUrl.replaceAll("{order_id}", "order");
  const url = new URL(parsable);
  url.pathname = "/api/webhooks/cashfree";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildMerchantOrderId(shopCode: string) {
  const stamp = Date.now().toString(36);
  const rand = randomBytes(3).toString("hex");
  return `PMEPAY-${shopCode}-${stamp}${rand}`
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 45);
}

export type CashfreeCreateOrderResult = {
  orderId: string;
  cfOrderId: string | null;
  paymentSessionId: string;
  orderStatus: string;
};

/**
 * Create a Cashfree Payment Gateway order (one-time payment).
 * Docs: POST /pg/orders → payment_session_id for JS checkout().
 */
export async function createCashfreeOrder(input: {
  config?: CashfreeClientConfig;
  orderId: string;
  amountInr: number;
  currency: string;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  returnUrl: string;
  /** Opaque tag echoed in webhooks / order notes — e.g. shopId. */
  orderNote?: string;
  fetchImpl?: typeof fetch;
}): Promise<CashfreeCreateOrderResult> {
  const config = input.config || getCashfreeConfig();
  const fetchImpl = input.fetchImpl || fetch;
  const phone =
    input.customer.phone.replace(/\D/g, "").slice(-10) || "9999999999";

  const body = {
    order_id: input.orderId,
    order_amount: input.amountInr,
    order_currency: input.currency,
    customer_details: {
      customer_id: `shop_${phone}`.slice(0, 50),
      customer_name: input.customer.name.slice(0, 100),
      customer_email: input.customer.email.slice(0, 255),
      customer_phone: phone,
    },
    order_meta: {
      return_url: withCashfreeOrderPlaceholder(input.returnUrl),
      notify_url: cashfreeNotifyUrl(input.returnUrl),
    },
    order_note: (input.orderNote || "PrintYantra Premium").slice(0, 200),
  };

  const response = await fetchImpl(`${getBaseUrl(config.environment)}/orders`, {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    const message =
      (typeof data.message === "string" && data.message) ||
      (typeof data.error === "string" && data.error) ||
      `Cashfree order create failed (${response.status})`;
    throw new Error(message);
  }

  const paymentSessionId = String(
    data.payment_session_id || data.payment_sessions_id || "",
  );
  if (!paymentSessionId) {
    throw new Error("Cashfree did not return a payment session.");
  }

  return {
    orderId: String(data.order_id || input.orderId),
    cfOrderId: data.cf_order_id ? String(data.cf_order_id) : null,
    paymentSessionId,
    orderStatus: String(data.order_status || "ACTIVE"),
  };
}

export type CashfreeOrderLookupResult = {
  orderId: string;
  orderStatus: string;
  orderAmount: number;
  orderCurrency: string;
  cfPaymentId: string | null;
  paymentStatus: string | null;
};

/** Server-side order lookup — never trust browser return as payment proof. */
export async function getCashfreeOrder(input: {
  config?: CashfreeClientConfig;
  orderId: string;
  fetchImpl?: typeof fetch;
}): Promise<CashfreeOrderLookupResult> {
  const config = input.config || getCashfreeConfig();
  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl(
    `${getBaseUrl(config.environment)}/orders/${encodeURIComponent(input.orderId)}`,
    {
      method: "GET",
      headers: authHeaders(config),
    },
  );
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const message =
      (typeof data.message === "string" && data.message) ||
      `Cashfree order lookup failed (${response.status})`;
    throw new Error(message);
  }

  const orderStatus = String(data.order_status || "");
  let cfPaymentId: string | null = null;
  let paymentStatus: string | null = null;

  if (Array.isArray(data.payments)) {
    const latestPayment =
      (data.payments[0] as Record<string, unknown> | undefined) || {};
    cfPaymentId = latestPayment.cf_payment_id
      ? String(latestPayment.cf_payment_id)
      : null;
    paymentStatus = latestPayment.payment_status
      ? String(latestPayment.payment_status)
      : null;
  }

  const alreadyPaid =
    orderStatus.toUpperCase() === "PAID" ||
    paymentStatus?.toUpperCase() === "SUCCESS";

  // GET /orders returns `payments` as `{ url }`, not payment rows.
  // A successful payment can exist while order_status is still ACTIVE.
  if (!alreadyPaid) {
    const paymentsResponse = await fetchImpl(
      `${getBaseUrl(config.environment)}/orders/${encodeURIComponent(input.orderId)}/payments`,
      {
        method: "GET",
        headers: authHeaders(config),
      },
    );
    if (paymentsResponse.ok) {
      const paymentsBody = (await paymentsResponse.json().catch(() => [])) as
        | Record<string, unknown>[]
        | { payments?: Record<string, unknown>[] };
      const list = Array.isArray(paymentsBody)
        ? paymentsBody
        : Array.isArray(paymentsBody?.payments)
          ? paymentsBody.payments
          : [];
      const success = list.find(
        (row) => String(row.payment_status || "").toUpperCase() === "SUCCESS",
      );
      const chosen = success || list[0];
      if (chosen) {
        paymentStatus = chosen.payment_status
          ? String(chosen.payment_status)
          : paymentStatus;
        cfPaymentId = chosen.cf_payment_id
          ? String(chosen.cf_payment_id)
          : cfPaymentId;
      }
    }
  }

  return {
    orderId: String(data.order_id || input.orderId),
    orderStatus,
    orderAmount: Number(data.order_amount ?? 0),
    orderCurrency: String(data.order_currency || "INR").toUpperCase(),
    cfPaymentId,
    paymentStatus,
  };
}

export function buildPgWebhookEventId(payload: {
  type?: string;
  event_time?: string;
  data?: Record<string, unknown>;
}) {
  const type = payload.type || "UNKNOWN";
  const eventTime = payload.event_time || "";
  const data = payload.data || {};
  const order = (data.order as Record<string, unknown> | undefined) || {};
  const payment = (data.payment as Record<string, unknown> | undefined) || {};

  const orderKey = String(order.order_id || data.order_id || "none");
  const paymentKey = String(
    payment.cf_payment_id ||
      payment.payment_id ||
      data.cf_payment_id ||
      data.payment_id ||
      "none",
  );

  return `${type}:${orderKey}:${eventTime}:${paymentKey}`.slice(0, 191);
}
