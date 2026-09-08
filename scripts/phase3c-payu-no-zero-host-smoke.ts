/**
 * Regression: browser-facing PayU URLs must never use 0.0.0.0.
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

  // Bridge must rewrite 0.0.0.0 origin on 303.
  const { POST } = await import("../app/api/billing/payu-return/route");
  const res = await POST(
    new Request("http://0.0.0.0:3000/api/billing/payu-return?payment=return", {
      method: "POST",
      body: "status=success",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }),
  );
  assert.equal(res.status, 303);
  assert.equal(
    res.headers.get("location"),
    "http://localhost:3000/dashboard/pricing?payment=return",
  );
  assert.equal((res.headers.get("location") || "").includes("0.0.0.0"), false);

  console.log(
    "PASS browser-facing PayU callbacks never use 0.0.0.0; prod keeps clauras.com",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
