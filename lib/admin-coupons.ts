/**
 * Admin coupon configuration. Does not create redemptions or change checkout.
 */

import type { CouponType, Prisma } from "@prisma/client";

import { recordAdminAudit } from "@/lib/admin-audit";
import { prisma } from "@/lib/prisma";

export const COUPON_CODE_MIN = 3;
export const COUPON_CODE_MAX = 32;
export const COUPON_FIXED_MAX_INR = 100_000;
export const ADMIN_COUPONS_PAGE_SIZE = 20;

const CREATE_KEYS = new Set([
  "code",
  "type",
  "value",
  "validFrom",
  "validUntil",
  "maxRedemptions",
  "perShopLimit",
  "shopId",
  "isActive",
]);

const UPDATE_KEYS = new Set([
  "type",
  "value",
  "validFrom",
  "validUntil",
  "maxRedemptions",
  "perShopLimit",
  "shopId",
  "isActive",
]);

export type CouponSnapshot = {
  code: string;
  type: CouponType;
  value: number;
  validFrom: string;
  validUntil: string;
  maxRedemptions: number | null;
  perShopLimit: number | null;
  isActive: boolean;
  shopId: string | null;
};

/** Admin list/detail badge. Matches checkout window: now < from / now > until. */
export type AdminCouponEffectiveStatus =
  | "Inactive"
  | "Scheduled"
  | "Expired"
  | "Active";

export function getAdminCouponEffectiveStatus(
  coupon: {
    isActive: boolean;
    validFrom: string | Date;
    validUntil: string | Date;
  },
  now: Date = new Date(),
): AdminCouponEffectiveStatus {
  if (!coupon.isActive) return "Inactive";
  const fromMs =
    coupon.validFrom instanceof Date
      ? coupon.validFrom.getTime()
      : new Date(coupon.validFrom).getTime();
  const untilMs =
    coupon.validUntil instanceof Date
      ? coupon.validUntil.getTime()
      : new Date(coupon.validUntil).getTime();
  const nowMs = now.getTime();
  if (nowMs < fromMs) return "Scheduled";
  if (nowMs > untilMs) return "Expired";
  return "Active";
}

type CouponWrite = CouponSnapshot;

type Fail = { ok: false; error: string; status: 400 | 404 | 409 };

function fail(error: string, status: Fail["status"] = 400): Fail {
  return { ok: false, error, status };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknown(raw: Record<string, unknown>, allowed: Set<string>) {
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return fail("Invalid coupon.");
  }
  return null;
}

export function normalizeCouponCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  if (code.length < COUPON_CODE_MIN || code.length > COUPON_CODE_MAX) return null;
  if (!/^[A-Z0-9]+$/.test(code)) return null;
  return code;
}

function parseType(value: unknown): CouponType | null {
  if (value === "PERCENT" || value === "FIXED") return value;
  return null;
}

function parseWhole(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
}

function parsePositive(value: unknown): number | null {
  const n = parseWhole(value);
  if (n == null || n < 1) return null;
  return n;
}

function parseOptionalPositive(
  raw: Record<string, unknown>,
  key: "maxRedemptions" | "perShopLimit",
  present: boolean,
): { ok: true; value: number | null } | Fail {
  if (!present) return { ok: true, value: null };
  if (raw[key] === null) return { ok: true, value: null };
  const n = parsePositive(raw[key]);
  if (n == null) {
    return fail(
      key === "maxRedemptions"
        ? "Maximum redemptions must be a positive whole number."
        : "Per-shop limit must be a positive whole number.",
    );
  }
  return { ok: true, value: n };
}

