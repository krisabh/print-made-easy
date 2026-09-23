import { type Prisma, type Subscription } from "@prisma/client";

import { recordAdminAudit } from "@/lib/admin-audit";
import { AGENT_OFFLINE_MS } from "@/lib/print-agent-auth";
import { prisma } from "@/lib/prisma";
import {
  getSubscriptionAccess,
  isCheckoutClaimId,
  toPublicSubscriptionView,
  type PublicSubscriptionView,
  type ShopSubscription,
} from "@/lib/subscription";
import { deleteStoredUploadFile } from "@/lib/upload-service";

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
 * Feature 2 Phase 2D: optional deviceLastSeenMax aggregates AgentDevice heartbeats
 * with legacy Shop.agentLastSeen (freshest wins for display / online check).
 */
export function getAdminAgentStatus(input: {
  agentId: string | null | undefined;
  agentLastSeen: Date | null | undefined;
  /** Max AgentDevice.lastSeen for the shop (optional device-aware aggregate). */
  deviceLastSeenMax?: Date | null | undefined;
  /** True when the shop has at least one AgentDevice row. */
  hasAgentDevice?: boolean;
  now?: Date;
}): {
  status: AdminAgentStatusLabel;
  lastSeen: string | null;
  lastSeenLabel: string | null;
} {
  const now = input.now || new Date();
  const legacyMs = input.agentLastSeen
    ? new Date(input.agentLastSeen).getTime()
    : null;
  const deviceMs = input.deviceLastSeenMax
    ? new Date(input.deviceLastSeenMax).getTime()
    : null;
  let lastSeen: Date | null = null;
  if (legacyMs != null && deviceMs != null) {
    lastSeen = new Date(Math.max(legacyMs, deviceMs));
  } else if (legacyMs != null) {
    lastSeen = new Date(legacyMs);
  } else if (deviceMs != null) {
    lastSeen = new Date(deviceMs);
  }

  let status: AdminAgentStatusLabel;
  if (
    !lastSeen &&
    !input.agentId &&
    !input.hasAgentDevice
  ) {
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
          agentDevices: {
            select: { lastSeen: true },
          },
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
      const deviceLastSeenMax = shop.agentDevices.reduce<Date | null>(
        (max, device) => {
          if (!device.lastSeen) return max;
          if (!max || device.lastSeen.getTime() > max.getTime()) {
            return device.lastSeen;
          }
          return max;
        },
        null,
      );
      const agent = getAdminAgentStatus({
        agentId: shop.agentId,
        agentLastSeen: shop.agentLastSeen,
        deviceLastSeenMax,
        hasAgentDevice: shop.agentDevices.length > 0,
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
      agentDevices: {
        select: { lastSeen: true },
      },
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
  const deviceLastSeenMax = shop.agentDevices.reduce<Date | null>(
    (max, device) => {
      if (!device.lastSeen) return max;
      if (!max || device.lastSeen.getTime() > max.getTime()) {
        return device.lastSeen;
      }
      return max;
    },
    null,
  );
  const agent = getAdminAgentStatus({
    agentId: shop.agentId,
    agentLastSeen: shop.agentLastSeen,
    deviceLastSeenMax,
    hasAgentDevice: shop.agentDevices.length > 0,
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

/**
 * Admin-only shop active flag. Does not touch subscription, billing, jobs, or devices.
 * A no-op request returns the current state and does not write an audit row.
 */
export async function setAdminShopActive(input: {
  adminUserId: string;
  shopId: string;
  body: unknown;
}): Promise<
  | { ok: true; shop: { id: string; isActive: boolean }; changed: boolean }
  | { ok: false; error: string; status: 400 | 404 }
> {
  const shopId = input.shopId.trim();
  if (!shopId) {
    return { ok: false, error: "Shop id is required.", status: 400 };
  }

  if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) {
    return { ok: false, error: "Invalid shop update.", status: 400 };
  }
  const raw = input.body as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== "isActive" || typeof raw.isActive !== "boolean") {
    return { ok: false, error: "Invalid shop update.", status: 400 };
  }
  const nextActive = raw.isActive;

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { id: true, isActive: true },
  });
  if (!shop) {
    return { ok: false, error: "Shop not found.", status: 404 };
  }

  if (shop.isActive === nextActive) {
    return {
      ok: true,
      shop: { id: shop.id, isActive: shop.isActive },
      changed: false,
    };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.shop.updateMany({
      where: { id: shop.id, isActive: shop.isActive },
      data: { isActive: nextActive },
    });
    if (changed.count === 0) {
      const current = await tx.shop.findUnique({
        where: { id: shop.id },
        select: { id: true, isActive: true },
      });
      return current ? { shop: current, changed: false } : null;
    }
    await recordAdminAudit(
      {
        adminUserId: input.adminUserId,
        action: nextActive ? "SHOP_REACTIVATED" : "SHOP_DEACTIVATED",
        targetType: "Shop",
        targetId: shop.id,
        before: { isActive: shop.isActive },
        after: { isActive: nextActive },
      },
      tx,
    );
    return {
      shop: { id: shop.id, isActive: nextActive },
      changed: true,
    };
  });

  if (!updated) {
    return { ok: false, error: "Shop not found.", status: 404 };
  }

  return { ok: true, shop: updated.shop, changed: updated.changed };
}

export const ADMIN_TRIAL_EXTENSION_MAX_DAYS = 365;
const TRIAL_EXTENSION_DAY_MS = 24 * 60 * 60 * 1000;

export type AdminTrialExtensionState = {
  plan: string;
  status: string;
  trialStartAt: string | null;
  trialEndAt: string | null;
};

function trialExtensionSnapshot(row: {
  plan: string;
  status: string;
  trialStartAt: Date | null;
  trialEndAt: Date | null;
}): AdminTrialExtensionState {
  return {
    plan: row.plan,
    status: row.status,
    trialStartAt: toIso(row.trialStartAt),
    trialEndAt: toIso(row.trialEndAt),
  };
}

/**
 * Body must be exactly `{ days: N }` where N is an integer from 1 through 365.
 * Strings, decimals, NaN, and Infinity are rejected.
 */
export function parseAdminTrialExtensionDays(
  body: unknown,
): { ok: true; days: number } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid trial extension." };
  }
  const raw = body as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== "days") {
    return { ok: false, error: "Invalid trial extension." };
  }
  const value = raw.days;
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isFinite(value)) {
    return { ok: false, error: "Enter a whole number of days." };
  }
  if (value < 1 || value > ADMIN_TRIAL_EXTENSION_MAX_DAYS) {
    return {
      ok: false,
      error: `Trial extension must be from 1 to ${ADMIN_TRIAL_EXTENSION_MAX_DAYS} days.`,
    };
  }
  return { ok: true, days: value };
}

