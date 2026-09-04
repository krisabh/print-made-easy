import type {
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@prisma/client";

import { addMonths, cancelCashfreeSubscription } from "@/lib/cashfree";
import { PREMIUM_PLAN } from "@/lib/billing/plan";
import { prisma } from "@/lib/prisma";

export const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const PAST_DUE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** Temporary claim written to providerSubscriptionId while Cashfree checkout is created. */
export const CHECKOUT_CLAIM_PREFIX = "PENDING-CHECKOUT:";
export const CHECKOUT_CLAIM_TTL_MS = 3 * 60 * 1000;

export type ShopSubscription = Subscription;

export type SubscriptionAccessReason =
  | "trialing"
  | "active"
  | "cancelled_until_period_end"
  | "past_due_grace"
  | "past_due_expired"
  | "trial_expired"
  | "expired"
  | "cancelled"
  | "missing";

/** Low-level access decision from a subscription row + clock. */
export type SubscriptionAccess = {
  hasAccess: boolean;
  reason: SubscriptionAccessReason;
  isGracePeriod: boolean;
};

/**
 * Normalized access object for application use.
 * Never includes Cashfree secrets or sensitive provider fields.
 */
export type SubscriptionAccessState = {
  hasAccess: boolean;
  plan: SubscriptionPlan | null;
  status: SubscriptionStatus | null;
  label: string;
  detail: string;
  daysRemaining: number | null;
  trialEndAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  isPastDue: boolean;
  isExpired: boolean;
  isGracePeriod: boolean;
  reason: SubscriptionAccessReason;
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
  isPastDue: boolean;
  isExpired: boolean;
  canSubscribe: boolean;
  canCancel: boolean;
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
 * Application access decision. Time-based — does not require a cron/DB cleanup.
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
    if (subscription.cancelAtPeriodEnd) {
      // Scheduled cancellation: keep Premium only while the paid period is open.
      if (
        !subscription.currentPeriodEnd ||
        subscription.currentPeriodEnd.getTime() <= now.getTime()
      ) {
        return { hasAccess: false, reason: "cancelled", isGracePeriod: false };
      }
      return {
        hasAccess: true,
        reason: "cancelled_until_period_end",
        isGracePeriod: false,
      };
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

function formatDateIn(value: Date | null | undefined) {
  if (!value) return null;
  return value.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function graceEndDate(subscription: ShopSubscription) {
  const since =
    subscription.pastDueSince ||
    subscription.updatedAt ||
    subscription.createdAt;
  return new Date(since.getTime() + PAST_DUE_GRACE_MS);
}

function buildLabels(
  subscription: ShopSubscription,
  access: SubscriptionAccess,
  now: Date,
): { label: string; detail: string; daysRemaining: number | null } {
  let daysRemaining: number | null = null;
  let label = "Subscription";
  let detail = "";

  if (subscription.status === "TRIALING") {
    daysRemaining = daysUntil(subscription.trialEndAt, now);
    if (access.hasAccess) {
      label = "7-Day Free Trial";
      detail =
        daysRemaining === 1
          ? "1 day remaining"
          : `${daysRemaining ?? 0} days remaining`;
    } else {
      label = "Your free trial has ended";
      detail = "Subscribe to continue using PrintMadeEasy.";
      daysRemaining = 0;
    }
  } else if (subscription.status === "ACTIVE") {
    daysRemaining = daysUntil(subscription.currentPeriodEnd, now);
    label = "Premium";
    if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd) {
      detail = `Cancellation scheduled. Premium remains active until ${formatDateIn(subscription.currentPeriodEnd)}. No further renewal.`;
    } else {
      detail = subscription.currentPeriodEnd
        ? `₹${PREMIUM_PLAN.amountInr}/month · Current period ends ${formatDateIn(subscription.currentPeriodEnd)}`
        : `₹${PREMIUM_PLAN.amountInr}/month`;
    }
  } else if (subscription.status === "CANCELLED") {
    if (access.hasAccess && subscription.currentPeriodEnd) {
      label = "Cancelled";
      detail = `Cancellation scheduled. Premium remains active until ${formatDateIn(subscription.currentPeriodEnd)}. No further renewal.`;
      daysRemaining = daysUntil(subscription.currentPeriodEnd, now);
    } else {
      label = "Subscription expired";
      detail = "Subscribe again to restore access.";
      daysRemaining = 0;
    }
  } else if (subscription.status === "PAST_DUE") {
    label = access.hasAccess ? "Payment issue" : "Payment required";
    const graceEnd = graceEndDate(subscription);
    daysRemaining = daysUntil(graceEnd, now);
    if (access.hasAccess) {
      detail = `Your payment could not be completed. Access remains available during the 3-day grace period (until ${formatDateIn(graceEnd)}).`;
    } else {
      detail =
        "Your recurring Premium payment failed and the 3-day grace period has ended. Restore payment to unlock printing again.";
      daysRemaining = 0;
    }
  } else {
    label = "Subscription expired";
    detail = "Subscribe again to restore access.";
    daysRemaining = 0;
  }

  return { label, detail, daysRemaining };
}

export function toPublicSubscriptionView(
  subscription: ShopSubscription | null | undefined,
  now: Date = new Date(),
): PublicSubscriptionView | null {
  if (!subscription) return null;

  const access = getSubscriptionAccess(subscription, now);
  const { label, detail, daysRemaining } = buildLabels(subscription, access, now);
  const checkout = canInitiatePremiumCheckout(subscription, now);
  const cancel = canCancelSubscription(subscription, now);

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
    isPastDue: subscription.status === "PAST_DUE",
    isExpired: !access.hasAccess,
    canSubscribe: checkout.ok,
    canCancel: cancel.ok,
  };
}

/** Build normalized access state for a loaded subscription (or missing). */
export function buildSubscriptionAccessState(
  subscription: ShopSubscription | null | undefined,
  now: Date = new Date(),
): SubscriptionAccessState {
  const access = getSubscriptionAccess(subscription, now);
  if (!subscription) {
    return {
      hasAccess: false,
      plan: null,
      status: null,
      label: "Subscription expired",
      detail: "Subscribe again to restore access.",
      daysRemaining: null,
      trialEndAt: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      isPastDue: false,
      isExpired: true,
      isGracePeriod: false,
      reason: "missing",
    };
  }

  const { label, detail, daysRemaining } = buildLabels(subscription, access, now);
  return {
    hasAccess: access.hasAccess,
    plan: subscription.plan,
    status: subscription.status,
    label,
    detail,
    daysRemaining,
    trialEndAt: toIso(subscription.trialEndAt),
    currentPeriodEnd: toIso(subscription.currentPeriodEnd),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    isPastDue: subscription.status === "PAST_DUE",
    isExpired: !access.hasAccess,
    isGracePeriod: access.isGracePeriod,
    reason: access.reason,
  };
}

/** Load shop subscription and return normalized access (session shopId only). */
export async function getSubscriptionAccessForShop(
  shopId: string,
  now: Date = new Date(),
): Promise<SubscriptionAccessState> {
  const subscription = await getShopSubscription(shopId);
  return buildSubscriptionAccessState(subscription, now);
}

export async function hasSubscriptionAccess(
  shopId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const state = await getSubscriptionAccessForShop(shopId, now);
  return state.hasAccess;
}

/**
 * Require product access for a shop. Returns the access state when allowed;
 * returns null when denied (caller should redirect / 402).
 */
export async function requireSubscriptionAccess(
  shopId: string,
  now: Date = new Date(),
): Promise<SubscriptionAccessState | null> {
  const state = await getSubscriptionAccessForShop(shopId, now);
  return state.hasAccess ? state : null;
}

/**
 * Optional DB sync helper (job-compatible). Access remains correct without this
 * because getSubscriptionAccess is time-based.
 */
export async function syncSubscriptionExpiryIfNeeded(
  shopId: string,
  now: Date = new Date(),
) {
  const subscription = await getShopSubscription(shopId);
  if (!subscription) return null;

  const access = getSubscriptionAccess(subscription, now);
  if (access.hasAccess) return subscription;

  if (
    access.reason === "trial_expired" &&
    subscription.status === "TRIALING"
  ) {
    return markSubscriptionExpired({ subscriptionId: subscription.id });
  }
  if (
    (access.reason === "cancelled" || access.reason === "expired") &&
    (subscription.status === "CANCELLED" ||
      (subscription.status === "ACTIVE" && subscription.cancelAtPeriodEnd))
  ) {
    return markSubscriptionExpired({ subscriptionId: subscription.id });
  }
  if (
    access.reason === "past_due_expired" &&
    subscription.status === "PAST_DUE"
  ) {
    return markSubscriptionExpired({ subscriptionId: subscription.id });
  }
  return subscription;
}

export function canInitiatePremiumCheckout(
  subscription: ShopSubscription | null | undefined,
  now: Date = new Date(),
) {
  if (!subscription) {
    return { ok: false as const, error: "Subscription not found." };
  }

  const access = getSubscriptionAccess(subscription, now);

  if (subscription.status === "ACTIVE") {
    if (
      subscription.cancelAtPeriodEnd &&
      subscription.currentPeriodEnd &&
      subscription.currentPeriodEnd.getTime() > now.getTime()
    ) {
      return {
        ok: false as const,
        error: `Premium remains active until ${formatDateIn(subscription.currentPeriodEnd)}.`,
      };
    }
    if (access.hasAccess) {
      return {
        ok: false as const,
        error: "This shop already has an active Premium subscription.",
      };
    }
  }

  if (subscription.status === "CANCELLED" && access.hasAccess) {
    return {
      ok: false as const,
      error: `Premium remains active until ${formatDateIn(subscription.currentPeriodEnd)}.`,
    };
  }

  if (subscription.status === "PAST_DUE" && access.hasAccess) {
    return {
      ok: false as const,
      error:
        "There is a payment issue on your current subscription. Access continues during the grace period.",
    };
  }

  if (subscription.status === "TRIALING" && access.hasAccess) {
    // Allow upgrading from an active trial to Premium.
    return { ok: true as const };
  }

  // Expired trial, expired premium, past-due after grace, missing period → allow.
  if (!access.hasAccess) {
    return { ok: true as const };
  }

  return { ok: true as const };
}

export function isCheckoutClaimId(providerSubscriptionId: string | null | undefined) {
  return Boolean(providerSubscriptionId?.startsWith(CHECKOUT_CLAIM_PREFIX));
}

export function isFreshCheckoutClaim(
  subscription: ShopSubscription,
  now: Date = new Date(),
) {
  if (!isCheckoutClaimId(subscription.providerSubscriptionId)) return false;
  return now.getTime() - subscription.updatedAt.getTime() < CHECKOUT_CLAIM_TTL_MS;
}

/**
 * Best-effort cancel of a previous non-active Cashfree subscription id.
 * Never cancels when the shop already has usable Premium access.
 */
export async function abandonPendingCashfreeCheckout(input: {
  subscription: ShopSubscription;
  now?: Date;
  cancelProvider?: typeof cancelCashfreeSubscription;
}) {
  const now = input.now || new Date();
  const subscription = input.subscription;
  const access = getSubscriptionAccess(subscription, now);

  if (subscription.status === "ACTIVE" && access.hasAccess) {
    return { abandoned: false as const, reason: "active" as const };
  }
  if (access.hasAccess && subscription.cancelAtPeriodEnd) {
    return { abandoned: false as const, reason: "cancel_at_period_end" as const };
  }

  const providerId = subscription.providerSubscriptionId?.trim() || "";
  if (!providerId || isCheckoutClaimId(providerId)) {
    return { abandoned: false as const, reason: "none" as const };
  }

  const cancelFn = input.cancelProvider || cancelCashfreeSubscription;
  try {
    await cancelFn({ subscriptionId: providerId });
    return {
      abandoned: true as const,
      reason: "cancelled" as const,
      previousId: providerId,
    };
  } catch {
    // Previous checkout may already be cancelled/expired — allow a new create.
    console.warn("abandonPendingCashfreeCheckout: cancel failed (continuing)");
    return {
      abandoned: false as const,
      reason: "cancel_failed" as const,
      previousId: providerId,
    };
  }
}

/**
 * Claim the shop subscription row for a new checkout attempt.
 * Serializes concurrent Subscribe clicks via SELECT FOR UPDATE + claim token.
 */
export async function claimPremiumCheckoutSlot(input: {
  shopId: string;
  now?: Date;
}): Promise<
  | {
      ok: true;
      subscription: ShopSubscription;
      previousProviderSubscriptionId: string | null;
      claimToken: string;
    }
  | { ok: false; error: string; status: 404 | 409 }
> {
  const now = input.now || new Date();
  const claimToken = `${CHECKOUT_CLAIM_PREFIX}${now.getTime()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM Subscription WHERE shopId = ${input.shopId} FOR UPDATE
        `;

        const subscription = await tx.subscription.findUnique({
          where: { shopId: input.shopId },
        });
        if (!subscription) {
          return {
            ok: false as const,
            error: "Subscription not found.",
            status: 404 as const,
          };
        }

        const gate = canInitiatePremiumCheckout(subscription, now);
        if (!gate.ok) {
          return {
            ok: false as const,
            error: gate.error,
            status: 409 as const,
          };
        }

        if (isFreshCheckoutClaim(subscription, now)) {
          return {
            ok: false as const,
            error:
              "A checkout is already in progress for this shop. Please wait a moment and try again.",
            status: 409 as const,
          };
        }

        const previousProviderSubscriptionId = isCheckoutClaimId(
          subscription.providerSubscriptionId,
        )
          ? null
          : subscription.providerSubscriptionId;

        const claimed = await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            provider: "CASHFREE",
            providerSubscriptionId: claimToken,
          },
        });

        return {
          ok: true as const,
          subscription: claimed,
          previousProviderSubscriptionId,
          claimToken,
        };
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
  } catch {
    return {
      ok: false as const,
      error: "Unable to start checkout. Please try again.",
      status: 409 as const,
    };
  }
}