function parseDate(value: unknown, label: string): { ok: true; value: Date } | Fail {
  if (typeof value !== "string" || !value.trim()) {
    return fail(`${label} is required.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fail(`${label} is not a valid date.`);
  }
  return { ok: true, value: date };
}

function parseValue(type: CouponType, value: unknown): { ok: true; value: number } | Fail {
  const n = parseWhole(value);
  if (type === "PERCENT") {
    if (n == null || n < 1 || n > 100) {
      return fail("Percentage discount must be a whole number from 1 to 100.");
    }
    return { ok: true, value: n };
  }
  if (n == null || n < 1 || n > COUPON_FIXED_MAX_INR) {
    return fail(
      `Fixed discount must be a whole rupee amount from 1 to ${COUPON_FIXED_MAX_INR}.`,
    );
  }
  return { ok: true, value: n };
}

async function assertShop(shopId: string | null): Promise<Fail | null> {
  if (shopId == null) return null;
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { id: true, isActive: true },
  });
  if (!shop) return fail("Shop not found.", 404);
  if (!shop.isActive) return fail("Shop is not active.", 400);
  return null;
}

function toSnapshot(row: {
  code: string;
  type: CouponType;
  value: number;
  validFrom: Date;
  validUntil: Date;
  maxRedemptions: number | null;
  perShopLimit: number | null;
  isActive: boolean;
  shopId: string | null;
}): CouponSnapshot {
  return {
    code: row.code,
    type: row.type,
    value: row.value,
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil.toISOString(),
    maxRedemptions: row.maxRedemptions,
    perShopLimit: row.perShopLimit,
    isActive: row.isActive,
    shopId: row.shopId,
  };
}

function sameSnapshot(a: CouponSnapshot, b: CouponSnapshot) {
  return (
    a.code === b.code &&
    a.type === b.type &&
    a.value === b.value &&
    a.validFrom === b.validFrom &&
    a.validUntil === b.validUntil &&
    a.maxRedemptions === b.maxRedemptions &&
    a.perShopLimit === b.perShopLimit &&
    a.isActive === b.isActive &&
    a.shopId === b.shopId
  );
}

const couponSelect = {
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
  createdAt: true,
  updatedAt: true,
  shop: { select: { shopName: true, shopCode: true } },
  _count: { select: { redemptions: true } },
} satisfies Prisma.CouponSelect;

type CouponRow = Prisma.CouponGetPayload<{ select: typeof couponSelect }>;

export type AdminCouponView = ReturnType<typeof toCouponView>;

export function toCouponView(row: CouponRow) {
  const redemptionCount = row._count.redemptions;
  const remainingRedemptions =
    row.maxRedemptions == null
      ? null
      : Math.max(0, row.maxRedemptions - redemptionCount);
  return {
    id: row.id,
    ...toSnapshot(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    shopName: row.shop?.shopName ?? null,
    shopCode: row.shop?.shopCode ?? null,
    redemptionCount,
    remainingRedemptions,
  };
}

export async function listAdminCoupons(input: { page?: number }) {
  const pageSize = ADMIN_COUPONS_PAGE_SIZE;
  const page = Math.max(1, Math.floor(input.page ?? 1) || 1);
  const skip = (page - 1) * pageSize;
  const [total, rows] = await Promise.all([
    prisma.coupon.count(),
    prisma.coupon.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: couponSelect,
    }),
  ]);
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    coupons: rows.map(toCouponView),
  };
}

export async function getAdminCoupon(couponId: string) {
  const id = couponId.trim();
  if (!id) return null;
  const row = await prisma.coupon.findUnique({
    where: { id },
    select: couponSelect,
  });
  return row ? toCouponView(row) : null;
}

export async function listActiveShopsForCoupons() {
  const shops = await prisma.shop.findMany({
    where: { isActive: true },
    orderBy: { shopName: "asc" },
    select: { id: true, shopName: true, shopCode: true },
  });
  return shops;
}

async function parseWrite(
  raw: Record<string, unknown>,
  mode: "create" | "update",
  current?: CouponWrite,
): Promise<{ ok: true; value: CouponWrite } | Fail> {
  const code =
    mode === "create"
      ? normalizeCouponCode(raw.code)
      : current?.code ?? null;
  if (!code) return fail("Coupon code must be 3–32 letters or numbers.");

  const type = "type" in raw ? parseType(raw.type) : current?.type ?? null;
  if (!type) return fail("Discount type must be PERCENT or FIXED.");

  const parsedValue =
    "value" in raw ? parseValue(type, raw.value) : current
      ? { ok: true as const, value: current.value }
      : fail("Discount value is required.");
  if (!parsedValue.ok) return parsedValue;
  if ("type" in raw && !("value" in raw) && current) {
    const rechecked = parseValue(type, current.value);
    if (!rechecked.ok) return rechecked;
  }

  const fromResult =
    "validFrom" in raw
      ? parseDate(raw.validFrom, "Valid from")
      : current
        ? { ok: true as const, value: new Date(current.validFrom) }
        : fail("Valid from is required.");
  if (!fromResult.ok) return fromResult;
  const untilResult =
    "validUntil" in raw
      ? parseDate(raw.validUntil, "Valid until")
      : current
        ? { ok: true as const, value: new Date(current.validUntil) }
        : fail("Valid until is required.");
  if (!untilResult.ok) return untilResult;
  if (untilResult.value.getTime() < fromResult.value.getTime()) {
    return fail("Valid until cannot be earlier than valid from.");
  }

  const max = parseOptionalPositive(raw, "maxRedemptions", "maxRedemptions" in raw);
  if (!max.ok) return max;
  const perShop = parseOptionalPositive(raw, "perShopLimit", "perShopLimit" in raw);
  if (!perShop.ok) return perShop;

  let shopId: string | null;
  if ("shopId" in raw) {
    if (raw.shopId === null) shopId = null;
    else if (typeof raw.shopId === "string" && raw.shopId.trim()) shopId = raw.shopId.trim();
    else return fail("Shop is required for a shop-specific coupon.");
  } else if (mode === "create") {
    return fail("Shop scope is required.");
  } else {
    shopId = current?.shopId ?? null;
  }

  const shopError = await assertShop(shopId);
  if (shopError) return shopError;

  let isActive = current?.isActive ?? true;
  if ("isActive" in raw) {
    if (typeof raw.isActive !== "boolean") return fail("Active must be true or false.");
    isActive = raw.isActive;
  }

  const value =
    "type" in raw && !("value" in raw) && current
      ? parseValue(type, current.value)
      : parsedValue;
  if (!value.ok) return value;

  return {
    ok: true,
    value: {
      code,
      type,
      value: value.value,
      validFrom: fromResult.value.toISOString(),
      validUntil: untilResult.value.toISOString(),
      maxRedemptions: "maxRedemptions" in raw ? max.value : current?.maxRedemptions ?? null,
      perShopLimit: "perShopLimit" in raw ? perShop.value : current?.perShopLimit ?? null,
      isActive,
      shopId,
    },
  };
}

export async function createAdminCoupon(input: {
  adminUserId: string;
  body: unknown;
}): Promise<{ ok: true; coupon: ReturnType<typeof toCouponView> } | Fail> {
  if (!isPlainObject(input.body)) return fail("Invalid coupon.");
  const unknown = rejectUnknown(input.body, CREATE_KEYS);
  if (unknown) return unknown;
  for (const key of ["code", "type", "value", "validFrom", "validUntil", "shopId"]) {
    if (!(key in input.body)) return fail("Invalid coupon.");
  }

  const parsed = await parseWrite(input.body, "create");
  if (!parsed.ok) return parsed;

  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.coupon.create({
        data: {
          code: parsed.value.code,
          type: parsed.value.type,
          value: parsed.value.value,
          validFrom: new Date(parsed.value.validFrom),
          validUntil: new Date(parsed.value.validUntil),
          maxRedemptions: parsed.value.maxRedemptions,
          perShopLimit: parsed.value.perShopLimit,
          isActive: parsed.value.isActive,
          shopId: parsed.value.shopId,
        },
        select: couponSelect,
      });
      await recordAdminAudit(
        {
          adminUserId: input.adminUserId,
          action: "COUPON_CREATED",
          targetType: "Coupon",
          targetId: created.id,
          before: null,
          after: toSnapshot(created),
        },
        tx,
      );
      return created;
    });
    return { ok: true, coupon: toCouponView(row) };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return fail("A coupon with this code already exists.", 409);
    }
    throw error;
  }
}

export async function updateAdminCoupon(input: {
  adminUserId: string;
  couponId: string;
  body: unknown;
}): Promise<{ ok: true; coupon: ReturnType<typeof toCouponView> } | Fail> {
  const couponId = input.couponId.trim();
  if (!couponId) return fail("Coupon id is required.");
  if (!isPlainObject(input.body)) return fail("Invalid coupon.");
  const unknown = rejectUnknown(input.body, UPDATE_KEYS);
  if (unknown) return unknown;
  if (Object.keys(input.body).length === 0) {
    const current = await getAdminCoupon(couponId);
    if (!current) return fail("Coupon not found.", 404);
    return { ok: true, coupon: current };
  }

  const existing = await prisma.coupon.findUnique({
    where: { id: couponId },
    select: couponSelect,
  });
  if (!existing) return fail("Coupon not found.", 404);

  const parsed = await parseWrite(input.body, "update", toSnapshot(existing));
  if (!parsed.ok) return parsed;

  const before = toSnapshot(existing);
  if (sameSnapshot(before, parsed.value)) {
    return { ok: true, coupon: toCouponView(existing) };
  }

  const configChanged =
    before.type !== parsed.value.type ||
    before.value !== parsed.value.value ||
    before.validFrom !== parsed.value.validFrom ||
    before.validUntil !== parsed.value.validUntil ||
    before.maxRedemptions !== parsed.value.maxRedemptions ||
    before.perShopLimit !== parsed.value.perShopLimit ||
    before.shopId !== parsed.value.shopId;
  const activeChanged = before.isActive !== parsed.value.isActive;

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.coupon.update({
      where: { id: existing.id },
      data: {
        type: parsed.value.type,
        value: parsed.value.value,
        validFrom: new Date(parsed.value.validFrom),
        validUntil: new Date(parsed.value.validUntil),
        maxRedemptions: parsed.value.maxRedemptions,
        perShopLimit: parsed.value.perShopLimit,
        isActive: parsed.value.isActive,
        shopId: parsed.value.shopId,
      },
      select: couponSelect,
    });
    const after = toSnapshot(updated);
    if (configChanged) {
      await recordAdminAudit(
        {
          adminUserId: input.adminUserId,
          action: "COUPON_UPDATED",
          targetType: "Coupon",
          targetId: updated.id,
          before,
          after,
        },
        tx,
      );
    }
    if (activeChanged) {
      await recordAdminAudit(
        {
          adminUserId: input.adminUserId,
          action: parsed.value.isActive ? "COUPON_ACTIVATED" : "COUPON_DEACTIVATED",
          targetType: "Coupon",
          targetId: updated.id,
          before,
          after,
        },
        tx,
      );
    }
    return updated;
  });

  return { ok: true, coupon: toCouponView(row) };
}