function canExtendShopTrial(row: { plan: string; status: string }) {
  if (row.status === "TRIALING") return true;
  return row.status === "EXPIRED" && row.plan === "TRIAL";
}

/**
 * Extend one shop's trial. Does not create a subscription, change AdminSetting,
 * or rewrite payments, provider ids, paid periods, or cancellation fields.
 */
export async function extendAdminShopTrial(input: {
  adminUserId: string;
  shopId: string;
  body: unknown;
  now?: Date;
}): Promise<
  | { ok: true; days: number; before: AdminTrialExtensionState; after: AdminTrialExtensionState }
  | { ok: false; error: string; status: 400 | 404 }
> {
  const shopId = input.shopId.trim();
  if (!shopId) {
    return { ok: false, error: "Shop id is required.", status: 400 };
  }

  const parsed = parseAdminTrialExtensionDays(input.body);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, status: 400 };
  }

  const now = input.now ?? new Date();
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { id: true },
  });
  if (!shop) {
    return { ok: false, error: "Shop not found.", status: 404 };
  }

  const existing = await prisma.subscription.findUnique({
    where: { shopId: shop.id },
  });
  if (!existing) {
    return {
      ok: false,
      error: "This shop has no subscription, so the trial was not extended.",
      status: 400,
    };
  }
  if (!canExtendShopTrial(existing)) {
    return {
      ok: false,
      error: "Trial extension applies only to a trial subscription. Paid subscription data was not changed.",
      status: 400,
    };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.subscription.findUnique({
      where: { shopId: shop.id },
    });
    if (!current || !canExtendShopTrial(current)) {
      return null;
    }
    const stillActive =
      current.status === "TRIALING" &&
      current.trialEndAt != null &&
      current.trialEndAt.getTime() > now.getTime();
    const trialEndAt = new Date(
      (stillActive ? current.trialEndAt!.getTime() : now.getTime()) +
        parsed.days * TRIAL_EXTENSION_DAY_MS,
    );
    const status = current.status === "TRIALING" ? current.status : "TRIALING";
    const before = trialExtensionSnapshot(current);
    const saved = await tx.subscription.update({
      where: { id: current.id },
      data: {
        trialEndAt,
        status,
      },
    });
    const after = trialExtensionSnapshot(saved);
    await recordAdminAudit(
      {
        adminUserId: input.adminUserId,
        action: "SHOP_TRIAL_EXTENDED",
        targetType: "Shop",
        targetId: shop.id,
        before,
        after,
      },
      tx,
    );
    return { before, after };
  });

  if (!updated) {
    return {
      ok: false,
      error: "Trial extension applies only to a trial subscription. Paid subscription data was not changed.",
      status: 400,
    };
  }

  return { ok: true, days: parsed.days, before: updated.before, after: updated.after };
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

