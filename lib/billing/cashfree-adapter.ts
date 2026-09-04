import {
  buildMerchantSubscriptionId,
  buildPgWebhookEventId,
  cancelCashfreeSubscription,
  createCashfreeOrder,
  createCashfreeSubscription,
  getCashfreeJsMode,
  getCashfreeOrder,
  hashWebhookPayload,
  PREMIUM_PLAN,
  verifyCashfreeWebhookSignature,
} from "@/lib/cashfree";
import type { PaymentProviderAdapter } from "@/lib/billing/provider";
import type {
  NormalizedBillingEvent,
  NormalizedPaymentResult,
} from "@/lib/billing/types";
import { claimWebhookEvent } from "@/lib/billing/webhook-idempotency";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Documented Cashfree Payment Gateway webhook `type` values
 * (API reference: payments webhooks, version 2025-01-01 / latest).
 * Subscription events contain "SUBSCRIPTION" and are excluded here.
 */
const PG_WEBHOOK_TYPES = new Set([
  "PAYMENT_SUCCESS_WEBHOOK",
  "PAYMENT_FAILED_WEBHOOK",
  "PAYMENT_USER_DROPPED_WEBHOOK",
]);

function isSubscriptionWebhookType(eventType: string) {
  return eventType.toUpperCase().includes("SUBSCRIPTION");
}

function isOneTimePgWebhookType(eventType: string) {
  return PG_WEBHOOK_TYPES.has(eventType);
}

export function createCashfreeAdapter(): PaymentProviderAdapter {
  return {
    id: "cashfree",
    oneTime: {
      async createOneTimeCheckout(input) {
        const created = await createCashfreeOrder({
          orderId: input.providerOrderId,
          amountInr: input.amountInr,
          currency: input.currency,
          customer: input.customer,
          returnUrl: input.returnUrl,
          orderNote: `shop:${input.shopId}`,
        });

        return {
          provider: "cashfree",
          mode: "ONE_TIME",
          checkoutKind: "cashfree_payment",
          checkoutSessionId: created.paymentSessionId,
          orderId: created.orderId,
          environment: getCashfreeJsMode(),
        };
      },
      async verifyOneTimePayment(input) {
        const order = await getCashfreeOrder({ orderId: input.providerOrderId });
        const paid =
          order.orderStatus.toUpperCase() === "PAID" ||
          order.paymentStatus?.toUpperCase() === "SUCCESS";
        return {
          provider: "cashfree" as const,
          mode: "ONE_TIME" as const,
          status: paid ? ("SUCCESS" as const) : ("FAILED" as const),
          amountInr: order.orderAmount,
          currency: order.orderCurrency,
          providerOrderId: order.orderId,
          providerPaymentId: order.cfPaymentId,
          paidAt: paid ? new Date() : null,
          failureReason: paid ? null : `Order status: ${order.orderStatus}`,
        };
      },
    },
    subscription: {
      async createSubscriptionCheckout(input) {
        const merchantSubscriptionId = buildMerchantSubscriptionId(
          input.shopCode,
        );
        const created = await createCashfreeSubscription({
          merchantSubscriptionId,
          customer: input.customer,
          returnUrl: input.returnUrl,
        });
        return {
          provider: "cashfree",
          mode: "SUBSCRIPTION",
          checkoutKind: "cashfree_subscription",
          checkoutSessionId: created.subscriptionSessionId,
          subscriptionId: created.subscriptionId || created.cfSubscriptionId,
          environment: getCashfreeJsMode(),
          providerCustomerId: created.customerId,
          providerPlanId: created.planId || PREMIUM_PLAN.internalKey,
        };
      },
      async cancelSubscription(input) {
        const result = await cancelCashfreeSubscription({
          subscriptionId: input.providerSubscriptionId,
        });
        return {
          providerSubscriptionId: result.subscriptionId,
          status: result.subscriptionStatus,
        };
      },
    },
    oneTimeWebhook: {
      async verifyAndNormalize(input) {
        const valid = verifyCashfreeWebhookSignature({
          signature: input.signature,
          timestamp: input.timestamp,
          rawBody: input.rawBody,
        });
        if (!valid) {
          return {
            ok: false as const,
            status: 401 as const,
            error: "Invalid webhook signature.",
          };
        }

        let payload: {
          type?: string;
          event_time?: string;
          data?: Record<string, unknown>;
        };
        try {
          payload = JSON.parse(input.rawBody);
        } catch {
          return {
            ok: false as const,
            status: 400 as const,
            error: "Invalid webhook payload.",
          };
        }

        const eventType = String(payload.type || "UNKNOWN");
        if (isSubscriptionWebhookType(eventType)) {
          // Let legacy subscription processor handle these.
          return null;
        }
        if (!isOneTimePgWebhookType(eventType)) {
          // e.g. PAYMENT_CHARGES_WEBHOOK — not an entitlement event.
          return null;
        }

        const eventId = buildPgWebhookEventId(payload);
        const payloadHash = hashWebhookPayload(input.rawBody);
        const now = input.now || new Date();

        const claim = await claimWebhookEvent({
          eventId,
          eventType,
          payloadHash,
          now,
        });
        if (claim === "already_processed") {
          return {
            ok: true as const,
            duplicate: true as const,
            eventId,
            eventType,
          };
        }

        const data = asRecord(payload.data);
        const order = asRecord(data.order);
        const payment = asRecord(data.payment);

        // Documented PG webhook fields (order + payment nested under data).
        const orderId = String(order.order_id || "").trim();
        const paymentId = String(payment.cf_payment_id || "").trim();
        const amountInr = Number(order.order_amount ?? payment.payment_amount ?? 0);
        const currency = String(
          order.order_currency || payment.payment_currency || "INR",
        )
          .trim()
          .toUpperCase();

        const note = String(order.order_note || "");
        const shopMatch = /shop:([0-9a-f-]{36})/i.exec(note);
        const shopIdHint = shopMatch?.[1] || null;

        const paymentStatus = String(payment.payment_status || "").toUpperCase();

        let type: NormalizedBillingEvent["type"] = "IGNORED";
        let status: NormalizedPaymentResult["status"] = "FAILED";

        if (eventType === "PAYMENT_SUCCESS_WEBHOOK") {
          type = "PAYMENT_SUCCEEDED";
          status = "SUCCESS";
        } else if (
          eventType === "PAYMENT_FAILED_WEBHOOK" ||
          eventType === "PAYMENT_USER_DROPPED_WEBHOOK"
        ) {
          type = "PAYMENT_FAILED";
          status = "FAILED";
        }

        // Defense: require SUCCESS payment_status on success webhooks.
        if (
          type === "PAYMENT_SUCCEEDED" &&
          paymentStatus &&
          paymentStatus !== "SUCCESS"
        ) {
          type = "IGNORED";
          status = "FAILED";
        }

        const paymentResult: NormalizedPaymentResult = {
          provider: "cashfree",
          mode: "ONE_TIME",
          status,
          amountInr: Number.isFinite(amountInr) ? amountInr : 0,
          currency,
          providerOrderId: orderId,
          providerPaymentId: paymentId || null,
          shopIdHint,
          paidAt: type === "PAYMENT_SUCCEEDED" ? now : null,
          failureReason:
            type === "PAYMENT_FAILED"
              ? String(payment.payment_message || eventType)
              : null,
          rawEventType: eventType,
        };

        // Do NOT set processedAt here — route marks only after BillingService applies.
        return {
          ok: true as const,
          event: {
            type,
            provider: "cashfree",
            eventId,
            payment: paymentResult,
            occurredAt: now,
          },
        };
      },
    },
  };
}
