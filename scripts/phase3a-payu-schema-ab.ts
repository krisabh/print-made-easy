/**
 * A/B probes against PayU TEST create API (safe logging only).
 * Run: npx tsx scripts/phase3a-payu-schema-ab.ts
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  buildPayuV2Authorization,
  buildPayUCreatePaymentFailureDetails,
  getPayUPaymentsUrl,
} from "../lib/payu";

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

async function probe(label: string, mutate: (body: any) => void) {
  const merchantKey = process.env.PAYU_MERCHANT_KEY!.trim();
  const merchantSecret = process.env.PAYU_MERCHANT_SECRET!.trim();
  const txnId = `PMEAB-${label.slice(0, 8)}-${Date.now().toString(36)}${randomBytes(1).toString("hex")}`.slice(
    0,
    45,
  );
  const body: any = {
    accountId: merchantKey,
    currency: "INR",
    txnId,
    order: {
      productInfo: "PrintMadeEasy Premium",
      paymentChargeSpecification: { price: 199 },
      userDefinedFields: { udf1: "ab" },
    },
    billingDetails: {
      firstName: "Diag",
      lastName: "User",
      email: "diag@example.com",
      phone: "9999999999",
      address1: "12 Test Street",
      address2: "",
      city: "",
      state: "",
      country: "",
      zipCode: "",
    },
    callBackActions: {
      successAction: "http://localhost:3000/dashboard/pricing?payment=return",
      failureAction: "http://localhost:3000/dashboard/pricing?payment=failed",
      cancelAction: "http://localhost:3000/dashboard/pricing?payment=cancel",
    },
    additionalInfo: {
      txnS2sFlow: "nonseamless",
    },
  };
  mutate(body);
  const requestBody = JSON.stringify(body);
  const date = new Date().toUTCString();
  const authorization = buildPayuV2Authorization({
    requestBody,
    date,
    merchantKey,
    merchantSecret,
  });
  const url = getPayUPaymentsUrl("test");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      date,
      authorization,
    },
    body: requestBody,
  });
  const rawText = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { message: `non-json:${rawText.slice(0, 80)}` };
  }
  const details = buildPayUCreatePaymentFailureDetails({
    httpStatus: response.status,
    endpointUrl: url,
    txnId,
    payload,
  });
  const hasCheckout =
    typeof (details.resultSummary as any)?.checkoutUrl === "string";
  console.log(
    JSON.stringify({
      label,
      httpStatus: details.httpStatus,
      payuStatus: details.payuStatus,
      hasCheckoutUrl: hasCheckout,
      contentTypeHint: rawText.trimStart().startsWith("<")
        ? "html"
        : rawText.trimStart().startsWith("{")
          ? "json"
          : "other",
      additionalInfo: body.additionalInfo,
      hasAddressField: "address" in body.billingDetails,
      hasAddress1Field: "address1" in body.billingDetails,
      resultSummary: details.resultSummary,
      payuMessage: details.payuMessage,
    }),
  );
}

async function main() {
  loadDotEnv();
  await probe("baseline_txnS2sFlow_address1", () => undefined);
  await probe("only_txnFlow", (b) => {
    b.additionalInfo = { txnFlow: "nonseamless" };
  });
  await probe("txnFlow_and_txnS2sFlow", (b) => {
    b.additionalInfo = {
      txnFlow: "nonseamless",
      txnS2sFlow: "nonseamless",
    };
  });
  await probe("only_address_alias", (b) => {
    b.billingDetails.address = b.billingDetails.address1;
  });
  await probe("txnFlow_plus_address", (b) => {
    b.additionalInfo = {
      txnFlow: "nonseamless",
      txnS2sFlow: "nonseamless",
    };
    b.billingDetails.address = b.billingDetails.address1;
  });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