export const PERMANENT_SHOP_DELETE_BLOCKS = [
  "SHOP_ACTIVE",
  "SHOP_HAS_BILLING_PAYMENTS",
  "SHOP_HAS_COUPON",
  "SHOP_HAS_COUPON_REDEMPTION",
  "SHOP_HAS_PAID_SUBSCRIPTION",
  "SHOP_HAS_PROVIDER_IDENTITY",
  "OWNER_IS_ADMIN",
  "OWNER_HAS_ADMIN_AUDIT",
  "UNSAFE_SUBSCRIPTION",
] as const;

export type PermanentShopDeleteBlock = (typeof PERMANENT_SHOP_DELETE_BLOCKS)[number];

export type PermanentShopDeletePreview = {
  allowed: boolean;
  blockCode: PermanentShopDeleteBlock | null;
  printJobCount: number;
  submittedPageCount: number;
  totalPrintPrice: string;
};

type PermanentDeleteDb = Prisma.TransactionClient | typeof prisma;

type PermanentDeleteSubscription = {
  plan: string;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
  pastDueSince: Date | null;
  providerCustomerId: string | null;
  providerPlanId: string | null;
  providerSubscriptionId: string | null;
};

type PermanentDeleteSnapshot = {
  id: string;
  shopCode: string;
  shopName: string;
  isActive: boolean;
  owner: {
    id: string;
    email: string;
    role: string;
    auditCount: number;
  } | null;
  subscription: PermanentDeleteSubscription | null;
  billingPaymentCount: number;
  couponRedemptionCount: number;
  shopCouponCount: number;
  printJobCount: number;
  submittedPageCount: number;
  totalPrintPrice: string;
};

class PermanentShopDeleteRollback extends Error {
  constructor(readonly failure: { error: string; status: 404 | 409 }) {
    super(failure.error);
  }
}

function decimalString(value: unknown) {
  if (value == null) return "0.00";
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
  }
  if (
    typeof value === "object" &&
    "toFixed" in value &&
    typeof value.toFixed === "function"
  ) {
    return value.toFixed(2);
  }
  return "0.00";
}

function parsePermanentDeleteBody(
  body: unknown,
): { ok: true; confirmShopCode: string } | { ok: false } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false };
  }
  const raw = body as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== "confirmShopCode") {
    return { ok: false };
  }
  if (typeof raw.confirmShopCode !== "string" || raw.confirmShopCode.length === 0) {
    return { ok: false };
  }
  return { ok: true, confirmShopCode: raw.confirmShopCode };
}

