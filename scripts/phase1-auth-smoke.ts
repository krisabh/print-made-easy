/**
 * Lightweight Phase 1 checks (no HTTP server required).
 * Run: npx tsx scripts/phase1-auth-smoke.ts
 */
import assert from "node:assert/strict";

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { generateShopCodeCandidate } from "../lib/shop-code";

function testShopCodeFormat() {
  const code = generateShopCodeCandidate();
  assert.match(code, /^PME[A-Z2-9]{6}$/);
  assert.equal(code.includes("0"), false);
  assert.equal(code.includes("1"), false);
  assert.equal(code.includes("O"), false);
  assert.equal(code.includes("I"), false);
}

async function testPasswordHash() {
  const hash = await bcrypt.hash("password123", 12);
  assert.equal(await bcrypt.compare("password123", hash), true);
  assert.equal(await bcrypt.compare("wrong", hash), false);
}

function testJwtRoundTrip() {
  const secret = "test-secret-for-smoke-only";
  const token = jwt.sign({ sub: "user-1", email: "a@b.com" }, secret, {
    expiresIn: "1h",
  });
  const decoded = jwt.verify(token, secret) as { sub: string; email: string };
  assert.equal(decoded.sub, "user-1");
  assert.equal(decoded.email, "a@b.com");
}

async function main() {
  testShopCodeFormat();
  await testPasswordHash();
  testJwtRoundTrip();
  console.log("phase1-auth-smoke: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
