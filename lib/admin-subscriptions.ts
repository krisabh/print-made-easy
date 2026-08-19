import type {
  Prisma,
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@prisma/client";

import { PREMIUM_PLAN } from "@/lib/cashfree";
import { prisma } from "@/lib/prisma";
import {
  getSubscriptionAccess,
  toPublicSubscriptionView,
} from "@/lib/subscription";

export const ADMIN_SUBSCRIPTIONS_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_SUBSCRIPTIONS_MAX_PAGE_SIZE = 50;

export type AdminSubscriptionListItem = {
  id: string;
  shopId: string;
  shopName: string;
  shopCode: string;
  ownerName: string | null;
  ownerEmail: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trialStartAt: string | null;
  trialEndAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  hasAccess: boolean;
  daysRemaining: number | null;
  accessLabel: string;
  statusLabel: string;
  periodLabel: string;
  cancellationLabel: string;
  provider: string | null;
  providerSubscriptionId: string | null;
  createdAt: string;
};

export type AdminSubscriptionSummary = {
  totalSubscriptions: number;
  trialing: number;
  activePremium: number;
  pastDue: number;
  cancelled: number;
  expired: number;
  planPriceInr: number;
  estimatedMrrInr: number;
  collectedRevenueAvailable: false;
  collectedRevenueNote: string;
  trialConversion: {
    available: boolean;
    ratePercent: number | null;
    convertedCount: number | null;
    endedTrialCount: number | null;
    note: string;
  };
};

export type AdminWebhookEventSafe = {
  id: string;
  provider: string;
  eventId: string;
  eventType: string;
  receivedAt: string;
  processedAt: string | null;
  processingStatus: "processed" | "pending";
};

export type AdminSubscriptionListResult = {
  subscriptions: AdminSubscriptionListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: AdminSubscriptionSummary;
  recentWebhookEvents: AdminWebhookEventSafe[];
};

export type AdminSubscriptionDetail = {
  id: string;
  shop: {
    id: string;
    shopName: string;
    shopCode: string;
    ownerName: string | null;
    ownerEmail: string | null;
  };
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trialStartAt: string | null;
  trialEndAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  pastDueSince: string | null;
  hasAccess: boolean;
  accessReason: string;
  daysRemaining: number | null;
  statusLabel: string;
  accessLabel: string;
  cancellationLabel: string;
  detail: string;
  provider: string | null;
  providerSubscriptionId: string | null;
  providerPlanId: string | null;
  createdAt: string;
  updatedAt: string;
  relatedWebhookEvents: AdminWebhookEventSafe[];
  collectedRevenueAvailable: false;
  collectedRevenueNote: string;
};

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function formatDateIn(value: Date | null | undefined) {
  if (!value) return null;
  return value.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function normalizePage(page: number) {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

function normalizePageSize(pageSize: number) {
  if (!Number.isFinite(pageSize) || pageSize < 1) {
    return ADMIN_SUBSCRIPTIONS_DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(pageSize), ADMIN_SUBSCRIPTIONS_MAX_PAGE_SIZE);
}

function parseStatusFilter(
  status: string | null | undefined,
): SubscriptionStatus | null {
  const raw = status?.trim().toUpperCase();
  if (
    raw === "TRIALING" ||
    raw === "ACTIVE" ||
    raw === "PAST_DUE" ||
    raw === "CANCELLED" ||
    raw === "EXPIRED"
  ) {
    return raw;
  }
  return null;
}

function parsePlanFilter(
  plan: string | null | undefined,
): SubscriptionPlan | null {
  const raw = plan?.trim().toUpperCase();
  if (raw === "TRIAL" || raw === "PREMIUM") return raw;
  return null;
}

function buildWhere(input: {
  search?: string | null;
  status?: string | null;
  plan?: string | null;
}): Prisma.SubscriptionWhereInput {
  const where: Prisma.SubscriptionWhereInput = {};
  const status = parseStatusFilter(input.status);
  const plan = parsePlanFilter(input.plan);
  if (status) where.status = status;
  if (plan) where.plan = plan;

  const q = input.search?.trim();
  if (q) {
    where.OR = [
      { shop: { shopName: { contains: q } } },
      { shop: { shopCode: { contains: q } } },
      { shop: { owner: { name: { contains: q } } } },
      { shop: { owner: { email: { contains: q } } } },
      { providerSubscriptionId: { contains: q } },
    ];
  }

  return where;
}

/**
 * Approximate trial conversion from current schema (no history table).
 * Denominator: subscriptions whose trialEndAt is in the past.
 * Numerator: among those, plan === PREMIUM (converted at some point).
 *
 * TODO(future): add a SubscriptionEvent/history model for accurate
 * trial→premium transition tracking and time-series conversion rates.
 */
export async function computeTrialConversion(now: Date = new Date()) {
  const [endedTrialCount, convertedCount] = await Promise.all([
    prisma.subscription.count({
      where: {
        trialEndAt: { not: null, lt: now },
      },
    }),
    prisma.subscription.count({
      where: {
        trialEndAt: { not: null, lt: now },
        plan: "PREMIUM",
      },
    }),
  ]);

  if (endedTrialCount === 0) {
    return {
      available: true as const,
      ratePercent: null as number | null,
      convertedCount,
      endedTrialCount,
      note: "No ended trials yet. Conversion rate will appear once trials complete.",
    };
  }

  const ratePercent = Math.round((convertedCount / endedTrialCount) * 1000) / 10;
  return {
    available: true as const,
    ratePercent,
    convertedCount,
    endedTrialCount,
    note: "Approximate: Premium plan among shops whose trial end date has passed (current schema has no subscription history).",
  };
}

export async function getAdminSubscriptionSummary(
  now: Date = new Date(),
): Promise<AdminSubscriptionSummary> {
  const [
    totalSubscriptions,
    trialing,
    activePremium,
    pastDue,
    cancelled,
    expired,
    trialConversion,
  ] = await Promise.all([
    prisma.subscription.count(),
    prisma.subscription.count({ where: { status: "TRIALING" } }),
    prisma.subscription.count({
      where: { plan: "PREMIUM", status: "ACTIVE" },
    }),
    prisma.subscription.count({ where: { status: "PAST_DUE" } }),
    prisma.subscription.count({ where: { status: "CANCELLED" } }),
    prisma.subscription.count({ where: { status: "EXPIRED" } }),
    computeTrialConversion(now),
  ]);

  const planPriceInr = PREMIUM_PLAN.amountInr;
  const estimatedMrrInr = activePremium * planPriceInr;

  return {
    totalSubscriptions,
    trialing,
    activePremium,
    pastDue,
    cancelled,
    expired,
    planPriceInr,
    estimatedMrrInr,
    collectedRevenueAvailable: false,
    collectedRevenueNote:
      "Actual collected revenue will require a payment transaction/history model based on verified Cashfree payment-success webhooks. Sandbox/test payments are not counted as revenue.",
    trialConversion: {
      available: trialConversion.available,
      ratePercent: trialConversion.ratePercent,
      convertedCount: trialConversion.convertedCount,
      endedTrialCount: trialConversion.endedTrialCount,
      note: trialConversion.note,
    },
  };
}

function mapWebhookEvent(event: {
  id: string;
  provider: string;
  eventId: string;
  eventType: string;
  receivedAt: Date;
  processedAt: Date | null;
}): AdminWebhookEventSafe {
  return {
    id: event.id,
    provider: event.provider,
    eventId: event.eventId,
    eventType: event.eventType,
    receivedAt: event.receivedAt.toISOString(),
    processedAt: event.processedAt ? event.processedAt.toISOString() : null,
    processingStatus: event.processedAt ? "processed" : "pending",
  };
}

export async function listRecentWebhookEvents(limit = 10) {
  const events = await prisma.paymentWebhookEvent.findMany({
    orderBy: { receivedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: {
      id: true,
      provider: true,
      eventId: true,
      eventType: true,
      receivedAt: true,
      processedAt: true,
      // payloadHash intentionally omitted from admin UI payloads
    },
  });
  return events.map(mapWebhookEvent);
}

export async function listRelatedWebhookEvents(
  providerSubscriptionId: string | null | undefined,
  limit = 10,
) {
  if (!providerSubscriptionId?.trim()) return [];

  const events = await prisma.paymentWebhookEvent.findMany({
    where: {
      eventId: { contains: providerSubscriptionId.trim() },
    },
    orderBy: { receivedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: {
      id: true,
      provider: true,
      eventId: true,
      eventType: true,
      receivedAt: true,
      processedAt: true,
    },
  });
  return events.map(mapWebhookEvent);
}

export function buildSubscriptionDisplayLabels(
  subscription: Subscription,
  now: Date = new Date(),
) {
  const access = getSubscriptionAccess(subscription, now);
  const view = toPublicSubscriptionView(subscription, now);
  const daysRemaining = view?.daysRemaining ?? null;

  let statusLabel: string = subscription.status;
  if (subscription.status === "TRIALING" && access.hasAccess) {
    const days = daysRemaining ?? 0;
    statusLabel = `Trial — ${days} day${days === 1 ? "" : "s"} remaining`;
  } else if (subscription.status === "TRIALING") {
    statusLabel = "Trial ended";
  } else if (subscription.status === "ACTIVE" && subscription.cancelAtPeriodEnd) {
    statusLabel = "Premium — Cancellation scheduled";
  } else if (subscription.status === "ACTIVE") {
    statusLabel = "Premium — Active";
  } else if (subscription.status === "PAST_DUE") {
    statusLabel = access.hasAccess ? "Past Due — Grace period" : "Past Due — Expired";
  } else if (subscription.status === "CANCELLED" && access.hasAccess) {
    statusLabel = `Cancelled — Active until ${formatDateIn(subscription.currentPeriodEnd) ?? "period end"}`;
  } else if (subscription.status === "CANCELLED") {
    statusLabel = "Cancelled / Expired";
  } else if (subscription.status === "EXPIRED") {
    statusLabel = "Expired";
  }

  const accessLabel = access.hasAccess ? "Allowed" : "Denied";

  let periodLabel = "—";
  if (subscription.status === "TRIALING") {
    const start = formatDateIn(subscription.trialStartAt);
    const end = formatDateIn(subscription.trialEndAt);
    periodLabel = start && end ? `${start} → ${end}` : end || start || "—";
  } else if (subscription.currentPeriodStart || subscription.currentPeriodEnd) {
    const start = formatDateIn(subscription.currentPeriodStart);
    const end = formatDateIn(subscription.currentPeriodEnd);
    periodLabel = start && end ? `${start} → ${end}` : end || start || "—";
  }

  let cancellationLabel = "Not scheduled";
  if (subscription.cancelAtPeriodEnd && access.hasAccess) {
    cancellationLabel = `Cancellation scheduled · until ${formatDateIn(subscription.currentPeriodEnd) ?? "period end"}`;
  } else if (subscription.status === "CANCELLED" && access.hasAccess) {
    cancellationLabel = `Cancelled · active until ${formatDateIn(subscription.currentPeriodEnd) ?? "period end"}`;
  } else if (
    subscription.status === "CANCELLED" ||
    subscription.status === "EXPIRED" ||
    (subscription.cancelAtPeriodEnd && !access.hasAccess)
  ) {
    cancellationLabel = "Cancelled / expired";
  }

  return {
    access,
    view,
    daysRemaining,
    statusLabel,
    accessLabel,
    periodLabel,
    cancellationLabel,
  };
}

export async function listAdminSubscriptions(input: {
  page?: number;
  pageSize?: number;
  search?: string | null;
  status?: string | null;
  plan?: string | null;
  now?: Date;
}): Promise<AdminSubscriptionListResult> {
  const now = input.now || new Date();
  const page = normalizePage(input.page ?? 1);
  const pageSize = normalizePageSize(
    input.pageSize ?? ADMIN_SUBSCRIPTIONS_DEFAULT_PAGE_SIZE,
  );
  const where = buildWhere(input);

  const [total, rows, summary, recentWebhookEvents] = await Promise.all([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        shopId: true,
        plan: true,
        status: true,
        trialStartAt: true,
        trialEndAt: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        cancelledAt: true,
        pastDueSince: true,
        provider: true,
        providerSubscriptionId: true,
        createdAt: true,
        updatedAt: true,
        shop: {
          select: {
            shopName: true,
            shopCode: true,
            owner: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
    }),
    getAdminSubscriptionSummary(now),
    listRecentWebhookEvents(10),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const subscriptions: AdminSubscriptionListItem[] = rows.map((row) => {
    const full = {
      ...row,
      providerCustomerId: null,
      providerPlanId: null,
    } as Subscription;

    const labels = buildSubscriptionDisplayLabels(full, now);

    return {
      id: row.id,
      shopId: row.shopId,
      shopName: row.shop.shopName,
      shopCode: row.shop.shopCode,
      ownerName: row.shop.owner?.name ?? null,
      ownerEmail: row.shop.owner?.email ?? null,
      plan: row.plan,
      status: row.status,
      trialStartAt: toIso(row.trialStartAt),
      trialEndAt: toIso(row.trialEndAt),
      currentPeriodStart: toIso(row.currentPeriodStart),
      currentPeriodEnd: toIso(row.currentPeriodEnd),
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      pastDueSince: toIso(row.pastDueSince),
      hasAccess: labels.access.hasAccess,
      daysRemaining: labels.daysRemaining,
      accessLabel: labels.accessLabel,
      statusLabel: labels.statusLabel,
      periodLabel: labels.periodLabel,
      cancellationLabel: labels.cancellationLabel,
      provider: row.provider,
      providerSubscriptionId: row.providerSubscriptionId,
      createdAt: row.createdAt.toISOString(),
    };
  });

  return {
    subscriptions,
    total,
    page,
    pageSize,
    totalPages,
    summary,
    recentWebhookEvents,
  };
}

export async function getAdminSubscriptionDetail(
  subscriptionId: string,
  now: Date = new Date(),
): Promise<AdminSubscriptionDetail | null> {
  const row = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      id: true,
      shopId: true,
      plan: true,
      status: true,
      trialStartAt: true,
      trialEndAt: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      cancelledAt: true,
      pastDueSince: true,
      provider: true,
      providerSubscriptionId: true,
      providerPlanId: true,
      createdAt: true,
      updatedAt: true,
      shop: {
        select: {
          id: true,
          shopName: true,
          shopCode: true,
          owner: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!row) return null;

  const full = {
    ...row,
    providerCustomerId: null,
  } as Subscription;

  const labels = buildSubscriptionDisplayLabels(full, now);
  const relatedWebhookEvents = await listRelatedWebhookEvents(
    row.providerSubscriptionId,
    10,
  );

  return {
    id: row.id,
    shop: {
      id: row.shop.id,
      shopName: row.shop.shopName,
      shopCode: row.shop.shopCode,
      ownerName: row.shop.owner?.name ?? null,
      ownerEmail: row.shop.owner?.email ?? null,
    },
    plan: row.plan,
    status: row.status,
    trialStartAt: toIso(row.trialStartAt),
    trialEndAt: toIso(row.trialEndAt),
    currentPeriodStart: toIso(row.currentPeriodStart),
    currentPeriodEnd: toIso(row.currentPeriodEnd),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    cancelledAt: toIso(row.cancelledAt),
    pastDueSince: toIso(row.pastDueSince),
    hasAccess: labels.access.hasAccess,
    accessReason: labels.access.reason,
    daysRemaining: labels.daysRemaining,
    statusLabel: labels.statusLabel,
    accessLabel: labels.accessLabel,
    cancellationLabel: labels.cancellationLabel,
    detail: labels.view?.detail ?? "",
    provider: row.provider,
    providerSubscriptionId: row.providerSubscriptionId,
    providerPlanId: row.providerPlanId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    relatedWebhookEvents,
    collectedRevenueAvailable: false,
    collectedRevenueNote:
      "Collected Revenue: Not available yet. Actual collected revenue will require a payment transaction/history model based on verified Cashfree payment-success webhooks.",
  };
}

export function formatAdminMoneyInr(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatAdminCreatedDate(iso: string) {
  return formatDateIn(new Date(iso)) ?? iso;
}

export const ADMIN_SUBSCRIPTION_FORBIDDEN_KEYS = [
  "passwordHash",
  "agentTokenHash",
  "agentPairingTokenHash",
  "payloadHash",
  "providerCustomerId",
  "CASHFREE_CLIENT_SECRET",
  "CASHFREE_WEBHOOK_SECRET",
  "clientSecret",
  "webhookSecret",
  "rawBody",
  "payload",
] as const;
