import { Prisma } from "@prisma/client";

import { PREMIUM_PLAN } from "@/lib/cashfree";
import { prisma } from "@/lib/prisma";
import { AGENT_OFFLINE_MS } from "@/lib/print-agent-auth";
import { computeTrialConversion } from "@/lib/admin-subscriptions";

export const ADMIN_ANALYTICS_RANGES = [
  "today",
  "7d",
  "30d",
  "90d",
  "month",
  "year",
] as const;

export type AdminAnalyticsRange = (typeof ADMIN_ANALYTICS_RANGES)[number];
export type AnalyticsBucket = "day" | "week" | "month";

const IST_OFFSET_MINUTES = 330;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;

export type AnalyticsDateRange = {
  key: AdminAnalyticsRange;
  label: string;
  start: Date;
  end: Date;
  bucket: AnalyticsBucket;
};

export type AdminAnalytics = {
  range: {
    key: AdminAnalyticsRange;
    label: string;
    start: string;
    end: string;
    timezone: "Asia/Kolkata";
    bucket: AnalyticsBucket;
  };
  business: {
    totalShops: number;
    activeShops: number;
    trialShops: number;
    premiumShops: number;
    pastDueShops: number;
    cancelledShops: number;
    expiredShops: number;
    estimatedMrrInr: number;
    estimatedMrrLabel: "Estimated MRR";
    collectedRevenueAvailable: false;
    collectedRevenueNote: string;
  };
  shopGrowth: Array<{ bucket: string; label: string; shops: number }>;
  subscriptions: {
    statuses: Array<{ status: string; count: number }>;
    activePremium: number;
    trialConversion: {
      available: boolean;
      ratePercent: number | null;
      convertedCount: number | null;
      endedTrialCount: number | null;
      note: string;
      isApproximate: true;
    };
    statusTrendAvailable: false;
    statusTrendNote: string;
  };
  printing: {
    totalJobs: number;
    submittedPages: number;
    completedJobs: number;
    cancelledJobs: number;
    jobsWithRecordedError: number;
    physicalPagesExact: false;
    physicalPagesNote: string;
    trend: Array<{ bucket: string; label: string; jobs: number; submittedPages: number }>;
    modes: Array<{ mode: "BW" | "COLOR"; jobs: number; submittedPages: number }>;
    statuses: Array<{ status: string; jobs: number; submittedPages: number }>;
  };
  topShops: Array<{
    rank: number;
    shopId: string;
    shopName: string;
    shopCode: string;
    jobs: number;
    submittedPages: number;
    bwPages: number;
    colorPages: number;
    agentStatus: "Online" | "Offline" | "Never connected";
  }>;
  agentHealth: {
    online: number;
    offline: number;
    neverConnected: number;
    snapshotNote: string;
  };
};

export const ADMIN_ANALYTICS_FORBIDDEN_RESPONSE_KEYS = [
  "passwordHash",
  "agentTokenHash",
  "agentPairingTokenHash",
  "providerCustomerId",
  "providerSubscriptionId",
  "payloadHash",
  "CASHFREE_CLIENT_SECRET",
  "CASHFREE_WEBHOOK_SECRET",
  "clientSecret",
  "webhookSecret",
  "rawBody",
  "payload",
] as const;

const RANGE_LABELS: Record<AdminAnalyticsRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
  year: "This year",
};

export function normalizeAdminAnalyticsRange(value: string | null | undefined): AdminAnalyticsRange {
  return ADMIN_ANALYTICS_RANGES.includes(value as AdminAnalyticsRange)
    ? (value as AdminAnalyticsRange)
    : "30d";
}

function istParts(value: Date) {
  const shifted = new Date(value.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function istDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);
}

function startOfIstDay(value: Date) {
  const { year, month, day } = istParts(value);
  return istDate(year, month, day);
}

function addIstDays(value: Date, days: number) {
  const { year, month, day } = istParts(value);
  return istDate(year, month, day + days);
}

export function getAdminAnalyticsDateRange(
  rangeValue: string | null | undefined,
  now: Date = new Date(),
): AnalyticsDateRange {
  const key = normalizeAdminAnalyticsRange(rangeValue);
  const today = startOfIstDay(now);
  const current = istParts(now);
  let start = today;
  let end = addIstDays(today, 1);
  let bucket: AnalyticsBucket = "day";

  if (key === "7d") {
    start = addIstDays(today, -6);
  } else if (key === "30d") {
    start = addIstDays(today, -29);
  } else if (key === "90d") {
    start = addIstDays(today, -89);
    bucket = "week";
  } else if (key === "month") {
    start = istDate(current.year, current.month, 1);
    end = istDate(current.year, current.month + 1, 1);
  } else if (key === "year") {
    start = istDate(current.year, 0, 1);
    end = istDate(current.year + 1, 0, 1);
    bucket = "month";
  }

  return { key, label: RANGE_LABELS[key], start, end, bucket };
}

