import { createHash } from "crypto";

export const PAYU_PROVIDER = "PAYU";

export type PayUEnvironment = "test" | "production";

export type PayUClientConfig = {
  merchantKey: string;
  merchantSecret: string;
  environment: PayUEnvironment;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** Safe PayU create-payment failure details for logs / client (no secrets). */
export type PayUCreatePaymentFailureDetails = {
  httpStatus: number;
  endpointHost: string;
  endpointPath: string;
  txnId: string;
  payuStatus: string | null;
  payuMessage: string | null;
  payuErrorCode: string | null;
  resultSummary: unknown;
};

function pickSafeString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function summarizePayUResultForDiagnostics(result: unknown): unknown {
  if (result == null) return null;
  if (typeof result === "string") {
    return result.slice(0, 300);
  }
  if (Array.isArray(result)) {
    return result.slice(0, 5).map((item) => summarizePayUResultForDiagnostics(item));
  }
  if (typeof result !== "object") return String(result);

  const row = result as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const allow = [
    "checkoutUrl",
    "checkoutURL",
    "message",
    "error",
    "error_code",
    "errorCode",
    "error_Message",
    "errorMessage",
    "status",
    "txnId",
    "txnid",
    "orderId",
    "mihpayId",
    "mihpayid",
  ];
  for (const key of allow) {
    if (!(key in row)) continue;
    const value = row[key];
    if (typeof value === "string") {
      // Never log full checkout URLs with tokens in failure paths beyond host/path.
      if (/checkouturl/i.test(key) && value.startsWith("http")) {
        try {
          const u = new URL(value);
          out[key] = `${u.origin}${u.pathname}`;
        } catch {
          out[key] = "[url]";
        }
      } else {
        out[key] = value.slice(0, 300);
      }
    } else if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value == null
    ) {
      out[key] = value;
    }
  }
  return out;
}

export function buildPayUCreatePaymentFailureDetails(input: {
  httpStatus: number;
  endpointUrl: string;
  txnId: string;
  payload: Record<string, unknown>;
}): PayUCreatePaymentFailureDetails {
  let endpointHost = "";
  let endpointPath = "";
  try {
    const u = new URL(input.endpointUrl);
    endpointHost = u.host;
    endpointPath = u.pathname;
  } catch {
    endpointHost = "unknown";
    endpointPath = input.endpointUrl;
  }

  const result = input.payload.result;
  return {
    httpStatus: input.httpStatus,
    endpointHost,
    endpointPath,
    txnId: input.txnId,
    payuStatus: pickSafeString(input.payload.status),
    payuMessage:
      pickSafeString(input.payload.message) ||
      pickSafeString(asRecord(result).message) ||
      pickSafeString(input.payload.error) ||
      null,
    payuErrorCode:
      pickSafeString(input.payload.error_code) ||
      pickSafeString(input.payload.errorCode) ||
      pickSafeString(asRecord(result).error_code) ||
      pickSafeString(asRecord(result).errorCode) ||
      null,
    resultSummary: summarizePayUResultForDiagnostics(result),
  };
}

export function formatPayUCreatePaymentClientError(
  details: PayUCreatePaymentFailureDetails,
): string {
  const parts = [
    details.payuMessage,
    details.payuErrorCode ? `code=${details.payuErrorCode}` : null,
    details.payuStatus != null ? `status=${details.payuStatus}` : null,
    `http=${details.httpStatus}`,
  ].filter(Boolean);
  return `PayU payment creation failed: ${parts.join(" | ")}`;
}

function logPayUCreatePaymentFailure(details: PayUCreatePaymentFailureDetails) {
  // Safe diagnostics only — never log secrets, HMAC, or authorization.
  console.error("[payu:create-payment]", {
    httpStatus: details.httpStatus,
    payuStatus: details.payuStatus,
    payuMessage: details.payuMessage,
    payuErrorCode: details.payuErrorCode,
    result: details.resultSummary,
    txnId: details.txnId,
    endpointHost: details.endpointHost,
    endpointPath: details.endpointPath,
  });
}

export function getPayUEnvironment(): PayUEnvironment {
  const raw = (process.env.PAYU_ENVIRONMENT || "test").trim().toLowerCase();
  return raw === "production" ? "production" : "test";
}

