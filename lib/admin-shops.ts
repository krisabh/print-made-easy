import type { Prisma, Subscription } from "@prisma/client";

import { AGENT_OFFLINE_MS } from "@/lib/print-agent-auth";
import { prisma } from "@/lib/prisma";
import {
  getSubscriptionAccess,
  toPublicSubscriptionView,
  type PublicSubscriptionView,
  type ShopSubscription,
} from "@/lib/subscription";

export const ADMIN_SHOPS_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_SHOPS_MAX_PAGE_SIZE = 50;

export type AdminAgentStatusLabel = "Online" | "Offline" | "Never connected";

export type AdminShopListItem = {
  id: string;
  shopName: string;
  shopCode: string;
  isActive: boolean;
  createdAt: string;
  owner: {
    name: string | null;
    email: string | null;
  };
  subscription: {
    label: string;
    plan: string | null;
    status: string | null;
    hasAccess: boolean;
    daysRemaining: number | null;
  };
  agent: {
    status: AdminAgentStatusLabel;
    lastSeen: string | null;
  };
  printerCount: number;
  jobCount: number;
};

export type AdminShopListResult = {
  shops: AdminShopListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: {
    totalShops: number;
    activeShops: number;
    trialShops: number;
    premiumShops: number;
  };
};

export type AdminShopDetail = {
  id: string;
  shopName: string;
  shopCode: string;
  isActive: boolean;
  createdAt: string;
  owner: {
    id: string | null;
    name: string | null;
    email: string | null;
  };
  subscription: PublicSubscriptionView | null;
  subscriptionRaw: {
    plan: string | null;
    status: string | null;
    trialStartAt: string | null;
    trialEndAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    cancelledAt: string | null;
    pastDueSince: string | null;
    hasAccess: boolean;
    accessReason: string;
    label: string;
  };
  printing: {
    totalJobs: number;
    totalPages: number;
    bwJobs: number;
    bwPages: number;
    colorJobs: number;
    colorPages: number;
  };
  printers: Array<{
    id: string;
    printerName: string;
    printerModel: string | null;
    printerType: string | null;
    isDefault: boolean;
    status: string;
    lastSeen: string | null;
  }>;
  printerCount: number;
  agent: {
    agentId: string | null;
    status: AdminAgentStatusLabel;
    lastSeen: string | null;
  };
};