function subscriptionDeleteBlock(
  subscription: PermanentDeleteSubscription | null,
): PermanentShopDeleteBlock | null {
  if (!subscription) return null;
  if (subscription.plan !== "TRIAL") return "SHOP_HAS_PAID_SUBSCRIPTION";
  if (subscription.currentPeriodStart || subscription.currentPeriodEnd) {
    return "SHOP_HAS_PAID_SUBSCRIPTION";
  }
  if (subscription.providerCustomerId || subscription.providerPlanId) {
    return "SHOP_HAS_PROVIDER_IDENTITY";
  }
  if (
    subscription.providerSubscriptionId &&
    !isCheckoutClaimId(subscription.providerSubscriptionId)
  ) {
    return "SHOP_HAS_PROVIDER_IDENTITY";
  }
  if (subscription.status !== "TRIALING" && subscription.status !== "EXPIRED") {
    return "UNSAFE_SUBSCRIPTION";
  }
  if (subscription.cancelledAt || subscription.pastDueSince) {
    return "UNSAFE_SUBSCRIPTION";
  }
  return null;
}

function permanentDeleteBlock(
  snapshot: PermanentDeleteSnapshot,
): PermanentShopDeleteBlock | null {
  if (snapshot.isActive) return "SHOP_ACTIVE";
  if (snapshot.couponRedemptionCount > 0) return "SHOP_HAS_COUPON_REDEMPTION";
  if (snapshot.billingPaymentCount > 0) return "SHOP_HAS_BILLING_PAYMENTS";
  if (snapshot.shopCouponCount > 0) return "SHOP_HAS_COUPON";
  const subscriptionBlock = subscriptionDeleteBlock(snapshot.subscription);
  if (subscriptionBlock) return subscriptionBlock;
  if (!snapshot.owner) return null;
  if (snapshot.owner.role !== "SHOPKEEPER") return "OWNER_IS_ADMIN";
  if (snapshot.owner.auditCount > 0) return "OWNER_HAS_ADMIN_AUDIT";
  return null;
}

function toPermanentDeletePreview(
  snapshot: PermanentDeleteSnapshot,
): PermanentShopDeletePreview {
  const blockCode = permanentDeleteBlock(snapshot);
  return {
    allowed: blockCode == null,
    blockCode,
    printJobCount: snapshot.printJobCount,
    submittedPageCount: snapshot.submittedPageCount,
    totalPrintPrice: snapshot.totalPrintPrice,
  };
}

async function loadPermanentDeleteSnapshot(
  db: PermanentDeleteDb,
  shopId: string,
): Promise<PermanentDeleteSnapshot | null> {
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopCode: true,
      shopName: true,
      isActive: true,
      owner: {
        select: {
          id: true,
          email: true,
          role: true,
        },
      },
      subscription: {
        select: {
          plan: true,
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          cancelledAt: true,
          pastDueSince: true,
          providerCustomerId: true,
          providerPlanId: true,
          providerSubscriptionId: true,
        },
      },
    },
  });
  if (!shop) return null;

  const [billingPaymentCount, couponRedemptionCount, shopCouponCount, printAgg, auditCount] =
    await Promise.all([
      db.billingPayment.count({ where: { shopId: shop.id } }),
      db.couponRedemption.count({ where: { shopId: shop.id } }),
      db.coupon.count({ where: { shopId: shop.id } }),
      db.printJob.aggregate({
        where: { shopId: shop.id },
        _count: { _all: true },
        _sum: { totalPages: true, totalPrice: true },
      }),
      shop.owner
        ? db.adminAuditLog.count({ where: { adminUserId: shop.owner.id } })
        : Promise.resolve(0),
    ]);

  return {
    id: shop.id,
    shopCode: shop.shopCode,
    shopName: shop.shopName,
    isActive: shop.isActive,
    owner: shop.owner
      ? {
          id: shop.owner.id,
          email: shop.owner.email,
          role: shop.owner.role,
          auditCount,
        }
      : null,
    subscription: shop.subscription,
    billingPaymentCount,
    couponRedemptionCount,
    shopCouponCount,
    printJobCount: printAgg._count._all,
    submittedPageCount: printAgg._sum.totalPages ?? 0,
    totalPrintPrice: decimalString(printAgg._sum.totalPrice),
  };
}

export async function getPermanentShopDeletePreview(
  shopId: string,
): Promise<PermanentShopDeletePreview | null> {
  const snapshot = await loadPermanentDeleteSnapshot(prisma, shopId.trim());
  if (!snapshot) return null;
  return toPermanentDeletePreview(snapshot);
}

/**
 * Permanently delete one deactivated test shop.
 * Does not change deactivate/reactivate, coupons, billing rows, or platform settings.
 * Upload files are removed only after the database transaction commits.
 */
