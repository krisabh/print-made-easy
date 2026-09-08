/**
 * Diagnostic: call PayU TEST create-payment once and print SAFE response fields.
 * Does not complete a customer payment. Does not print secrets/HMAC.
 *
 * Run: npx tsx scripts/phase3a-diagnose-payu-create.ts
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  assertPayUTestEndpointSafety,
  buildPayuV2Authorization,
  buildPayUCreatePaymentFailureDetails,
  getPayUEnvironment,
  getPayUPaymentsUrl,
} from "../lib/payu";

function loadDotEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
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
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function present(name: string, secret = false) {
  const v = (process.env[name] || "").trim();
  if (!v) return `${name}=MISSING`;
  return secret ? `${name}=SET_LEN=${v.length}` : `${name}=${v}`;
}

async function main() {
  loadDotEnv();

  console.log("--- env ---");
  console.log(present("BILLING_PROVIDER"));
  console.log(present("BILLING_MODE"));
  console.log(present("PAYU_ENVIRONMENT"));
  console.log(present("PAYU_MERCHANT_KEY", true));
  console.log(present("PAYU_MERCHANT_SECRET", true));
  console.log(`resolvedPayUEnvironment=${getPayUEnvironment()}`);

  const merchantKey = (process.env.PAYU_MERCHANT_KEY || "").trim();
  const merchantSecret = (process.env.PAYU_MERCHANT_SECRET || "").trim();
  if (!merchantKey || !merchantSecret) {
    throw new Error("PayU TEST credentials missing in .env");
  }

  const txnId = `PMEDIAG-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`.slice(
    0,
    45,
  );
  const bodyObject = {
    accountId: merchantKey,
    currency: "INR",
    txnId,
    order: {
      productInfo: "PrintMadeEasy Premium",
      paymentChargeSpecification: {
        price: 199,
      },
      userDefinedFields: {
        udf1: "diagnose",
      },
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

  const requestBody = JSON.stringify(bodyObject);
  const date = new Date().toUTCString();
  const authorization = buildPayuV2Authorization({
    requestBody,
    date,
    merchantKey,
    merchantSecret,
  });

  const url = getPayUPaymentsUrl("test");
  assertPayUTestEndpointSafety("test", url);

  console.log("--- request (safe) ---");
  console.log(`endpoint=${url}`);
  console.log(`txnId=${txnId}`);
  console.log(
    `bodyKeys=${Object.keys(bodyObject).join(",")}`,
  );
  console.log(
    `billingDetailKeys=${Object.keys(bodyObject.billingDetails).join(",")}`,
  );
  console.log(
    `additionalInfoKeys=${Object.keys(bodyObject.additionalInfo).join(",")}`,
  );
  console.log(`amount=${bodyObject.order.paymentChargeSpecification.price}`);
  console.log(`authHeaderPresent=${Boolean(authorization)}`);
  console.log(`authStartsWithHmac=${authorization.toLowerCase().startsWith("hmac ")}`);
  // Prove HMAC used exact body string without printing signature.
  console.log(`requestBodyBytes=${Buffer.byteLength(requestBody, "utf8")}`);

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
    payload = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    payload = { message: `non-json:${rawText.slice(0, 200)}` };
  }

  const details = buildPayUCreatePaymentFailureDetails({
    httpStatus: response.status,
    endpointUrl: url,
    txnId,
    payload,
  });

  console.log("--- response (safe) ---");
  console.log(JSON.stringify(details, null, 2));
  console.log(`rawBodyPreview=${rawText.slice(0, 500)}`);

  // Second probe: docs sample uses txnFlow + address (not only txnS2sFlow/address1)
  const altBody = {
    ...bodyObject,
    txnId: `${txnId}A`.slice(0, 45),
    billingDetails: {
      ...bodyObject.billingDetails,
      address: bodyObject.billingDetails.address1,
    },
    additionalInfo: {
      txnFlow: "nonseamless",
      txnS2sFlow: "nonseamless",
    },
  };
  const altRequestBody = JSON.stringify(altBody);
  const altDate = new Date().toUTCString();
  const altAuth = buildPayuV2Authorization({
    requestBody: altRequestBody,
    date: altDate,
    merchantKey,
    merchantSecret,
  });
  const altRes = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      date: altDate,
      authorization: altAuth,
    },
    body: altRequestBody,
  });
  const altText = await altRes.text();
  let altPayload: Record<string, unknown> = {};
  try {
    altPayload = altText ? (JSON.parse(altText) as Record<string, unknown>) : {};
  } catch {
    altPayload = { message: `non-json:${altText.slice(0, 200)}` };
  }
  const altDetails = buildPayUCreatePaymentFailureDetails({
    httpStatus: altRes.status,
    endpointUrl: url,
    txnId: altBody.txnId,
    payload: altPayload,
  });
  console.log("--- alternate schema probe (txnFlow + address) ---");
  console.log(JSON.stringify(altDetails, null, 2));
  console.log(`altRawBodyPreview=${altText.slice(0, 500)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