const subscriptionSafeSelect = {
  plan: true,
  status: true,
  trialStartAt: true,
  trialEndAt: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  cancelledAt: true,
  pastDueSince: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SubscriptionSelect;

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

function formatDateTimeIn(value: Date | null | undefined) {
  if (!value) return null;
  return value.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Agent status using the same offline window as print-agent-auth (AGENT_OFFLINE_MS).
 */
export function getAdminAgentStatus(input: {
  agentId: string | null | undefined;
  agentLastSeen: Date | null | undefined;
  now?: Date;
}): {
  status: AdminAgentStatusLabel;
  lastSeen: string | null;
  lastSeenLabel: string | null;
} {
  const now = input.now || new Date();
  const lastSeen = input.agentLastSeen ?? null;

  let status: AdminAgentStatusLabel;
  if (!lastSeen && !input.agentId) {
    status = "Never connected";
  } else if (!lastSeen) {
    status = "Never connected";
  } else {
    const ageMs = now.getTime() - lastSeen.getTime();
    status = ageMs <= AGENT_OFFLINE_MS ? "Online" : "Offline";
  }

  return {
    status,
    lastSeen: toIso(lastSeen),
    lastSeenLabel: formatDateTimeIn(lastSeen),
  };
}

/**
 * Compact subscription label for admin tables.
 * Uses getSubscriptionAccess from lib/subscription.ts — same lifecycle rules.
 */
export function formatAdminSubscriptionLabel(
  subscription: ShopSubscription | null | undefined,
  now: Date = new Date(),
): {
  label: string;
  plan: string | null;
  status: string | null;
  hasAccess: boolean;
  daysRemaining: number | null;
} {
  if (!subscription) {
    return {
      label: "Missing",
      plan: null,
      status: null,
      hasAccess: false,
      daysRemaining: null,
    };
  }

  const access = getSubscriptionAccess(subscription, now);
  const view = toPublicSubscriptionView(subscription, now);
  const daysRemaining = view?.daysRemaining ?? null;

  if (subscription.status === "TRIALING") {
    if (access.hasAccess) {
      const days = daysRemaining ?? 0;
      return {
        label: `Trial — ${days} day${days === 1 ? "" : "s"}`,
        plan: subscription.plan,
        status: subscription.status,
        hasAccess: true,
        daysRemaining: days,
      };
    }
    return {
      label: "Expired",
      plan: subscription.plan,
      status: subscription.status,
      hasAccess: false,
      daysRemaining: 0,
    };
  }

  if (subscription.status === "ACTIVE") {
    if (subscription.cancelAtPeriodEnd && access.hasAccess) {
      return {
        label: "Premium — Cancelled",
        plan: subscription.plan,
        status: subscription.status,
        hasAccess: true,
        daysRemaining,
      };
    }
    if (access.hasAccess) {
      return {
        label: "Premium — Active",
        plan: subscription.plan,
        status: subscription.status,
        hasAccess: true,
        daysRemaining,
      };
    }
    return {
      label: "Expired",
      plan: subscription.plan,
      status: subscription.status,
      hasAccess: false,
      daysRemaining: 0,
    };
  }

  if (subscription.status === "PAST_DUE") {
    return {
      label: "Past Due",
      plan: subscription.plan,
      status: subscription.status,
      hasAccess: access.hasAccess,
      daysRemaining,
    };
  }

  if (subscription.status === "CANCELLED") {
    if (access.hasAccess) {
      return {
        label: "Premium — Cancelled",
        plan: subscription.plan,
        status: subscription.status,
        hasAccess: true,
        daysRemaining,
      };
    }
    return {
      label: "Expired",
      plan: subscription.plan,
      status: subscription.status,
      hasAccess: false,
      daysRemaining: 0,
    };
  }

  return {
    label: "Expired",
    plan: subscription.plan,
    status: subscription.status,
    hasAccess: false,
    daysRemaining: 0,
  };
}

function buildSearchWhere(search: string | null | undefined): Prisma.ShopWhereInput {
  const q = search?.trim();
  if (!q) return {};

  return {
    OR: [
      { shopName: { contains: q } },
      { shopCode: { contains: q } },
      { owner: { name: { contains: q } } },
      { owner: { email: { contains: q } } },
    ],
  };
}

function normalizePage(page: number) {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

function normalizePageSize(pageSize: number) {
  if (!Number.isFinite(pageSize) || pageSize < 1) {
    return ADMIN_SHOPS_DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(pageSize), ADMIN_SHOPS_MAX_PAGE_SIZE);
}

/**
 * Paginated admin shop list with counts via Prisma _count (no job/printer row loads).
 */
export async function listAdminShops(input: {
  page?: number;
  pageSize?: number;
  search?: string | null;
  now?: Date;
}): Promise<AdminShopListResult> {
  const now = input.now || new Date();
  const page = normalizePage(input.page ?? 1);
  const pageSize = normalizePageSize(
    input.pageSize ?? ADMIN_SHOPS_DEFAULT_PAGE_SIZE,
  );
  const where = buildSearchWhere(input.search);

  const [total, shops, totalShops, activeShops, trialShops, premiumShops] =
    await Promise.all([
      prisma.shop.count({ where }),
      prisma.shop.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          shopName: true,
          shopCode: true,
          isActive: true,
          createdAt: true,
          agentId: true,
          agentLastSeen: true,
          owner: {
            select: {
              name: true,
              email: true,
            },
          },
          subscription: {
            select: subscriptionSafeSelect,
          },
          _count: {
            select: {
              printers: true,
              printJobs: true,
            },
          },
        },
      }),
      prisma.shop.count(),
      prisma.shop.count({ where: { isActive: true } }),
      prisma.subscription.count({ where: { status: "TRIALING" } }),
      prisma.subscription.count({
        where: { plan: "PREMIUM", status: "ACTIVE" },
      }),
    ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    total,
    page,
    pageSize,
    totalPages,
    summary: {
      totalShops,
      activeShops,
      trialShops,
      premiumShops,
    },
    shops: shops.map((shop) => {
      const sub = shop.subscription
        ? ({
            ...shop.subscription,
            id: "admin-list",
            shopId: shop.id,
            provider: null,
            providerCustomerId: null,
            providerSubscriptionId: null,
            providerPlanId: null,
          } as Subscription)
        : null;

      const subscription = formatAdminSubscriptionLabel(sub, now);
      const agent = getAdminAgentStatus({
        agentId: shop.agentId,
        agentLastSeen: shop.agentLastSeen,
        now,
      });

      return {
        id: shop.id,
        shopName: shop.shopName,
        shopCode: shop.shopCode,
        isActive: shop.isActive,
        createdAt: shop.createdAt.toISOString(),
        owner: {
          name: shop.owner?.name ?? null,
          email: shop.owner?.email ?? null,
        },
        subscription,
        agent: {
          status: agent.status,
          lastSeen: agent.lastSeen,
        },
        printerCount: shop._count.printers,
        jobCount: shop._count.printJobs,
      };
    }),
  };
}

export async function getAdminShopDetail(
  shopId: string,
  now: Date = new Date(),
): Promise<AdminShopDetail | null> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopName: true,
      shopCode: true,
      isActive: true,
      createdAt: true,
      agentId: true,
      agentLastSeen: true,
      owner: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      subscription: {
        select: subscriptionSafeSelect,
      },
      printers: {
        orderBy: [{ isDefault: "desc" }, { printerName: "asc" }],
        select: {
          id: true,
          printerName: true,
          printerModel: true,
          printerType: true,
          isDefault: true,
          status: true,
          lastSeen: true,
        },
      },
      _count: {
        select: {
          printers: true,
          printJobs: true,
        },
      },
    },
  });

  if (!shop) return null;

  const [pagesAgg, modeStats] = await Promise.all([
    prisma.printJob.aggregate({
      where: { shopId },
      _sum: { totalPages: true },
    }),
    prisma.printJob.groupBy({
      by: ["printMode"],
      where: { shopId },
      _count: { _all: true },
      _sum: { totalPages: true },
    }),
  ]);

  let bwJobs = 0;
  let bwPages = 0;
  let colorJobs = 0;
  let colorPages = 0;
  for (const row of modeStats) {
    if (row.printMode === "BW") {
      bwJobs = row._count._all;
      bwPages = row._sum.totalPages ?? 0;
    } else if (row.printMode === "COLOR") {
      colorJobs = row._count._all;
      colorPages = row._sum.totalPages ?? 0;
    }
  }

  const sub = shop.subscription
    ? ({
        ...shop.subscription,
        id: "admin-detail",
        shopId: shop.id,
        provider: null,
        providerCustomerId: null,
        providerSubscriptionId: null,
        providerPlanId: null,
      } as Subscription)
    : null;

  const access = getSubscriptionAccess(sub, now);
  const view = toPublicSubscriptionView(sub, now);
  const labelInfo = formatAdminSubscriptionLabel(sub, now);
  const agent = getAdminAgentStatus({
    agentId: shop.agentId,
    agentLastSeen: shop.agentLastSeen,
    now,
  });

  return {
    id: shop.id,
    shopName: shop.shopName,
    shopCode: shop.shopCode,
    isActive: shop.isActive,
    createdAt: shop.createdAt.toISOString(),
    owner: {
      id: shop.owner?.id ?? null,
      name: shop.owner?.name ?? null,
      email: shop.owner?.email ?? null,
    },
    subscription: view,
    subscriptionRaw: {
      plan: sub?.plan ?? null,
      status: sub?.status ?? null,
      trialStartAt: toIso(sub?.trialStartAt),
      trialEndAt: toIso(sub?.trialEndAt),
      currentPeriodStart: toIso(sub?.currentPeriodStart),
      currentPeriodEnd: toIso(sub?.currentPeriodEnd),
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      cancelledAt: toIso(sub?.cancelledAt),
      pastDueSince: toIso(sub?.pastDueSince),
      hasAccess: access.hasAccess,
      accessReason: access.reason,
      label: labelInfo.label,
    },
    printing: {
      totalJobs: shop._count.printJobs,
      totalPages: pagesAgg._sum.totalPages ?? 0,
      bwJobs,
      bwPages,
      colorJobs,
      colorPages,
    },
    printers: shop.printers.map((p) => ({
      id: p.id,
      printerName: p.printerName,
      printerModel: p.printerModel,
      printerType: p.printerType,
      isDefault: p.isDefault,
      status: p.status,
      lastSeen: toIso(p.lastSeen),
    })),
    printerCount: shop._count.printers,
    agent: {
      agentId: shop.agentId,
      status: agent.status,
      lastSeen: agent.lastSeen,
    },
  };
}

export function formatAdminCreatedDate(iso: string) {
  return formatDateIn(new Date(iso)) ?? iso;
}

export function formatAdminLastSeen(iso: string | null) {
  if (!iso) return null;
  return formatDateTimeIn(new Date(iso));
}

/** Keys that must never appear in admin shop API payloads. */
export const ADMIN_FORBIDDEN_RESPONSE_KEYS = [
  "passwordHash",
  "agentTokenHash",
  "agentPairingTokenHash",
  "agentPairingExpiresAt",
  "agentPairingUsedAt",
  "providerCustomerId",
  "providerSubscriptionId",
  "CASHFREE_CLIENT_SECRET",
  "CASHFREE_WEBHOOK_SECRET",
] as const;
