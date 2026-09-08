/**
 * PayU browser-return session preservation regression (no live PayU).
 * Run: npx tsx scripts/phase3b-payu-return-session-smoke.ts
 */
import assert from "node:assert/strict";

import { toPayUBrowserReturnUrl } from "../lib/billing/payu-adapter";

async function main() {
  const cashfreeStyleReturn =
    "http://localhost:3000/dashboard/pricing?payment=return";

  const success = toPayUBrowserReturnUrl(cashfreeStyleReturn, "return");
  const failure = toPayUBrowserReturnUrl(cashfreeStyleReturn, "failed");
  const cancel = toPayUBrowserReturnUrl(cashfreeStyleReturn, "cancel");

  assert.equal(
    success,
    "http://localhost:3000/api/billing/payu-return?payment=return",
  );
  assert.equal(
    failure,
    "http://localhost:3000/api/billing/payu-return?payment=failed",
  );
  assert.equal(
    cancel,
    "http://localhost:3000/api/billing/payu-return?payment=cancel",
  );

  // Accidental bind-host must be rewritten for browsers.
  assert.equal(
    toPayUBrowserReturnUrl("http://0.0.0.0:3000/dashboard/pricing", "return"),
    "http://localhost:3000/api/billing/payu-return?payment=return",
  );

  // Must not embed secrets/tokens in the URL.
  for (const url of [success, failure, cancel]) {
    assert.equal(url.includes("pme_session"), false);
    assert.equal(url.toLowerCase().includes("token="), false);
    assert.equal(url.toLowerCase().includes("jwt"), false);
    assert.equal(url.includes("secret"), false);
  }

  // Bridge must 303 to pricing (simulate route handler logic).
  const { POST, GET } = await import("../app/api/billing/payu-return/route");
  const postReq = new Request(
    "http://localhost:3000/api/billing/payu-return?payment=return",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "status=success&txnid=demo&hash=not-trusted",
    },
  );
  const postRes = await POST(postReq);
  assert.equal(postRes.status, 303);
  assert.equal(
    postRes.headers.get("location"),
    "http://localhost:3000/dashboard/pricing?payment=return",
  );

  const getRes = await GET(
    new Request(
      "http://127.0.0.1:3000/api/billing/payu-return?payment=failed",
    ),
  );
  assert.equal(getRes.status, 303);
  assert.equal(
    getRes.headers.get("location"),
    "http://127.0.0.1:3000/dashboard/pricing?payment=failed",
  );

  console.log(
    "PASS authenticated PayU browser return preserves destination (POST→303→pricing) and does not put session in URL",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
