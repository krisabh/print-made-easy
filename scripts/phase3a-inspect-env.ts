/**
 * Phase 3A helper — inspect local billing/PayU env without printing secrets.
 * Run: npx tsx scripts/phase3a-inspect-env.ts
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");

function parseEnv(raw: string) {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
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
    out[key] = value;
  }
  return out;
}

function status(key: string, value: string | undefined, secret = false) {
  if (value == null) return `${key}=MISSING`;
  if (secret) {
    const placeholder =
      !value.trim() ||
      /^(your_|change-|YOUR-|<.*>|xxx)/i.test(value.trim());
    return placeholder
      ? `${key}=EMPTY_OR_PLACEHOLDER`
      : `${key}=SET_LEN=${value.trim().length}`;
  }
  return `${key}=${value}`;
}

function main() {
  if (!fs.existsSync(envPath)) {
    console.log("ENV_FILE=MISSING");
    return;
  }
  console.log("ENV_FILE=PRESENT");
  const env = parseEnv(fs.readFileSync(envPath, "utf8"));
  console.log(status("BILLING_PROVIDER", env.BILLING_PROVIDER));
  console.log(status("BILLING_MODE", env.BILLING_MODE));
  console.log(status("PAYU_ENVIRONMENT", env.PAYU_ENVIRONMENT));
  console.log(status("PAYU_MERCHANT_KEY", env.PAYU_MERCHANT_KEY, true));
  console.log(status("PAYU_MERCHANT_SECRET", env.PAYU_MERCHANT_SECRET, true));
  console.log(status("CASHFREE_ENVIRONMENT", env.CASHFREE_ENVIRONMENT));
  console.log(status("NEXT_PUBLIC_APP_URL", env.NEXT_PUBLIC_APP_URL));

  const appUrl = (env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const looksLocal =
    !appUrl ||
    appUrl.includes("localhost") ||
    appUrl.includes("127.0.0.1");
  console.log(
    `CALLBACK_BASE_WOULD_BE=${looksLocal ? "http://localhost:3000 (or request host)" : appUrl}`,
  );
  console.log(`CALLBACK_USES_PRODUCTION_HOST=${looksLocal ? "no" : "yes"}`);
}

main();