export function getPayUConfig(): PayUClientConfig {
  const merchantKey = (process.env.PAYU_MERCHANT_KEY || "").trim();
  const merchantSecret = (process.env.PAYU_MERCHANT_SECRET || "").trim();
  if (!merchantKey || !merchantSecret) {
    throw new Error(
      "PayU is not configured. Set PAYU_MERCHANT_KEY and PAYU_MERCHANT_SECRET.",
    );
  }
  return {
    merchantKey,
    merchantSecret,
    environment: getPayUEnvironment(),
  };
}

export function getPayUPaymentsUrl(environment?: PayUEnvironment) {
  const env = environment || getPayUEnvironment();
  return env === "production"
    ? "https://api.payu.in/v2/payments"
    : "https://apitest.payu.in/v2/payments";
}

export function getPayUVerifyUrl(environment?: PayUEnvironment) {
  const env = environment || getPayUEnvironment();
  return env === "production"
    ? "https://info.payu.in/v3/transaction"
    : "https://test.payu.in/v3/transaction";
}

/**
 * Development-time safety: PAYU_ENVIRONMENT=test must never hit production hosts.
 * Does not log credentials or authorization material.
 */
export function assertPayUTestEndpointSafety(
  environment: PayUEnvironment,
  url: string,
) {
  if (environment !== "test") return;
  const lower = url.toLowerCase();
  if (lower.includes("apitest.payu.in") || lower.includes("test.payu.in")) {
    return;
  }
  if (
    lower.includes("://api.payu.in") ||
    lower.includes("://info.payu.in")
  ) {
    throw new Error(
      "PayU test mode refused a production endpoint. Set PAYU_ENVIRONMENT=test and use test hosts only.",
    );
  }
  throw new Error(`PayU test mode refused unexpected endpoint host: ${url}`);
}

export function getPayUJsMode(
  environment?: PayUEnvironment,
): "sandbox" | "production" {
  const env = environment || getPayUEnvironment();
  return env === "production" ? "production" : "sandbox";
}

/**
 * PayU v2 API HMAC authorization.
 * Hash: SHA512(exactRequestBody + "|" + date + "|" + merchantSecret)
 * Must hash the exact JSON string sent over HTTP — do not re-stringify.
 */
export function buildPayuV2Authorization(input: {
  requestBody: string;
  date: string;
  merchantKey: string;
  merchantSecret: string;
}): string {
  const hashString = `${input.requestBody}|${input.date}|${input.merchantSecret}`;
  const signature = createHash("sha512").update(hashString, "utf8").digest("hex");
  return `hmac username="${input.merchantKey}", algorithm="sha512", headers="date", signature="${signature}"`;
}

/**
 * PayU payment response / webhook reverse hash (documented hashing).
 * sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
 *
 * The six pipes after status are five empty placeholder fields (udf10…udf6),
 * then udf5…udf1 — not six empties.
 * With additional charges:
 * sha512(additional_charges|SALT|status||||||udf5|...)
 */
export function buildPayuReverseHashString(input: {
  salt: string;
  status: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  email?: string;
  firstname?: string;
  productinfo?: string;
  amount?: string;
  txnid?: string;
  key?: string;
  additionalCharges?: string;
}): string {
  const parts = [
    input.salt,
    input.status,
    // Five empty placeholders between status and udf5 (docs: status||||||udf5).
    "",
    "",
    "",
    "",
    "",
    input.udf5 ?? "",
    input.udf4 ?? "",
    input.udf3 ?? "",
    input.udf2 ?? "",
    input.udf1 ?? "",
    input.email ?? "",
    input.firstname ?? "",
    input.productinfo ?? "",
    input.amount ?? "",
    input.txnid ?? "",
    input.key ?? "",
  ];
  const core = parts.join("|");
  const extra = (input.additionalCharges || "").trim();
  return extra ? `${extra}|${core}` : core;
}

export function computePayuReverseHash(input: {
  salt: string;
  status: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  email?: string;
  firstname?: string;
  productinfo?: string;
  amount?: string;
  txnid?: string;
  key?: string;
  additionalCharges?: string;
}): string {
  const hashString = buildPayuReverseHashString(input);
  return createHash("sha512").update(hashString, "utf8").digest("hex");
}

