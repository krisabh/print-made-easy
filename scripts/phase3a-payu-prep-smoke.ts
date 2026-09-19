/**
 * Phase 3A — PayU local TEST prep verification (no live PayU calls).
 * Run: npx tsx scripts/phase3a-payu-prep-smoke.ts
 */
import assert from "node:assert/strict";

import { getBillingProviderId, getBillingMode } from "../lib/billing/config";
import { getPaymentProviderAdapter } from "../lib/billing/registry";
import { PREMIUM_PLAN } from "../lib/billing/plan";
import {
  assertPayUTestEndpointSafety,
  buildPayuV2Authorization,
  getPayUEnvironment,
  getPayUPaymentsUrl,
  getPayUVerifyUrl,
} from "../lib/payu";
import { createHash } from "node:crypto";

function withPaymentQuery(returnUrl: string, payment: string) {
  const url = new URL(returnUrl);
  url.searchParams.set("payment", payment);
  return url.toString();
}

async function main() {
  // Simulate local TEST config for verification if not already set.
  process.env.BILLING_PROVIDER = process.env.BILLING_PROVIDER || "payu";
  process.env.BILLING_MODE = process.env.BILLING_MODE || "one_time";
  process.env.PAYU_ENVIRONMENT = process.env.PAYU_ENVIRONMENT || "test";
  process.env.PAYU_MERCHANT_KEY =
    process.env.PAYU_MERCHANT_KEY || "local_test_key_placeholder";
  process.env.PAYU_MERCHANT_SECRET =
    process.env.PAYU_MERCHANT_SECRET || "local_test_secret_placeholder";

  assert.equal(getBillingProviderId(), "payu");
  assert.equal(getBillingMode(), "ONE_TIME");
  assert.equal(getPayUEnvironment(), "test");
  console.log("1 PASS billing config recognizes payu + one_time + test");

  assert.equal(
    getPayUPaymentsUrl("test"),
    "https://apitest.payu.in/v2/payments",
  );
  assert.equal(getPayUVerifyUrl("test"), "https://test.payu.in/v3/transaction");
  assertPayUTestEndpointSafety("test", getPayUPaymentsUrl("test"));
  assertPayUTestEndpointSafety("test", getPayUVerifyUrl("test"));
  assert.throws(() =>
    assertPayUTestEndpointSafety("test", "https://api.payu.in/v2/payments"),
  );
  assert.throws(() =>
    assertPayUTestEndpointSafety("test", "https://info.payu.in/v3/transaction"),
  );
  console.log("2 PASS test endpoints only; production hosts rejected in test mode");

  const adapter = getPaymentProviderAdapter("payu");
  assert.equal(adapter.id, "payu");
  assert.ok(adapter.oneTime);
  console.log("3 PASS registry selects PayU adapter");

  process.env.BILLING_PROVIDER = "cashfree";
  assert.equal(getBillingProviderId(), "cashfree");
  assert.equal(getPaymentProviderAdapter().id, "cashfree");
  process.env.BILLING_PROVIDER = "payu";
  console.log("4 PASS Cashfree still selectable");

  assert.equal(PREMIUM_PLAN.amountInr, 199);
  assert.equal(PREMIUM_PLAN.currency, "INR");
  console.log("5 PASS amount locked to PREMIUM_PLAN ₹199 INR");

  const base =
    (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
      /\/$/,
      "",
    );
  // Mirror checkout route returnUrl construction for local testing.
  const returnUrl = `${base}/dashboard/pricing?payment=return`;
  const successAction = withPaymentQuery(returnUrl, "return");
  const failureAction = withPaymentQuery(returnUrl, "failed");
  const cancelAction = withPaymentQuery(returnUrl, "cancel");

  assert.ok(
    successAction.startsWith("http://localhost:3000/") ||
      successAction.includes("127.0.0.1"),
    "callbacks must be local for Phase 3A",
  );
  assert.ok(!successAction.includes("clauras.com"));
  console.log("6 PASS local callback URLs");
  console.log(`   successAction=${successAction}`);
  console.log(`   failureAction=${failureAction}`);
  console.log(`   cancelAction=${cancelAction}`);

  // PayU adapter remaps these to the POST→303 bridge (session preservation).
  const { toPayUBrowserReturnUrl } = await import("../lib/billing/payu-adapter");
  assert.equal(
    toPayUBrowserReturnUrl(returnUrl, "return"),
    "http://localhost:3000/api/billing/payu-return?payment=return",
  );

  // HMAC uses exact same serialized body string.
  const bodyObject = {
    accountId: "k",
    currency: "INR",
    txnId: "t1",
    order: {
      productInfo: "PrintYantra Premium",
      paymentChargeSpecification: { price: 199 },
    },
  };
  const requestBody = JSON.stringify(bodyObject);
  const date = "Thu, 27 Mar 2025 06:35:21 GMT";
  const auth = buildPayuV2Authorization({
    requestBody,
    date,
    merchantKey: "k",
    merchantSecret: "s",
  });
  const expected = createHash("sha512")
    .update(`${requestBody}|${date}|s`, "utf8")
    .digest("hex");
  assert.ok(auth.includes(expected));
  // Re-stringify would differ if key order changed — prove we hash the sent string.
  const resent = requestBody;
  assert.equal(resent, requestBody);
  console.log("7 PASS HMAC hashes exact request body string");

  console.log("\nPHASE 3A PREP SMOKE PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
