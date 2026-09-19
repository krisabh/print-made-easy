import { createHash } from "crypto";

import { toBrowserFacingBaseUrl } from "@/lib/app-url";
import type { PaymentProviderAdapter } from "@/lib/billing/provider";
import type {
  NormalizedBillingEvent,
  NormalizedPaymentResult,
} from "@/lib/billing/types";
import { claimWebhookEvent } from "@/lib/billing/webhook-idempotency";
import {
  createPayUHostedPayment,
  getPayUConfig,
  getPayUJsMode,
  hashPayuWebhookPayload,
  isPayUPaymentSuccessful,
  parsePayuFormBody,
  splitBillingName,
  verifyPayuWebhookHash,
  verifyPayUPayment,
} from "@/lib/payu";

function withPaymentQuery(returnUrl: string, payment: string) {
  try {
    const url = new URL(returnUrl);
    url.searchParams.set("payment", payment);
    return url.toString();
  } catch {
    const join = returnUrl.includes("?") ? "&" : "?";
    return `${returnUrl}${join}payment=${encodeURIComponent(payment)}`;
  }
}

/**
 * PayU posts cross-site to callBackActions. Point those URLs at the
 * same-origin bridge that 303s to /dashboard/pricing?payment=… so the
 * Lax session cookie is present on the final pricing GET (Cashfree-like UX).
 */
export function toPayUBrowserReturnUrl(returnUrl: string, payment: string) {
  try {
    const normalized = toBrowserFacingBaseUrl(returnUrl);
    const url = new URL(normalized);
    url.pathname = "/api/billing/payu-return";
    url.search = "";
    url.hash = "";
    url.searchParams.set("payment", payment);
    return url.toString();
  } catch {
    return withPaymentQuery("/api/billing/payu-return", payment);
  }
}

function normalizeVerifyResult(
  verified: Awaited<ReturnType<typeof verifyPayUPayment>>,
): NormalizedPaymentResult {
  const success = isPayUPaymentSuccessful({
    status: verified.status,
    unmappedStatus: verified.unmappedStatus,
  });

  return {
    provider: "payu",
    mode: "ONE_TIME",
    status: success ? "SUCCESS" : "FAILED",
    amountInr: verified.amountInr,
    currency: verified.currency || "INR",
    providerOrderId: verified.txnId,
    providerPaymentId: verified.mihpayId,
    shopIdHint: verified.udf1 || null,
    paidAt: success ? new Date() : null,
    failureReason: success
      ? null
      : `PayU status: ${verified.status}${
          verified.unmappedStatus ? ` (${verified.unmappedStatus})` : ""
        }`,
  };
}

function buildWebhookEventId(params: Record<string, string>) {
  const mihpayid = (params.mihpayid || params.mihpayId || "").trim();
  if (mihpayid) return mihpayid;
  const txnid = (params.txnid || "").trim();
  const status = (params.status || "").trim().toLowerCase() || "unknown";
  if (txnid) return `${txnid}:${status}`;
  return createHash("sha256")
    .update(JSON.stringify(params), "utf8")
    .digest("hex")
    .slice(0, 40);
}

export function createPayUAdapter(): PaymentProviderAdapter {
  return {
    id: "payu",
    oneTime: {
      async createOneTimeCheckout(input) {
        const address1 = (input.addressLine1 || "").trim();
        if (!address1) {
          throw new Error(
            "Shop address is required for PayU checkout (billingDetails.address1).",
          );
        }

        const { firstName, lastName } = splitBillingName(input.customer.name);
        const created = await createPayUHostedPayment({
          txnId: input.providerOrderId,
          amountInr: input.amountInr,
          currency: input.currency,
          productInfo: "PrintYantra Premium",
          customer: {
            firstName,
            lastName,
            email: input.customer.email,
            phone: input.customer.phone,
            address1,
          },
          udf1: input.shopId,
          successAction: toPayUBrowserReturnUrl(input.returnUrl, "return"),
          failureAction: toPayUBrowserReturnUrl(input.returnUrl, "failed"),
          cancelAction: toPayUBrowserReturnUrl(input.returnUrl, "cancel"),
        });

        // PENDING create responses only yield a checkout URL — never success.
        return {
          provider: "payu",
          mode: "ONE_TIME",
          checkoutKind: "payu_hosted",
          checkoutSessionId: created.checkoutUrl,
          orderId: created.txnId,
          environment: getPayUJsMode(),
        };
      },
      async verifyOneTimePayment(input) {
        const verified = await verifyPayUPayment({
          txnId: input.providerOrderId,
        });
        return normalizeVerifyResult(verified);
      },
    },
    oneTimeWebhook: {
      async verifyAndNormalize(input) {
        const params = parsePayuFormBody(input.rawBody);
        const status = (params.status || "").trim().toLowerCase();

        // Phase scope: Successful / Failed payment events only.
        if (status !== "success" && status !== "failure" && status !== "failed") {
          return {
            ok: true,
            event: {
              type: "IGNORED",
              provider: "payu",
              eventId: buildWebhookEventId(params),
              occurredAt: input.now || new Date(),
            } satisfies NormalizedBillingEvent,
          };
        }

        let config;
        try {
          config = getPayUConfig();
        } catch {
          return { ok: false, status: 500 as const, error: "PayU is not configured." };
        }

        if (
          !verifyPayuWebhookHash({
            params,
            salt: config.merchantSecret,
          })
        ) {
          return {
            ok: false,
            status: 401 as const,
            error: "Invalid PayU webhook hash.",
          };
        }

        const eventId = buildWebhookEventId(params);
        const eventType =
          status === "success" ? "Successful" : "Failed";
        const claim = await claimWebhookEvent({
          provider: "PAYU",
          eventId,
          eventType,
          payloadHash: hashPayuWebhookPayload(input.rawBody),
          now: input.now,
        });

        if (claim === "already_processed") {
          return {
            ok: true,
            duplicate: true,
            eventId,
            eventType,
          };
        }

        const amountRaw = Number(params.amount);
        const amountInr = Number.isFinite(amountRaw) ? amountRaw : 0;
        const success = isPayUPaymentSuccessful({
          status: params.status || "",
          unmappedStatus: params.unmappedstatus || params.unmappedStatus,
        });

        const payment: NormalizedPaymentResult = {
          provider: "payu",
          mode: "ONE_TIME",
          status: success ? "SUCCESS" : "FAILED",
          amountInr,
          currency: "INR",
          providerOrderId: (params.txnid || "").trim(),
          providerPaymentId: (params.mihpayid || params.mihpayId || "").trim() || null,
          shopIdHint: (params.udf1 || "").trim() || null,
          paidAt: success ? input.now || new Date() : null,
          failureReason: success
            ? null
            : (params.error_Message || params.error || "Payment failed").slice(
                0,
                500,
              ),
          rawEventType: eventType,
        };

        return {
          ok: true,
          event: {
            type: success ? "PAYMENT_SUCCEEDED" : "PAYMENT_FAILED",
            provider: "payu",
            eventId,
            payment,
            occurredAt: input.now || new Date(),
          } satisfies NormalizedBillingEvent,
        };
      },
    },
  };
}