export function formatAnalyticsNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

export function formatAnalyticsMoneyInr(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function sqlBucketFormat(bucket: AnalyticsBucket) {
  if (bucket === "month") return "%Y-%m";
  if (bucket === "week") return "%x-W%v";
  return "%Y-%m-%d";
}

function labelForBucket(bucket: string, type: AnalyticsBucket) {
  if (type === "month") {
    const [year, month] = bucket.split("-").map(Number);
    return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(
      new Date(Date.UTC(year, (month || 1) - 1, 1)),
    );
  }
  if (type === "week") return bucket.replace("-W", " W");
  const [year, month, day] = bucket.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(
    new Date(Date.UTC(year, (month || 1) - 1, day || 1)),
  );
}

function numberValue(value: unknown) {
  return Number(value || 0);
}

type TrendRow = { bucket: string; count: bigint | number; pages?: bigint | number | null };

async function getTrendRows(input: {
  table: "Shop" | "PrintJob";
  range: AnalyticsDateRange;
}) {
  const format = sqlBucketFormat(input.range.bucket);
  if (input.table === "Shop") {
    return prisma.$queryRaw<TrendRow[]>(Prisma.sql`
      SELECT DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 330 MINUTE), ${format}) AS bucket,
             COUNT(*) AS count
      FROM Shop
      WHERE createdAt >= ${input.range.start} AND createdAt < ${input.range.end}
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
  }

  return prisma.$queryRaw<TrendRow[]>(Prisma.sql`
    SELECT DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 330 MINUTE), ${format}) AS bucket,
           COUNT(*) AS count,
           COALESCE(SUM(totalPages), 0) AS pages
    FROM PrintJob
    WHERE createdAt >= ${input.range.start} AND createdAt < ${input.range.end}
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
}

/**
 * Detailed, safe, bounded analytics for the Admin dashboard. Current-state
 * subscription metrics are intentionally not represented as historical trends.
 */
export async function getAdminAnalytics(input: {
  range?: string | null;
  now?: Date;
} = {}): Promise<AdminAnalytics> {
  const now = input.now || new Date();
  const range = getAdminAnalyticsDateRange(input.range, now);
  const printWhere = { createdAt: { gte: range.start, lt: range.end } };
  const onlineAfter = new Date(now.getTime() - AGENT_OFFLINE_MS);

  const [
    totalShops,
    activeShops,
    trialShops,
    premiumShops,
    pastDueShops,
    cancelledShops,
    expiredShops,
    trialConversion,
    shopGrowthRows,
    printTrendRows,
    printTotals,
    printStatusRows,
    printModeRows,
    errorJobs,
    topShopRows,
    onlineAgents,
    offlineAgents,
  ] = await Promise.all([
    prisma.shop.count(),
    prisma.shop.count({ where: { isActive: true } }),
    prisma.subscription.count({ where: { status: "TRIALING" } }),
    prisma.subscription.count({ where: { plan: "PREMIUM", status: "ACTIVE" } }),
    prisma.subscription.count({ where: { status: "PAST_DUE" } }),
    prisma.subscription.count({ where: { status: "CANCELLED" } }),
    prisma.subscription.count({ where: { status: "EXPIRED" } }),
    computeTrialConversion(now),
    getTrendRows({ table: "Shop", range }),
    getTrendRows({ table: "PrintJob", range }),
    prisma.printJob.aggregate({ where: printWhere, _count: { _all: true }, _sum: { totalPages: true } }),
    prisma.printJob.groupBy({
      by: ["status"],
      where: printWhere,
      _count: { _all: true },
      _sum: { totalPages: true },
    }),
    prisma.printJob.groupBy({
      by: ["printMode"],
      where: printWhere,
      _count: { _all: true },
      _sum: { totalPages: true },
    }),
    prisma.printJob.count({ where: { ...printWhere, lastError: { not: null } } }),
    prisma.printJob.groupBy({
      by: ["shopId"],
      where: printWhere,
      _count: { _all: true },
      _sum: { totalPages: true },
      orderBy: { _sum: { totalPages: "desc" } },
      take: 10,
    }),
    prisma.shop.count({ where: { agentId: { not: null }, agentLastSeen: { gte: onlineAfter } } }),
    prisma.shop.count({ where: { agentId: { not: null }, agentLastSeen: { lt: onlineAfter } } }),
  ]);

  const topShopIds = topShopRows.map((row) => row.shopId);
  const topShopsMeta = topShopIds.length
    ? await prisma.shop.findMany({
        where: { id: { in: topShopIds } },
        select: { id: true, shopName: true, shopCode: true, agentId: true, agentLastSeen: true },
      })
    : [];
  const topShopById = new Map(topShopsMeta.map((shop) => [shop.id, shop]));

  const topShopModes = topShopIds.length
    ? await prisma.printJob.groupBy({
        by: ["shopId", "printMode"],
        where: { ...printWhere, shopId: { in: topShopIds } },
        _sum: { totalPages: true },
      })
    : [];
  const modesByShop = new Map<string, { bwPages: number; colorPages: number }>();
  for (const row of topShopModes) {
    const current = modesByShop.get(row.shopId) || { bwPages: 0, colorPages: 0 };
    if (row.printMode === "BW") current.bwPages = row._sum.totalPages || 0;
    if (row.printMode === "COLOR") current.colorPages = row._sum.totalPages || 0;
    modesByShop.set(row.shopId, current);
  }

  const statusMap = new Map(printStatusRows.map((row) => [row.status, row]));
  const completedJobs = (statusMap.get("READY_FOR_PICKUP")?._count._all || 0) +
    (statusMap.get("DELIVERED")?._count._all || 0);
  const neverConnected = Math.max(0, totalShops - onlineAgents - offlineAgents);

  return {
    range: {
      key: range.key,
      label: range.label,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      timezone: "Asia/Kolkata",
      bucket: range.bucket,
    },
    business: {
      totalShops,
      activeShops,
      trialShops,
      premiumShops,
      pastDueShops,
      cancelledShops,
      expiredShops,
      estimatedMrrInr: premiumShops * PREMIUM_PLAN.amountInr,
      estimatedMrrLabel: "Estimated MRR",
      collectedRevenueAvailable: false,
      collectedRevenueNote: "Not collected revenue. Actual collected revenue requires a verified payment transaction/history ledger.",
    },
    shopGrowth: shopGrowthRows.map((row) => ({
      bucket: String(row.bucket),
      label: labelForBucket(String(row.bucket), range.bucket),
      shops: numberValue(row.count),
    })),
    subscriptions: {
      statuses: ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED", "EXPIRED"].map((status) => ({
        status,
        count: ({ TRIALING: trialShops, ACTIVE: premiumShops, PAST_DUE: pastDueShops, CANCELLED: cancelledShops, EXPIRED: expiredShops } as Record<string, number>)[status],
      })),
      activePremium: premiumShops,
      trialConversion: { ...trialConversion, isApproximate: true },
      statusTrendAvailable: false,
      statusTrendNote: "Historical subscription status trends require a subscription event/history model. This dashboard shows the current status snapshot.",
    },
    printing: {
      totalJobs: printTotals._count._all,
      submittedPages: printTotals._sum.totalPages || 0,
      completedJobs,
      cancelledJobs: statusMap.get("CANCELLED")?._count._all || 0,
      jobsWithRecordedError: errorJobs,
      physicalPagesExact: false,
      physicalPagesNote: "Submitted pages are not necessarily physically printed pages. The current schema has no immutable print-event ledger.",
      trend: printTrendRows.map((row) => ({
        bucket: String(row.bucket),
        label: labelForBucket(String(row.bucket), range.bucket),
        jobs: numberValue(row.count),
        submittedPages: numberValue(row.pages),
      })),
      modes: ["BW", "COLOR"].map((mode) => {
        const row = printModeRows.find((item) => item.printMode === mode);
        return { mode: mode as "BW" | "COLOR", jobs: row?._count._all || 0, submittedPages: row?._sum.totalPages || 0 };
      }),
      statuses: printStatusRows.map((row) => ({
        status: row.status,
        jobs: row._count._all,
        submittedPages: row._sum.totalPages || 0,
      })),
    },
    topShops: topShopRows.flatMap((row, index) => {
      const shop = topShopById.get(row.shopId);
      if (!shop) return [];
      const mode = modesByShop.get(shop.id) || { bwPages: 0, colorPages: 0 };
      const agentStatus = !shop.agentLastSeen
        ? "Never connected"
        : shop.agentLastSeen.getTime() >= onlineAfter.getTime()
          ? "Online"
          : "Offline";
      return [{
        rank: index + 1,
        shopId: shop.id,
        shopName: shop.shopName,
        shopCode: shop.shopCode,
        jobs: row._count._all,
        submittedPages: row._sum.totalPages || 0,
        ...mode,
        agentStatus,
      }];
    }),
    agentHealth: {
      online: onlineAgents,
      offline: offlineAgents,
      neverConnected,
      snapshotNote: "Current snapshot based on the existing agent heartbeat offline threshold.",
    },
  };
}
