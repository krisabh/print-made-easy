/**
 * Phase 3A — update LOCAL .env for PayU TEST prep.
 * Does not write real secrets. Does not touch Hostinger/production.
 * Run: npx tsx scripts/phase3a-prepare-local-env.ts
 */
import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(__dirname, "..", ".env");

function upsert(
  raw: string,
  key: string,
  value: string,
  options?: { onlyIfMissing?: boolean },
) {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(raw)) {
    if (options?.onlyIfMissing) return raw;
    return raw.replace(re, `${key}=${value}`);
  }
  const suffix = raw.endsWith("\n") ? "" : "\n";
  return `${raw}${suffix}${key}=${value}\n`;
}

function main() {
  if (!fs.existsSync(envPath)) {
    throw new Error(".env is missing — create it from .env.example first.");
  }

  let raw = fs.readFileSync(envPath, "utf8");
  raw = upsert(raw, "BILLING_PROVIDER", "payu");
  raw = upsert(raw, "BILLING_MODE", "one_time");
  raw = upsert(raw, "PAYU_ENVIRONMENT", "test", { onlyIfMissing: true });
  raw = upsert(raw, "PAYU_MERCHANT_KEY", "", { onlyIfMissing: true });
  raw = upsert(raw, "PAYU_MERCHANT_SECRET", "", { onlyIfMissing: true });

  // Keep Cashfree vars untouched; ensure we did not flip Cashfree to production.
  if (/^CASHFREE_ENVIRONMENT=production$/m.test(raw)) {
    console.log("WARN CASHFREE_ENVIRONMENT is production locally — left unchanged");
  }

  fs.writeFileSync(envPath, raw, "utf8");
  console.log("LOCAL_ENV_UPDATED_FOR_PAYU_TEST");
  console.log("NOTE: Fill PAYU_MERCHANT_KEY and PAYU_MERCHANT_SECRET with TEST credentials only.");
}

main();