export function verifyPayuWebhookHash(input: {
  params: Record<string, string>;
  salt: string;
}): boolean {
  const received = (input.params.hash || "").trim().toLowerCase();
  if (!received) return false;

  const additionalCharges =
    input.params.additional_charges ||
    input.params.additionalCharges ||
    "";

  const expected = computePayuReverseHash({
    salt: input.salt,
    status: input.params.status || "",
    udf1: input.params.udf1,
    udf2: input.params.udf2,
    udf3: input.params.udf3,
    udf4: input.params.udf4,
    udf5: input.params.udf5,
    email: input.params.email,
    firstname: input.params.firstname,
    productinfo: input.params.productinfo,
    amount: input.params.amount,
    txnid: input.params.txnid,
    key: input.params.key,
    additionalCharges,
  }).toLowerCase();

  if (expected.length !== received.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return mismatch === 0;
}

export function parsePayuFormBody(rawBody: string): Record<string, string> {
  const params = new URLSearchParams(rawBody);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}

export function hashPayuWebhookPayload(rawBody: string) {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

export function splitBillingName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return { firstName: "Shopkeeper", lastName: "" };
  }
  const space = trimmed.indexOf(" ");
  if (space === -1) {
    return { firstName: trimmed.slice(0, 60), lastName: "" };
  }
  return {
    firstName: trimmed.slice(0, space).slice(0, 60),
    lastName: trimmed.slice(space + 1).slice(0, 60),
  };
}

export type PayUCreatePaymentResult = {
  txnId: string;
  checkoutUrl: string;
  status: string;
};