export async function permanentlyDeleteAdminShop(input: {
  adminUserId: string;
  shopId: string;
  body: unknown;
}): Promise<
  | { ok: true; shopId: string; shopCode: string }
  | { ok: false; error: string; status: 404 | 409 }
> {
  const shopId = input.shopId.trim();
  if (!shopId) {
    return { ok: false, error: "CONFIRMATION_REQUIRED", status: 409 };
  }

  const parsed = parsePermanentDeleteBody(input.body);
  if (!parsed.ok) {
    return { ok: false, error: "CONFIRMATION_REQUIRED", status: 409 };
  }

  let committed: { shopId: string; shopCode: string; files: string[] };
  try {
    committed = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM Shop WHERE id = ${shopId} FOR UPDATE
      `;
      if (!Array.isArray(locked) || locked.length !== 1) {
        throw new PermanentShopDeleteRollback({
          error: "Shop not found.",
          status: 404,
        });
      }

      const snapshot = await loadPermanentDeleteSnapshot(tx, shopId);
      if (!snapshot) {
        throw new PermanentShopDeleteRollback({
          error: "Shop not found.",
          status: 404,
        });
      }
      if (parsed.confirmShopCode !== snapshot.shopCode) {
        throw new PermanentShopDeleteRollback({
          error: "CONFIRMATION_MISMATCH",
          status: 409,
        });
      }
      const block = permanentDeleteBlock(snapshot);
      if (block) {
        throw new PermanentShopDeleteRollback({ error: block, status: 409 });
      }

      const fileRows = await tx.printJobFile.findMany({
        where: {
          fileDeletedAt: null,
          printJob: { shopId: snapshot.id },
        },
        select: { storedFileName: true },
      });
      const files = [...new Set(fileRows.map((row) => row.storedFileName))];

      await recordAdminAudit(
        {
          adminUserId: input.adminUserId,
          action: "SHOP_PERMANENTLY_DELETED",
          targetType: "Shop",
          targetId: snapshot.id,
          before: {
            shopCode: snapshot.shopCode,
            shopName: snapshot.shopName,
            ownerEmail: snapshot.owner?.email ?? null,
            counts: {
              printJobs: snapshot.printJobCount,
              submittedPages: snapshot.submittedPageCount,
              totalPrintPrice: snapshot.totalPrintPrice,
              billingPayments: snapshot.billingPaymentCount,
              couponRedemptions: snapshot.couponRedemptionCount,
              shopCoupons: snapshot.shopCouponCount,
            },
          },
          after: { deleted: true },
        },
        tx,
      );

      const removedShop = await tx.shop.deleteMany({
        where: { id: snapshot.id },
      });
      if (removedShop.count !== 1) {
        throw new PermanentShopDeleteRollback({
          error: "Shop not found.",
          status: 404,
        });
      }

      if (snapshot.owner) {
        const owner = await tx.user.findUnique({
          where: { id: snapshot.owner.id },
          select: { id: true, role: true },
        });
        const auditCount = owner
          ? await tx.adminAuditLog.count({ where: { adminUserId: owner.id } })
          : 0;
        if (!owner || owner.role !== "SHOPKEEPER") {
          throw new PermanentShopDeleteRollback({
            error: "OWNER_IS_ADMIN",
            status: 409,
          });
        }
        if (auditCount > 0) {
          throw new PermanentShopDeleteRollback({
            error: "OWNER_HAS_ADMIN_AUDIT",
            status: 409,
          });
        }
        const removedUser = await tx.user.deleteMany({
          where: { id: owner.id, role: "SHOPKEEPER" },
        });
        if (removedUser.count !== 1) {
          throw new PermanentShopDeleteRollback({
            error: "Shop not found.",
            status: 404,
          });
        }
      }

      return { shopId: snapshot.id, shopCode: snapshot.shopCode, files };
    });
  } catch (error) {
    if (error instanceof PermanentShopDeleteRollback) {
      return { ok: false, error: error.failure.error, status: error.failure.status };
    }
    throw error;
  }

  for (const storedFileName of committed.files) {
    await deleteStoredUploadFile(storedFileName);
  }

  return { ok: true, shopId: committed.shopId, shopCode: committed.shopCode };
}
