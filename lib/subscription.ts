import type {
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { addMonths } from "@/lib/cashfree";

export const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const PAST_DUE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export type ShopSubscription = Subscription;

export type SubscriptionAccess = {
  hasAccess: boolean;
  reason:
    | "trialing"
    | "active"
    | "cancelled_until_period_end"
    | "past_due_grace"
    | "past_due_expired"
    | "trial_expired"
    | "expired"
    | "cancelled"
    | "missing";
  isGracePeriod: boolean;
};

export type PublicSubscriptionView = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trialStartAt: string | null;
  trialEndAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  daysRemaining: number | null;
  hasAccess: boolean;
  label: string;
  detail: string;
};

function addDays(from: Date, days: number) {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function buildTrialWindow(from: Date = new Date()) {
  const trialStartAt = from;
  const trialEndAt = addDays(from, 7);
  return { trialStartAt, trialEndAt };
}

export function createTrialSubscriptionData(shopId: string, from: Date = new Date()) {
  const { trialStartAt, trialEndAt } = buildTrialWindow(from);
  return {
    shopId,
    plan: "TRIAL" as const,
    status: "TRIALING" as const,
    trialStartAt,
    trialEndAt,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    pastDueSince: null,
    provider: null,
    providerCustomerId: null,
    providerSubscriptionId: null,
    providerPlanId: null,
  };
}

/** Nested Prisma create under Shop — shopId is inferred from the parent. */
export function createNestedTrialSubscription(from: Date = new Date()) {
  const { shopId: _ignored, ...data } = createTrialSubscriptionData("unused", from);
  void _ignored;
  return data;
}

export async function getShopSubscription(shopId: string) {
  return prisma.subscription.findUnique({
    where: { shopId },
  });
}

export async function getSubscriptionByProviderId(providerSubscriptionId: string) {
  return prisma.subscription.findFirst({
    where: {
      provider: "CASHFREE",
      providerSubscriptionId,
    },
  });
}

export function isTrialActive(
  subscription: Pick<ShopSubscription, "status" | "trialEndAt"> | null | undefined,
  now: Date = new Date(),
) {
  if (!subscription) return false;
  if (subscription.status !== "TRIALING") return false;
  if (!subscription.trialEndAt) return false;
  return subscription.trialEndAt.getTime() > now.getTime();
}

export function isSubscriptionActive(
  subscription: Pick<ShopSubscription, "status"> | null | undefined,
) {
  return subscription?.status === "ACTIVE";
}

/**
 * Application access decision. Database subscription is the source of truth.
 *
 * PAST_DUE grace: 3 days from pastDueSince (falls back to updatedAt if missing).
 */
export function getSubscriptionAccess(
  subscription: ShopSubscription | null | undefined,
  now: Date = new Date(),
): SubscriptionAccess {
  if (!subscription) {
    return { hasAccess: false, reason: "missing", isGracePeriod: false };
  }

  if (subscription.status === "TRIALING") {
    if (subscription.trialEndAt && subscription.trialEndAt.getTime() > now.getTime()) {
      return { hasAccess: true, reason: "trialing", isGracePeriod: false };
    }
    return { hasAccess: false, reason: "trial_expired", isGracePeriod: false };
  }

  if (subscription.status === "ACTIVE") {
    if (
      subscription.cancelAtPeriodEnd &&
      subscription.currentPeriodEnd &&
      subscription.currentPeriodEnd.getTime() <= now.getTime()
    ) {
      return { hasAccess: false, reason: "cancelled", isGracePeriod: false };
    }
    return { hasAccess: true, reason: "active", isGracePeriod: false };
  }

  if (subscription.status === "PAST_DUE") {
    const since =
      subscription.pastDueSince ||
      subscription.updatedAt ||
      subscription.createdAt;
    const graceEnds = since.getTime() + PAST_DUE_GRACE_MS;
    if (now.getTime() <= graceEnds) {
      return { hasAccess: true, reason: "past_due_grace", isGracePeriod: true };
    }
    return { hasAccess: false, reason: "past_due_expired", isGracePeriod: false };
  }

  if (subscription.status === "CANCELLED") {
    if (
      subscription.currentPeriodEnd &&
      subscription.currentPeriodEnd.getTime() > now.getTime()
    ) {
      return {
        hasAccess: true,
        reason: "cancelled_until_period_end",
        isGracePeriod: false,
      };
    }
    return { hasAccess: false, reason: "cancelled", isGracePeriod: false };
  }

  return { hasAccess: false, reason: "expired", isGracePeriod: false };
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function daysUntil(target: Date | null | undefined, now: Date) {
  if (!target) return null;
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function toPublicSubscriptionView(
  subscription: ShopSubscription | null | undefined,
  now: Date = new Date(),
): PublicSubscriptionView | null {
  if (!subscription) return null;

  const access = getSubscriptionAccess(subscription, now);
  let daysRemaining: number | null = null;
  let label = "Subscription";
  let detail = "";

  if (subscription.status === "TRIALING") {
    daysRemaining = daysUntil(subscription.trialEndAt, now);
    if (access.hasAccess) {
      label = "7-DAY FREE TRIAL";
      detail =
        daysRemaining === 1
          ? "1 day remaining"
          : `${daysRemaining ?? 0} days remaining`;
    } else {
      label = "Trial ended";
      detail = "Subscribe to continue";
      daysRemaining = 0;
    }
  } else if (subscription.status === "ACTIVE") {
    daysRemaining = daysUntil(subscription.currentPeriodEnd, now);
    label = "PREMIUM";
    if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd) {
      detail = `Cancels at period end · Access until ${subscription.currentPeriodEnd.toLocaleDateString(
        "en-IN",
        { day: "numeric", month: "short", year: "numeric" },
      )}`;
    } else {
      detail = subscription.currentPeriodEnd
        ? `Active · Next billing date: ${subscription.currentPeriodEnd.toLocaleDateString(
            "en-IN",
            { day: "numeric", month: "short", year: "numeric" },
          )}`
        : "Active";
    }
  } else if (subscription.status === "CANCELLED") {
    label = "SUBSCRIPTION CANCELLED";
    detail = access.hasAccess
      ? `Access until: ${subscription.currentPeriodEnd?.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}`
      : "Subscribe to continue";
    daysRemaining = daysUntil(subscription.currentPeriodEnd, now);
  } else if (subscription.status === "PAST_DUE") {
    label = "PAYMENT ISSUE";
    const since =
      subscription.pastDueSince ||
      subscription.updatedAt ||
      subscription.createdAt;
    const graceEnd = new Date(since.getTime() + PAST_DUE_GRACE_MS);
    daysRemaining = daysUntil(graceEnd, now);
    detail = access.hasAccess
      ? `Your payment needs attention. Grace period: ${daysRemaining ?? 0} day${
          daysRemaining === 1 ? "" : "s"
        } remaining`
      : "Grace period ended. Subscribe to continue.";
  } else {
    label = "Expired";
    detail = "Subscribe to continue";
    daysRemaining = 0;
  }

  return {
    plan: subscription.plan,
    status: subscription.status,
    trialStartAt: toIso(subscription.trialStartAt),
    trialEndAt: toIso(subscription.trialEndAt),
    currentPeriodStart: toIso(subscription.currentPeriodStart),
    currentPeriodEnd: toIso(subscription.currentPeriodEnd),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    pastDueSince: toIso(subscription.pastDueSince),
    daysRemaining,
    hasAccess: access.hasAccess,
    label,
    detail,
  };
}

export function canInitiatePremiumCheckout(
  subscription: ShopSubscription | null | undefined,
) {
  if (!subscription) return { ok: false as const, error: "Subscription not found." };
  if (subscription.status === "ACTIVE" && !subscription.cancelAtPeriodEnd) {
    return { ok: false as const, error: "This shop already has an active Premium subscription." };
  }
  return { ok: true as const };
}

export async function markSubscriptionPremiumActive(input: {
  subscriptionId: string;
  providerSubscriptionId: string;
  providerCustomerId?: string | null;
  providerPlanId?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  now?: Date;
}) {
  const now = input.now || new Date();
  const periodStart = input.currentPeriodStart || now;
  const periodEnd = input.currentPeriodEnd || addMonths(periodStart, 1);

  return prisma.subscription.update({
    where: { id: input.subscriptionId },
    data: {
      plan: "PREMIUM",
      status: "ACTIVE",
      provider: "CASHFREE",
      providerSubscriptionId: input.providerSubscriptionId,
      providerCustomerId: input.providerCustomerId ?? undefined,
      providerPlanId: input.providerPlanId ?? undefined,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      pastDueSince: null,
    },
  });
}

export async function markSubscriptionPastDue(input: {
  subscriptionId: string;
  now?: Date;
}) {
  const now = input.now || new Date();
  const existing = await prisma.subscription.findUnique({
    where: { id: input.subscriptionId },
  });
  if (!existing) return null;

  return prisma.subscription.update({
    where: { id: input.subscriptionId },
    data: {
      status: "PAST_DUE",
      pastDueSince: existing.pastDueSince || now,
    },
  });
}

export async function markSubscriptionCancelAtPeriodEnd(input: {
  subscriptionId: string;
  currentPeriodEnd?: Date | null;
  now?: Date;
}) {
  const now = input.now || new Date();
  return prisma.subscription.update({
    where: { id: input.subscriptionId },
    data: {
      cancelAtPeriodEnd: true,
      cancelledAt: now,
      currentPeriodEnd: input.currentPeriodEnd ?? undefined,
      // Keep ACTIVE until period end when still within paid window.
      status: "ACTIVE",
    },
  });
}

export async function markSubscriptionCancelled(input: {
  subscriptionId: string;
  now?: Date;
}) {
  const now = input.now || new Date();
  return prisma.subscription.update({
    where: { id: input.subscriptionId },
    data: {
      status: "CANCELLED",
      cancelAtPeriodEnd: false,
      cancelledAt: now,
    },
  });
}

export async function markSubscriptionExpired(input: { subscriptionId: string }) {
  return prisma.subscription.update({
    where: { id: input.subscriptionId },
    data: {
      status: "EXPIRED",
      cancelAtPeriodEnd: false,
    },
  });
}