export async function createPayUHostedPayment(input: {
  config?: PayUClientConfig;
  txnId: string;
  amountInr: number;
  currency: string;
  productInfo: string;
  customer: {
    firstName: string;
    lastName?: string;
    email: string;
    phone: string;
    address1: string;
    address2?: string;
    city?: string;
    state?: string;
    country?: string;
    zipCode?: string;
  };
  udf1?: string;
  successAction: string;
  failureAction: string;
  cancelAction: string;
}): Promise<PayUCreatePaymentResult> {
  const config = input.config || getPayUConfig();
  if (
    !Number.isInteger(input.amountInr) ||
    input.amountInr < 1 ||
    input.amountInr > 100_000
  ) {
    throw new Error("PayU checkout amount is invalid.");
  }
  if (input.currency.toUpperCase() !== "INR") {
    throw new Error("PayU checkout currency must be INR.");
  }
  if (!input.txnId || input.txnId.length > 50) {
    throw new Error("PayU txnId must be 1–50 characters.");
  }
  if (!input.customer.address1.trim()) {
    throw new Error("PayU billing address1 is required.");
  }

  const bodyObject: Record<string, unknown> = {
    accountId: config.merchantKey,
    currency: "INR",
    txnId: input.txnId,
    order: {
      productInfo: input.productInfo,
      paymentChargeSpecification: {
        price: input.amountInr,
      },
      userDefinedFields: {
        udf1: input.udf1 || "",
      },
    },
    billingDetails: {
      firstName: input.customer.firstName,
      lastName: input.customer.lastName || "",
      email: input.customer.email,
      phone: input.customer.phone,
      address1: input.customer.address1,
      address2: input.customer.address2 || "",
      city: input.customer.city || "",
      state: input.customer.state || "",
      country: input.customer.country || "",
      zipCode: input.customer.zipCode || "",
    },
    callBackActions: {
      successAction: input.successAction,
      failureAction: input.failureAction,
      cancelAction: input.cancelAction,
    },
    additionalInfo: {
      // Hosted Checkout requires txnFlow=nonseamless (verified against apitest).
      // txnS2sFlow alone returns an HTML page without result.checkoutUrl.
      txnFlow: "nonseamless",
      txnS2sFlow: "nonseamless",
    },
  };

  // HMAC must use this exact string — same value sent as the HTTP body.
  const requestBody = JSON.stringify(bodyObject);
  const date = new Date().toUTCString();
  const authorization = buildPayuV2Authorization({
    requestBody,
    date,
    merchantKey: config.merchantKey,
    merchantSecret: config.merchantSecret,
  });

  const paymentsUrl = getPayUPaymentsUrl(config.environment);
  assertPayUTestEndpointSafety(config.environment, paymentsUrl);

  const response = await fetch(paymentsUrl, {
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
    payload = {
      message: rawText
        ? `Non-JSON PayU response (${rawText.slice(0, 180)})`
        : "Empty PayU response",
    };
  }

  const failureDetails = buildPayUCreatePaymentFailureDetails({
    httpStatus: response.status,
    endpointUrl: paymentsUrl,
    txnId: input.txnId,
    payload,
  });

  if (!response.ok) {
    logPayUCreatePaymentFailure(failureDetails);
    throw new Error(formatPayUCreatePaymentClientError(failureDetails));
  }

  const result = asRecord(payload.result);
  const checkoutUrlRaw =
    (typeof result.checkoutUrl === "string" && result.checkoutUrl) ||
    (typeof result.checkoutURL === "string" && result.checkoutURL) ||
    "";
  const checkoutUrl = checkoutUrlRaw.trim();
  if (!checkoutUrl) {
    logPayUCreatePaymentFailure(failureDetails);
    throw new Error(formatPayUCreatePaymentClientError(failureDetails));
  }

  const status =
    typeof payload.status === "string"
      ? payload.status
      : String(payload.status ?? "");

  return {
    txnId: input.txnId,
    checkoutUrl,
    status,
  };
}

export type PayUVerifyTransaction = {
  txnId: string;
  status: string;
  unmappedStatus: string | null;
  amountInr: number;
  currency: string;
  mihpayId: string | null;
  udf1: string | null;
};

function pickVerifyAmount(row: Record<string, unknown>): number {
  const candidates = [
    row.originalAmount,
    row.amount,
    row.netDebitAmount,
    row.merNetAmount,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  if (typeof row.amount === "number" && Number.isFinite(row.amount)) {
    return row.amount;
  }
  if (typeof row.amount === "string") {
    const n = Number(row.amount);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function verifyPayUPayment(input: {
  config?: PayUClientConfig;
  txnId: string;
}): Promise<PayUVerifyTransaction> {
  const config = input.config || getPayUConfig();
  const bodyObject = { txnId: [input.txnId] };
  // HMAC must use this exact string — same value sent as the HTTP body.
  const requestBody = JSON.stringify(bodyObject);
  const date = new Date().toUTCString();
  const authorization = buildPayuV2Authorization({
    requestBody,
    date,
    merchantKey: config.merchantKey,
    merchantSecret: config.merchantSecret,
  });

  const verifyUrl = getPayUVerifyUrl(config.environment);
  assertPayUTestEndpointSafety(config.environment, verifyUrl);

  const response = await fetch(verifyUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      date,
      authorization,
      "Info-Command": "verify_payment",
    },
    body: requestBody,
  });

  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : `PayU verify payment failed (${response.status})`;
    throw new Error(message);
  }

  const resultList = Array.isArray(payload.result) ? payload.result : [];
  const row = asRecord(resultList[0]);
  if (
    typeof row.message === "string" &&
    row.message.toLowerCase().includes("not found")
  ) {
    return {
      txnId: input.txnId,
      status: "failure",
      unmappedStatus: null,
      amountInr: 0,
      currency: "INR",
      mihpayId: null,
      udf1: null,
    };
  }

  const status =
    typeof row.status === "string" ? row.status : String(row.status ?? "");
  const unmappedStatus =
    typeof row.unmappedStatus === "string"
      ? row.unmappedStatus
      : typeof row.unmappedstatus === "string"
        ? row.unmappedstatus
        : null;

  const mihpayRaw = row.mihpayId ?? row.mihpayid;
  const mihpayId =
    mihpayRaw == null || mihpayRaw === ""
      ? null
      : String(mihpayRaw).trim() || null;

  const currency =
    typeof row.originalCurrency === "string" && row.originalCurrency.trim()
      ? row.originalCurrency.trim().toUpperCase()
      : "INR";

  return {
    txnId:
      typeof row.txnId === "string" && row.txnId.trim()
        ? row.txnId.trim()
        : input.txnId,
    status,
    unmappedStatus,
    amountInr: pickVerifyAmount(row),
    currency,
    mihpayId,
    udf1: typeof row.udf1 === "string" ? row.udf1 : null,
  };
}

/** Documented success gate: status === "success"; prefer unmappedStatus captured when present. */
export function isPayUPaymentSuccessful(input: {
  status: string;
  unmappedStatus?: string | null;
}): boolean {
  if (input.status.trim().toLowerCase() !== "success") {
    return false;
  }
  const unmapped = (input.unmappedStatus || "").trim().toLowerCase();
  if (!unmapped) return true;
  // Prefer captured when present; auth is also documented as Success by PayU.
  if (unmapped === "captured" || unmapped === "auth") return true;
  // If status says success but unmapped is a documented failure, reject.
  const failureUnmapped = new Set([
    "failed",
    "bounced",
    "dropped",
    "usercancelled",
    "autorefund",
  ]);
  if (failureUnmapped.has(unmapped)) return false;
  // Do not invent further rules — trust status === success.
  return true;
}
