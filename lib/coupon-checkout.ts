/**
 * Server-side coupon pricing for new checkouts.
 * The browser never supplies the amount. Redemption is recorded only after
 * a one-time payment is successfully applied.
 */

import type { Prisma } from "@prisma/client";

import { normalizeCouponCode } from "@/lib/admin-coupons";
import { prisma } from "@/lib/prisma";

const PRICE_KEYS = [
  "amount",
  "amountInr",
  "discount",
  "discountInr",
  "finalAmount",
  "finalAmountInr",
  "basePrice",
  "basePriceInr",
] as const;

export type CouponQuote = {
  couponId: string;
  code: string;
  basePriceInr: number;
  discountInr: number;
  finalAmountInr: number;
};

export function parseCheckoutCouponRequest(body: unknown):
  | { ok: true; couponCode: string | null }
  | { ok: false; error: string } {
  if (body == null) return { ok: true, couponCode: null };
  if (typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid checkout." };
  }
  const raw = body as Record<string, unknown>;
  for (const key of PRICE_KEYS) {
    if (key in raw) return { ok: false, error: "Invalid checkout." };
  }
  for (const key of Object.keys(raw)) {
    if (key !== "couponCode") return { ok: false, error: "Invalid checkout." };
  }
  if (!("couponCode" in raw) || raw.couponCode == null || raw.couponCode === "") {
    return { ok: true, couponCode: null };
  }
  if (typeof raw.couponCode !== "string") {
    return { ok: false, error: "Invalid checkout." };
  }
  const couponCode = raw.couponCode.trim();
  return { ok: true, couponCode: couponCode || null };
}

export function calculateCouponDiscount(input: {
  type: "PERCENT" | "FIXED";
  value: number;
  basePriceInr: number;
}): { ok: true; discountInr: number; finalAmountInr: number } | { ok: false; error: string } {
  const base = input.basePriceInr;
  if (!Number.isInteger(base) || base < 1) {
    return { ok: false, error: "This coupon cannot be applied to the current price." };
  }
  const discount =
    input.type === "PERCENT"
      ? Math.floor((base * input.value) / 100)
      : input.value;
  if (!Number.isInteger(discount) || discount < 1 || discount > base) {
    return { ok: false, error: "This coupon cannot be applied to the current price." };
  }
  const finalAmountInr = base - discount;
  if (!Number.isInteger(finalAmountInr) || finalAmountInr < 1 || finalAmountInr > base) {
    return { ok: false, error: "This coupon cannot be applied to the current price." };
  }
  return { ok: true, discountInr: discount, finalAmountInr };
}

export async function quoteCouponForCheckout(input: {
  shopId: string;
  couponCode: string;
  basePriceInr: number;
  now?: Date;
}): Promise<{ ok: true; quote: CouponQuote } | { ok: false; error: string; status: 400 }> {
  const now = input.now ?? new Date();
  const code = normalizeCouponCode(input.couponCode);
  if (!code) {
    return { ok: false, error: "Enter a valid coupon code.", status: 400 };
  }

  const coupon = await prisma.coupon.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      type: true,
      value: true,
      validFrom: true,
      validUntil: true,
      maxRedemptions: true,
      perShopLimit: true,
      isActive: true,
      shopId: true,
    },
  });
  if (!coupon) {
    return { ok: false, error: "This coupon is not valid.", status: 400 };
  }
  if (!coupon.isActive) {
    return { ok: false, error: "This coupon is not active.", status: 400 };
  }
  if (now.getTime() < coupon.validFrom.getTime()) {
    return { ok: false, error: "This coupon is not valid yet.", status: 400 };
  }
  if (now.getTime() > coupon.validUntil.getTime()) {
    return { ok: false, error: "This coupon has expired.", status: 400 };
  }
  if (coupon.shopId && coupon.shopId !== input.shopId) {
    return { ok: false, error: "This coupon does not apply to your shop.", status: 400 };
  }

  if (coupon.maxRedemptions != null) {
    const used = await prisma.couponRedemption.count({ where: { couponId: coupon.id } });
    if (used >= coupon.maxRedemptions) {
      return { ok: false, error: "This coupon has reached its redemption limit.", status: 400 };
    }
  }
  if (coupon.perShopLimit != null) {
    const usedByShop = await prisma.couponRedemption.count({
      where: { couponId: coupon.id, shopId: input.shopId },
    });
    if (usedByShop >= coupon.perShopLimit) {
      return {
        ok: false,
        error: "This coupon has already been used for your shop.",
        status: 400,
      };
    }
  }

  const priced = calculateCouponDiscount({
    type: coupon.type,
    value: coupon.value,
    basePriceInr: input.basePriceInr,
  });
  if (!priced.ok) return { ok: false, error: priced.error, status: 400 };

  return {
    ok: true,
    quote: {
      couponId: coupon.id,
      code: coupon.code,
      basePriceInr: input.basePriceInr,
      discountInr: priced.discountInr,
      finalAmountInr: priced.finalAmountInr,
    },
  };
}

function readCouponId(metadataJson: string | null) {
  if (!metadataJson) return null;
  try {
    const parsed = JSON.parse(metadataJson) as { couponId?: unknown };
    return typeof parsed.couponId === "string" && parsed.couponId.trim()
      ? parsed.couponId.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Insert one redemption for a payment that has just been marked successful.
 * Same-payment retries are ignored. A coupon row lock keeps two different
 * successful payments from both passing a stale redemption count.
 *
 * Remaining limitation: two checkouts can both be created while one slot
 * remains, because an abandoned checkout is not a redemption. The first
 * successful payment takes the slot. A second payment that was already
 * charged still completes at its stored amount, but does not add another
 * redemption once the limit is full.
 */
export async function recordCouponRedemptionForPayment(
  tx: Prisma.TransactionClient,
  input: {
    billingPaymentId: string;
    shopId: string;
    metadataJson: string | null;
    now: Date;
  },
) {
  const couponId = readCouponId(input.metadataJson);
  if (!couponId) return;

  const existing = await tx.couponRedemption.findUnique({
    where: { billingPaymentId: input.billingPaymentId },
    select: { id: true },
  });
  if (existing) return;

  await tx.$queryRaw`SELECT id FROM Coupon WHERE id = ${couponId} FOR UPDATE`;
  const coupon = await tx.coupon.findUnique({
    where: { id: couponId },
    select: { id: true, shopId: true, maxRedemptions: true, perShopLimit: true },
  });
  if (!coupon) return;
  if (coupon.shopId && coupon.shopId !== input.shopId) return;

  if (coupon.maxRedemptions != null) {
    const used = await tx.couponRedemption.count({ where: { couponId } });
    if (used >= coupon.maxRedemptions) return;
  }
  if (coupon.perShopLimit != null) {
    const usedByShop = await tx.couponRedemption.count({
      where: { couponId, shopId: input.shopId },
    });
    if (usedByShop >= coupon.perShopLimit) return;
  }

  await tx.couponRedemption.create({
    data: {
      couponId,
      shopId: input.shopId,
      billingPaymentId: input.billingPaymentId,
      redeemedAt: input.now,
    },
  });
}
