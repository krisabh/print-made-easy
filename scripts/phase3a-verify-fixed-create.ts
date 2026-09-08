/**
 * Verify fixed createPayUHostedPayment against PayU TEST (create only).
 * Run: npx tsx scripts/phase3a-verify-fixed-create.ts
 */
import fs from "node:fs";
import path from "node:path";
import { createPayUHostedPayment } from "../lib/payu";

function loadDotEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadDotEnv();
  const txnId = `PMEFIX-${Date.now().toString(36)}`.slice(0, 45);
  const result = await createPayUHostedPayment({
    txnId,
    amountInr: 199,
    currency: "INR",
    productInfo: "PrintMadeEasy Premium",
    customer: {
      firstName: "Diag",
      lastName: "User",
      email: "diag@example.com",
      phone: "9999999999",
      address1: "12 Test Street",
    },
    udf1: "fixcheck",
    successAction: "http://localhost:3000/dashboard/pricing?payment=return",
    failureAction: "http://localhost:3000/dashboard/pricing?payment=failed",
    cancelAction: "http://localhost:3000/dashboard/pricing?payment=cancel",
  });
  const u = new URL(result.checkoutUrl);
  console.log(
    JSON.stringify({
      status: result.status,
      hasCheckoutUrl: Boolean(result.checkoutUrl),
      checkoutHost: u.host,
      checkoutPath: u.pathname,
      txnId: result.txnId,
    }),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