export async function finalizePremiumCheckoutClaim(input: {
  subscriptionId: string;
  claimToken: string;
  providerSubscriptionId: string;
  providerCustomerId?: string | null;
  providerPlanId?: string | null;
}) {
  return prisma.subscription.updateMany({
    where: {
      id: input.subscriptionId,
      providerSubscriptionId: input.claimToken,
      status: { not: "ACTIVE" },
    },
    data: {
      provider: "CASHFREE",
      providerSubscriptionId: input.providerSubscriptionId,
      providerCustomerId: input.providerCustomerId ?? undefined,
      providerPlanId: input.providerPlanId ?? undefined,
    },
  });
}

export async function releasePremiumCheckoutClaim(input: {
  subscriptionId: string;
  claimToken: string;
  restoreProviderSubscriptionId?: string | null;
}) {
  return prisma.subscription.updateMany({
    where: {
      id: input.subscriptionId,
      providerSubscriptionId: input.claimToken,
      status: { not: "ACTIVE" },
    },
    data: {
      providerSubscriptionId: input.restoreProviderSubscriptionId ?? null,
      provider: input.restoreProviderSubscriptionId ? "CASHFREE" : null,
    },
  });
}

export function canCancelSubscription(
  subscription: ShopSubscription | null | undefined,
  now: Date = new Date(),
) {
  if (!subscription) {
    return { ok: false as const, error: "Subscription not found." };
  }

  if (subscription.status !== "ACTIVE" && subscription.status !== "PAST_DUE") {
    return {
      ok: false as const,
      error: "Only an active Premium subscription can be cancelled.",
    };
  }

  if (subscription.cancelAtPeriodEnd) {
    return {
      ok: false as const,
      error: "Cancellation is already scheduled for the end of the billing period.",
    };
  }

  if (!subscription.providerSubscriptionId || isCheckoutClaimId(subscription.providerSubscriptionId)) {
    return {
      ok: false as const,
      error: "No Cashfree subscription is linked to cancel.",
    };
  }

  const access = getSubscriptionAccess(subscription, now);
  if (!access.hasAccess) {
    return { ok: false as const, error: "Subscription is not active." };
  }

  return { ok: true as const };
}

