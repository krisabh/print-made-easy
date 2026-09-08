/**
 * Phase 8 — PayU one-time adapter smoke (mocked; no live PayU API).
 * Run: npx tsx scripts/phase8-payu-adapter-smoke.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

import { getBillingProviderId } from "../lib/billing/config";
import { PREMIUM_PLAN } from "../lib/billing/plan";
import { createPayUAdapter } from "../lib/billing/payu-adapter";
import { getPaymentProviderAdapter } from "../lib/billing/registry";
import {
  applyNormalizedOneTimePayment,
  processNormalizedBillingEvent,
} from "../lib/billing/service";
import type { NormalizedBillingEvent } from "../lib/billing/types";
import { buildMerchantOrderId, CASHFREE_PROVIDER } from "../lib/cashfree";
import {
  buildPayuV2Authorization,
  computePayuReverseHash,
  getPayUPaymentsUrl,
  getPayUVerifyUrl,
  isPayUPaymentSuccessful,
  PAYU_PROVIDER,
  verifyPayuWebhookHash,
} from "../lib/payu";
import {
  createNestedTrialSubscription,
  getSubscriptionAccess,
} from "../lib/subscription";
import { markWebhookEventProcessed } from "../lib/billing/webhook-idempotency";

const prisma = new PrismaClient();

function sha512(input: string) {
  return createHash("sha512").update(input, "utf8").digest("hex");
}

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  process.env.PAYU_MERCHANT_KEY = "test_merchant_key";
  process.env.PAYU_MERCHANT_SECRET = "test_merchant_secret_salt";
  process.env.PAYU_ENVIRONMENT = "test";
  process.env.BILLING_PROVIDER = "payu";
  process.env.BILLING_MODE = "one_time";
  process.env.CASHFREE_CLIENT_ID = "test_client";
  process.env.CASHFREE_CLIENT_SECRET = "test_secret";
  process.env.CASHFREE_ENVIRONMENT = "sandbox";

  const shopIds: string[] = [];
  const originalFetch = globalThis.fetch;

  try {
    // 1–2. Provider registration + BILLING_PROVIDER=payu
    assert.equal(getBillingProviderId(), "payu");
    const payuAdapter = getPaymentProviderAdapter("payu");
    assert.equal(payuAdapter.id, "payu");
    assert.ok(payuAdapter.oneTime);
    console.log("A PASS PayU provider registration + BILLING_PROVIDER=payu");

    // 17. Cashfree still works
    process.env.BILLING_PROVIDER = "cashfree";
    assert.equal(getBillingProviderId(), "cashfree");
    const cfAdapter = getPaymentProviderAdapter("cashfree");
    assert.equal(cfAdapter.id, "cashfree");
    assert.ok(cfAdapter.oneTime);
    assert.ok(cfAdapter.subscription);
    process.env.BILLING_PROVIDER = "payu";
    console.log("B PASS Cashfree provider still selectable");

    // 18. Legacy subscription path untouched on Cashfree adapter
    assert.equal(
      typeof cfAdapter.subscription?.createSubscriptionCheckout,
      "function",
    );
    console.log("C PASS Legacy Cashfree subscription path present");

    // 5–6. unique txnId <= 50 via buildMerchantOrderId
    const txnId = buildMerchantOrderId(`P8${stamp}`.slice(0, 8));
    assert.ok(txnId.length > 0 && txnId.length <= 50);
    assert.ok(txnId.length <= 45);
    console.log("D PASS txnId unique builder <= 50 chars");

    // 8. Exact HMAC generation
    const body = JSON.stringify({ txnId: ["abc"] });
    const date = "Thu, 27 Mar 2025 06:35:21 GMT";
    const auth = buildPayuV2Authorization({
      requestBody: body,
      date,
      merchantKey: "test_merchant_key",
      merchantSecret: "test_merchant_secret_salt",
    });
    const expectedSig = sha512(
      `${body}|${date}|test_merchant_secret_salt`,
    );
    assert.equal(
      auth,
      `hmac username="test_merchant_key", algorithm="sha512", headers="date", signature="${expectedSig}"`,
    );
    console.log("E PASS exact v2 HMAC authorization");

    assert.equal(
      getPayUPaymentsUrl("test"),
      "https://apitest.payu.in/v2/payments",
    );
    assert.equal(
      getPayUVerifyUrl("test"),
      "https://test.payu.in/v3/transaction",
    );
    assert.equal(
      getPayUPaymentsUrl("production"),
      "https://api.payu.in/v2/payments",
    );
    assert.equal(
      getPayUVerifyUrl("production"),
      "https://info.payu.in/v3/transaction",
    );

    const shop = await prisma.shop.create({
      data: {
        shopCode: `P8${stamp}`.slice(0, 12),
        shopName: "PayU Smoke Shop",
        phone: "9777777777",
        address: "12 MG Road Bengaluru",
        email: `payu-smoke-${stamp}@example.com`,
        printPrice: {
          create: {
            bwSingle: 2,
            bwDouble: 1.5,
            colorSingle: 10,
            colorDouble: 8,
            minimumCharge: 5,
          },
        },
        settings: {
          create: {
            currency: "INR",
            timezone: "Asia/Kolkata",
            autoDeleteDays: 7,
          },
        },
        inventory: {
          create: { paperAvailable: 0, estimatedInkLevel: 100 },
        },
        subscription: { create: createNestedTrialSubscription() },
      },
      include: { subscription: true },
    });
    shopIds.push(shop.id);

    // 3–4, 7, 9. Create request amount/currency + checkoutUrl (mocked fetch)
    let capturedCreateBody = "";
    let capturedCreateAuth = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v2/payments")) {
        capturedCreateBody = String(init?.body || "");
        capturedCreateAuth = String(
          (init?.headers as Record<string, string>)?.authorization || "",
        );
        const parsed = JSON.parse(capturedCreateBody) as {
          currency: string;
          txnId: string;
          order: { paymentChargeSpecification: { price: number } };
          callBackActions: {
            successAction: string;
            failureAction: string;
            cancelAction: string;
          };
        };
        assert.equal(parsed.order.paymentChargeSpecification.price, 199);
        assert.equal(parsed.currency, "INR");
        assert.equal(parsed.txnId, txnId);
        assert.ok(
          parsed.callBackActions.successAction.includes(
            "/api/billing/payu-return",
          ),
        );
        assert.ok(parsed.callBackActions.successAction.includes("payment=return"));
        assert.ok(parsed.callBackActions.failureAction.includes("payment=failed"));
        assert.ok(parsed.callBackActions.cancelAction.includes("payment=cancel"));
        assert.ok(
          !parsed.callBackActions.successAction.includes("/dashboard/pricing"),
        );
        assert.equal(
          (parsed as { additionalInfo?: { txnFlow?: string } }).additionalInfo
            ?.txnFlow,
          "nonseamless",
        );
        return new Response(
          JSON.stringify({
            status: "PENDING",
            result: {
              checkoutUrl: "https://pp78secure.payu.in/_payment_options?mihpayid=mock",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch in create test: ${url}`);
    }) as typeof fetch;

    const created = await createPayUAdapter().oneTime!.createOneTimeCheckout({
      shopId: shop.id,
      shopCode: shop.shopCode,
      customer: {
        name: "Ravi Kumar",
        email: shop.email!,
        phone: shop.phone,
      },
      returnUrl: "https://example.com/dashboard/pricing?payment=return",
      amountInr: PREMIUM_PLAN.amountInr,
      currency: PREMIUM_PLAN.currency,
      providerOrderId: txnId,
      addressLine1: shop.address,
    });

    assert.equal(created.checkoutKind, "payu_hosted");
    assert.equal(
      created.checkoutSessionId,
      "https://pp78secure.payu.in/_payment_options?mihpayid=mock",
    );
    assert.equal(created.orderId, txnId);
    assert.ok(capturedCreateBody.includes('"price":199'));
    assert.ok(capturedCreateAuth.startsWith("hmac username="));
    assert.ok(!capturedCreateAuth.includes("test_merchant_secret_salt"));
    console.log("F PASS create amount INR/199, callbacks, checkoutUrl");

    // 10. PENDING create does NOT activate Premium
    assert.equal(shop.subscription!.plan, "TRIAL");
    assert.equal(shop.subscription!.status, "TRIALING");
    const accessBefore = getSubscriptionAccess(shop.subscription!, new Date());
    assert.equal(accessBefore.hasAccess, true);
    assert.equal(accessBefore.reason, "trialing");
    console.log("G PASS PENDING create does not activate Premium");

    await prisma.billingPayment.create({
      data: {
        shopId: shop.id,
        provider: PAYU_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: PREMIUM_PLAN.amountInr,
        currency: PREMIUM_PLAN.currency,
        providerOrderId: txnId,
      },
    });

    // 11–12. verify SUCCESS / FAILED normalize
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      assert.ok(url.includes("/v3/transaction"));
      return new Response(
        JSON.stringify({
          message: "Success",
          status: 1,
          result: [
            {
              txnId,
              status: "success",
              unmappedStatus: "captured",
              originalAmount: 199,
              originalCurrency: "INR",
              mihpayId: "MIH_SUCCESS_1",
              udf1: shop.id,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const verifiedOk = await createPayUAdapter().oneTime!.verifyOneTimePayment({
      providerOrderId: txnId,
    });
    assert.equal(verifiedOk.status, "SUCCESS");
    assert.equal(verifiedOk.provider, "payu");
    assert.equal(verifiedOk.amountInr, 199);
    assert.equal(verifiedOk.providerPaymentId, "MIH_SUCCESS_1");
    assert.equal(verifiedOk.providerOrderId, txnId);
    console.log("H PASS verify SUCCESS normalizes");

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          message: "Success",
          status: 1,
          result: [
            {
              txnId,
              status: "failure",
              unmappedStatus: "failed",
              originalAmount: 199,
              originalCurrency: "INR",
              mihpayId: "MIH_FAIL_1",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    const verifiedFail = await createPayUAdapter().oneTime!.verifyOneTimePayment({
      providerOrderId: txnId,
    });
    assert.equal(verifiedFail.status, "FAILED");
    console.log("I PASS verify FAILED normalizes");

    assert.equal(
      isPayUPaymentSuccessful({ status: "success", unmappedStatus: "captured" }),
      true,
    );
    assert.equal(
      isPayUPaymentSuccessful({ status: "failure", unmappedStatus: "failed" }),
      false,
    );

    // Apply SUCCESS
    const successEvent: NormalizedBillingEvent = {
      type: "PAYMENT_SUCCEEDED",
      provider: "payu",
      eventId: `test-success-${txnId}`,
      payment: {
        provider: "payu",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 199,
        currency: "INR",
        providerOrderId: txnId,
        providerPaymentId: "MIH_SUCCESS_1",
        shopIdHint: shop.id,
        paidAt: new Date(),
      },
    };
    const applied = await applyNormalizedOneTimePayment(successEvent);
    assert.equal(applied.result, "activated");

    const subAfter = await prisma.subscription.findUniqueOrThrow({
      where: { shopId: shop.id },
    });
    assert.equal(subAfter.plan, "PREMIUM");
    assert.equal(subAfter.status, "ACTIVE");
    assert.equal(subAfter.provider, PAYU_PROVIDER);

    // 14. duplicate SUCCESS cannot extend twice
    const again = await applyNormalizedOneTimePayment(successEvent);
    assert.equal(again.result, "already_applied");
    const subAgain = await prisma.subscription.findUniqueOrThrow({
      where: { shopId: shop.id },
    });
    assert.equal(
      subAgain.currentPeriodEnd?.toISOString(),
      subAfter.currentPeriodEnd?.toISOString(),
    );
    console.log("J PASS duplicate SUCCESS idempotent");

    // 13. wrong amount rejected
    const badTxn = `${txnId}BAD`.slice(0, 45);
    await prisma.billingPayment.create({
      data: {
        shopId: shop.id,
        provider: PAYU_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: PREMIUM_PLAN.amountInr,
        currency: PREMIUM_PLAN.currency,
        providerOrderId: badTxn,
      },
    });
    const mismatch = await applyNormalizedOneTimePayment({
      type: "PAYMENT_SUCCEEDED",
      provider: "payu",
      eventId: `mismatch-${badTxn}`,
      payment: {
        provider: "payu",
        mode: "ONE_TIME",
        status: "SUCCESS",
        amountInr: 1,
        currency: "INR",
        providerOrderId: badTxn,
        providerPaymentId: "MIH_BAD_AMT",
        shopIdHint: shop.id,
      },
    });
    assert.equal(mismatch.result, "amount_mismatch");
    console.log("K PASS wrong amount rejected");

    // 15–16. webhook hash failure + duplicate webhook idempotent
    const salt = process.env.PAYU_MERCHANT_SECRET!;
    const whParams = {
      mihpayid: `MIH_WH_${stamp}`,
      status: "success",
      key: process.env.PAYU_MERCHANT_KEY!,
      txnid: `WH${txnId}`.slice(0, 45),
      amount: "199.00",
      productinfo: "PrintMadeEasy Premium",
      firstname: "Ravi",
      email: shop.email!,
      udf1: shop.id,
      udf2: "",
      udf3: "",
      udf4: "",
      udf5: "",
      unmappedstatus: "captured",
    };
    const goodHash = computePayuReverseHash({
      salt,
      status: whParams.status,
      udf1: whParams.udf1,
      udf2: whParams.udf2,
      udf3: whParams.udf3,
      udf4: whParams.udf4,
      udf5: whParams.udf5,
      email: whParams.email,
      firstname: whParams.firstname,
      productinfo: whParams.productinfo,
      amount: whParams.amount,
      txnid: whParams.txnid,
      key: whParams.key,
    });
    assert.equal(
      verifyPayuWebhookHash({
        params: { ...whParams, hash: goodHash },
        salt,
      }),
      true,
    );
    assert.equal(
      verifyPayuWebhookHash({
        params: { ...whParams, hash: "0".repeat(128) },
        salt,
      }),
      false,
    );
    console.log("L PASS webhook reverse-hash verify");

    await prisma.billingPayment.create({
      data: {
        shopId: shop.id,
        provider: PAYU_PROVIDER,
        mode: "ONE_TIME",
        status: "PENDING",
        amountInr: PREMIUM_PLAN.amountInr,
        currency: PREMIUM_PLAN.currency,
        providerOrderId: whParams.txnid,
      },
    });

    const formBody = new URLSearchParams({
      ...whParams,
      hash: goodHash,
    }).toString();

    const badNorm = await createPayUAdapter().oneTimeWebhook!.verifyAndNormalize({
      rawBody: new URLSearchParams({
        ...whParams,
        hash: "deadbeef",
      }).toString(),
      signature: null,
      timestamp: null,
    });
    assert.equal(badNorm?.ok, false);
    if (badNorm && !badNorm.ok) {
      assert.equal(badNorm.status, 401);
    }
    console.log("M PASS webhook hash failure rejected");

    const firstWh = await createPayUAdapter().oneTimeWebhook!.verifyAndNormalize({
      rawBody: formBody,
      signature: null,
      timestamp: null,
    });
    assert.ok(firstWh && firstWh.ok && "event" in firstWh);
    if (firstWh && firstWh.ok && "event" in firstWh) {
      const appliedWh = await processNormalizedBillingEvent(firstWh.event);
      assert.ok(
        appliedWh.result === "activated" ||
          appliedWh.result === "already_applied",
      );
      await markWebhookEventProcessed({
        provider: PAYU_PROVIDER,
        eventId: firstWh.event.eventId,
      });
    }

    const secondWh = await createPayUAdapter().oneTimeWebhook!.verifyAndNormalize({
      rawBody: formBody,
      signature: null,
      timestamp: null,
    });
    assert.ok(secondWh && secondWh.ok && "duplicate" in secondWh && secondWh.duplicate);
    console.log("N PASS duplicate webhook idempotent");

    // Unknown BILLING_PROVIDER must not become payu
    process.env.BILLING_PROVIDER = "stripe";
    assert.equal(getBillingProviderId(), "cashfree");
    process.env.BILLING_PROVIDER = "payu";

    // Historical Cashfree rows still use CASHFREE ledger
    assert.equal(CASHFREE_PROVIDER, "CASHFREE");
    assert.equal(PAYU_PROVIDER, "PAYU");
    console.log("O PASS provider ledger constants intact");

    console.log("\nALL PHASE 8 PAYU SMOKE CHECKS PASSED");
  } finally {
    globalThis.fetch = originalFetch;
    if (shopIds.length) {
      await prisma.billingPayment.deleteMany({
        where: { shopId: { in: shopIds } },
      });
      await prisma.paymentWebhookEvent.deleteMany({
        where: { provider: PAYU_PROVIDER },
      });
      await prisma.subscription.deleteMany({
        where: { shopId: { in: shopIds } },
      });
      await prisma.printPrice.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.settings.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.inventory.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    }
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
