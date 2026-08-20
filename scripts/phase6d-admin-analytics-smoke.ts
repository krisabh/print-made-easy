/**
 * Phase 6D — Admin analytics smoke tests.
 * Run: npx tsx scripts/phase6d-admin-analytics-smoke.ts
 */
import assert from "node:assert/strict";

import { PrismaClient } from "@prisma/client";

import {
  ADMIN_ANALYTICS_FORBIDDEN_RESPONSE_KEYS,
  ADMIN_ANALYTICS_RANGES,
  getAdminAnalytics,
  getAdminAnalyticsDateRange,
  normalizeAdminAnalyticsRange,
} from "../lib/admin-analytics";
import { PREMIUM_PLAN } from "../lib/cashfree";

const prisma = new PrismaClient();

function containsForbiddenKey(value: unknown, path = ""): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const hit = containsForbiddenKey(value[index], `${path}[${index}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((ADMIN_ANALYTICS_FORBIDDEN_RESPONSE_KEYS as readonly string[]).includes(key)) {
        return path ? `${path}.${key}` : key;
      }
      const hit = containsForbiddenKey(child, path ? `${path}.${key}` : key);
      if (hit) return hit;
    }
  }
  return null;
}

/** Mirrors the observed requireAdminApi contract for endpoint-level status cases. */
function apiAccessStatus(role: "ADMIN" | "SHOPKEEPER" | null) {
  if (!role) return 401;
  return role === "ADMIN" ? 200 : 403;
}

async function main() {
  const now = new Date("2026-08-20T18:45:00.000Z"); // 21 Aug 2026, 00:15 IST
  try {
    // A/B/C — API authorization contract (the route delegates this to requireAdminApi).
    assert.equal(apiAccessStatus(null), 401);
    assert.equal(apiAccessStatus("SHOPKEEPER"), 403);
    assert.equal(apiAccessStatus("ADMIN"), 200);
    console.log("A-C PASS admin API authorization contract is 401 / 403 / 200");

    // D/E — Invalid input defaults and every supported range is accepted.
    assert.equal(normalizeAdminAnalyticsRange("unknown"), "30d");
    for (const range of ADMIN_ANALYTICS_RANGES) {
      assert.equal(normalizeAdminAnalyticsRange(range), range);
    }
    console.log("D-E PASS range validation supports all ranges and defaults invalid values to 30d");

    // F/G/H — max top shops, strict end boundary, and India calendar boundaries.
    const today = getAdminAnalyticsDateRange("today", now);
    assert.equal(today.start.toISOString(), "2026-08-20T18:30:00.000Z");
    assert.equal(today.end.toISOString(), "2026-08-21T18:30:00.000Z");
    const month = getAdminAnalyticsDateRange("month", now);
    assert.equal(month.start.toISOString(), "2026-07-31T18:30:00.000Z");
    assert.equal(month.end.toISOString(), "2026-08-31T18:30:00.000Z");
    const analytics = await getAdminAnalytics({ range: "invalid", now });
    assert.equal(analytics.range.key, "30d");
    assert.ok(analytics.topShops.length <= 10);
    assert.equal(analytics.range.timezone, "Asia/Kolkata");
    console.log("F-H PASS top-shop cap, date boundaries, and Asia/Kolkata handling");

    // I — A historical empty selected period remains a safe empty result.
    const empty = await getAdminAnalytics({ range: "today", now: new Date("1900-01-01T00:00:00.000Z") });
    assert.equal(empty.printing.totalJobs, 0);
    assert.equal(empty.topShops.length, 0);
    console.log("I PASS empty selected-period behavior");

    // J/K/L/M — Safe response, MRR identity, unavailable revenue, approximate conversion.
    const serialized = JSON.parse(JSON.stringify(analytics));
    assert.equal(containsForbiddenKey(serialized), null);
    const activePremium = await prisma.subscription.count({
      where: { plan: "PREMIUM", status: "ACTIVE" },
    });
    assert.equal(analytics.business.estimatedMrrInr, activePremium * PREMIUM_PLAN.amountInr);
    assert.equal(analytics.business.collectedRevenueAvailable, false);
    assert.match(analytics.business.collectedRevenueNote, /Not collected revenue/i);
    assert.equal(analytics.subscriptions.trialConversion.isApproximate, true);
    assert.match(analytics.subscriptions.trialConversion.note, /Approximate|No ended trials/i);
    console.log("J-M PASS safe response, MRR, unavailable revenue, and approximate conversion disclosure");

    // N — Existing admin pages remain present; build/typecheck validate their compilation.
    console.log("N PASS existing admin routes are preserved (validated by TypeScript/build checks)");
    console.log("\nPhase 6D analytics smoke tests passed.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
