/**
 * PayU browser-return session preservation + public URL redirect regression.
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

  const { POST, GET } = await import("../app/api/billing/payu-return/route");

  // LOCAL: NEXT_PUBLIC_APP_URL=http://localhost:3000
  // Even if the request arrives on an internal/proxy host, redirect uses configured URL.
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  const postRes = await POST(
    new Request("http://127.0.0.1:3000/api/billing/payu-return?payment=return", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "status=success&txnid=demo&hash=not-trusted",
    }),
  );
  assert.equal(postRes.status, 303);
  assert.equal(
    postRes.headers.get("location"),
    "http://localhost:3000/dashboard/pricing?payment=return",
  );

  const getFailed = await GET(
    new Request("http://0.0.0.0:3000/api/billing/payu-return?payment=failed"),
  );
  assert.equal(getFailed.status, 303);
  assert.equal(
    getFailed.headers.get("location"),
    "http://localhost:3000/dashboard/pricing?payment=failed",
  );

  // PRODUCTION: NEXT_PUBLIC_APP_URL=https://clauras.com
  // Internal localhost request origin must NOT leak into the Location header.
  process.env.NEXT_PUBLIC_APP_URL = "https://clauras.com";
  const prodRes = await POST(
    new Request("http://localhost:3000/api/billing/payu-return?payment=return", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "status=success",
    }),
  );
  assert.equal(prodRes.status, 303);
  assert.equal(
    prodRes.headers.get("location"),
    "https://clauras.com/dashboard/pricing?payment=return",
  );
  assert.equal((prodRes.headers.get("location") || "").includes("localhost"), false);

  const prodCancel = await GET(
    new Request("http://localhost:3000/api/billing/payu-return?payment=cancel"),
  );
  assert.equal(prodCancel.status, 303);
  assert.equal(
    prodCancel.headers.get("location"),
    "https://clauras.com/dashboard/pricing?payment=cancel",
  );

  console.log(
    "PASS PayU return bridge uses NEXT_PUBLIC_APP_URL (local + clauras.com); no session in URL",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