/**
 * Cancel the authenticated shop's Cashfree subscription at period end.
 * Never accepts a client-supplied shopId — caller must pass session shop id.
 */
export async function cancelShopSubscription(input: {
  shopId: string;
  now?: Date;
  /** Inject for tests — skips live Cashfree when provided. */
  cancelProvider?: typeof cancelCashfreeSubscription;
}) {
  const now = input.now || new Date();
  const subscription = await getShopSubscription(input.shopId);
  const gate = canCancelSubscription(subscription, now);
  if (!gate.ok || !subscription) {
    return { ok: false as const, error: gate.error || "Subscription not found." };
  }

  const providerId = subscription.providerSubscriptionId!;
  const cancelFn = input.cancelProvider || cancelCashfreeSubscription;

  try {
    await cancelFn({ subscriptionId: providerId });
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Unable to cancel Cashfree subscription.",
    };
  }

  const updated = await markSubscriptionCancelAtPeriodEnd({
    subscriptionId: subscription.id,
    currentPeriodEnd: subscription.currentPeriodEnd,
    now,
  });
  if (!updated) {
    return { ok: false as const, error: "Subscription not found." };
  }

  return {
    ok: true as const,
    subscription: updated,
    view: toPublicSubscriptionView(updated, now),
  };
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

  // Recurring failure only applies to billable Premium states.
  // Never reopen cancelled/expired/trial rows from a failure webhook.
  if (existing.status !== "ACTIVE" && existing.status !== "PAST_DUE") {
    return existing;
  }

  // Already scheduled to end — keep cancel-at-period-end access window.
  if (existing.cancelAtPeriodEnd) {
    return existing;
  }

  return prisma.subscription.update({
    where: { id: input.subscriptionId },
    data: {
      status: "PAST_DUE",
      // Preserve the original grace clock across duplicate failure webhooks.
      pastDueSince: existing.pastDueSince || now,
    },
  });
}

