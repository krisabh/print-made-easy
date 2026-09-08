/**
 * Regression: browser-facing PayU URLs must never use 0.0.0.0.
 * Bridge redirects follow NEXT_PUBLIC_APP_URL, not request.origin.
 * Run: npx tsx scripts/phase3c-payu-no-zero-host-smoke.ts
 */
import assert from "node:assert/strict";

import {
  getPublicAppBaseUrl,
  toBrowserFacingBaseUrl,
} from "../lib/app-url";
import { toPayUBrowserReturnUrl } from "../lib/billing/payu-adapter";

async function main() {
  assert.equal(
    toBrowserFacingBaseUrl("http://0.0.0.0:3000"),
    "http://localhost:3000",
  );
  assert.equal(
    toBrowserFacingBaseUrl("https://clauras.com"),
    "https://clauras.com",
  );
  assert.equal(
    toBrowserFacingBaseUrl("http://localhost:3000"),
    "http://localhost:3000",
  );

  const fromZero = toPayUBrowserReturnUrl(
    "http://0.0.0.0:3000/dashboard/pricing?payment=return",
    "return",
  );
  assert.equal(
    fromZero,
    "http://localhost:3000/api/billing/payu-return?payment=return",
  );
  assert.equal(fromZero.includes("0.0.0.0"), false);

  const fromProd = toPayUBrowserReturnUrl(
    "https://clauras.com/dashboard/pricing?payment=return",
    "return",
  );
  assert.equal(
    fromProd,
    "https://clauras.com/api/billing/payu-return?payment=return",
  );

  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  const localBase = await getPublicAppBaseUrl();
  assert.equal(localBase, "http://localhost:3000");
  assert.equal(localBase.includes("0.0.0.0"), false);

  process.env.NEXT_PUBLIC_APP_URL = "https://clauras.com";
  const prodBase = await getPublicAppBaseUrl();
  assert.equal(prodBase, "https://clauras.com");

  const { POST } = await import("../app/api/billing/payu-return/route");

  // Local configured URL: bind-host request still redirects to localhost.
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  const localRes = await POST(
    new Request("http://0.0.0.0:3000/api/billing/payu-return?payment=return", {
      method: "POST",
      body: "status=success",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }),
  );
  assert.equal(localRes.status, 303);
  assert.equal(
    localRes.headers.get("location"),
    "http://localhost:3000/dashboard/pricing?payment=return",
  );
  assert.equal((localRes.headers.get("location") || "").includes("0.0.0.0"), false);

  // Production configured URL: internal localhost origin must not leak.
  process.env.NEXT_PUBLIC_APP_URL = "https://clauras.com";
  const prodRes = await POST(
    new Request("http://localhost:3000/api/billing/payu-return?payment=return", {
      method: "POST",
      body: "status=success",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }),
  );
  assert.equal(prodRes.status, 303);
  assert.equal(
    prodRes.headers.get("location"),
    "https://clauras.com/dashboard/pricing?payment=return",
  );
  assert.equal((prodRes.headers.get("location") || "").includes("localhost"), false);
  assert.equal((prodRes.headers.get("location") || "").includes("0.0.0.0"), false);

  console.log(
    "PASS browser-facing PayU callbacks never use 0.0.0.0; bridge follows NEXT_PUBLIC_APP_URL",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