function resolveCancelPeriodEnd(input: {
  existing: ShopSubscription;
  currentPeriodEnd?: Date | null;
  now: Date;
}) {
  if (input.currentPeriodEnd && !Number.isNaN(input.currentPeriodEnd.getTime())) {
    return input.currentPeriodEnd;
  }
  if (
    input.existing.currentPeriodEnd &&
    !Number.isNaN(input.existing.currentPeriodEnd.getTime())
  ) {
    return input.existing.currentPeriodEnd;
  }
  if (
    input.existing.currentPeriodStart &&
    !Number.isNaN(input.existing.currentPeriodStart.getTime())
  ) {
    return addMonths(input.existing.currentPeriodStart, 1);
  }
  return addMonths(input.now, 1);
}

export async function markSubscriptionCancelAtPeriodEnd(input: {
  subscriptionId: string;
  currentPeriodEnd?: Date | null;
  now?: Date;
}) {
  const now = input.now || new Date();
  const existing = await prisma.subscription.findUnique({
    where: { id: input.subscriptionId },
  });
  if (!existing) return null;

  const periodEnd = resolveCancelPeriodEnd({
    existing,
    currentPeriodEnd: input.currentPeriodEnd,
    now,
  });

  return prisma.subscription.update({
    where: { id: input.subscriptionId },
    data: {
      cancelAtPeriodEnd: true,
      cancelledAt: existing.cancelledAt || now,
      currentPeriodEnd: periodEnd,
      pastDueSince: null,
      // Keep ACTIVE until period end when still within paid window.
      status: "ACTIVE",
      plan: existing.plan === "PREMIUM" ? "PREMIUM" : existing.plan,
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

/** Concise copy for the dashboard subscription card (not for authorization). */
export function getDashboardSubscriptionSummary(
  view: PublicSubscriptionView | null,
): { title: string; subtitle: string } {
  if (!view) {
    return {
      title: "Subscription expired",
      subtitle: "Subscribe to restore access",
    };
  }

  if (view.status === "TRIALING" && view.hasAccess) {
    const days = view.daysRemaining ?? 0;
    return {
      title: "Free Trial",
      subtitle:
        days === 1 ? "1 day remaining" : `${days} days remaining`,
    };
  }

  if (view.status === "ACTIVE" && view.cancelAtPeriodEnd && view.currentPeriodEnd) {
    return {
      title: "Cancellation scheduled",
      subtitle: `Active until ${formatDateIn(new Date(view.currentPeriodEnd))} · No renewal`,
    };
  }

  if (view.status === "ACTIVE" && view.hasAccess) {
    return {
      title: "Premium",
      subtitle: `₹${PREMIUM_PLAN.amountInr}/month`,
    };
  }

  if (view.status === "CANCELLED" && view.hasAccess && view.currentPeriodEnd) {
    return {
      title: "Cancellation scheduled",
      subtitle: `Active until ${formatDateIn(new Date(view.currentPeriodEnd))} · No renewal`,
    };
  }

  if (view.status === "PAST_DUE" && view.hasAccess) {
    const days = view.daysRemaining ?? 0;
    return {
      title: "Payment issue",
      subtitle:
        days === 1
          ? "1 day remaining in grace period"
          : `${days} days remaining in grace period`,
    };
  }

  if (view.status === "PAST_DUE" && !view.hasAccess) {
    return {
      title: "Payment required",
      subtitle: "Grace period ended — restore Premium to continue",
    };
  }

  return {
    title:
      view.status === "TRIALING"
        ? "Your free trial has ended"
        : "Subscription expired",
    subtitle: "Subscribe to continue using PrintMadeEasy",
  };
}
