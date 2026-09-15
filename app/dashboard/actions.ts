"use server";

import { z } from "zod";

import {
  hashPassword,
  requireShop,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  BW_PRICE_PER_PAGE_MAX,
  BW_PRICE_PER_PAGE_MIN,
  isValidMoneyAmount,
  normalizeMoneyAmount,
} from "@/lib/pricing-service";
import { hasSubscriptionAccess } from "@/lib/subscription";
import type { ApiResponse } from "@/types";

const moneyField = z.coerce
  .number({ message: "Enter a valid amount." })
  .refine((n) => Number.isFinite(n), "Enter a valid amount.")
  .refine((n) => n >= 0, "Price cannot be negative.")
  .refine(isValidMoneyAmount, "Use at most 2 decimal places.");

const bwPriceField = z.coerce
  .number({ message: "Enter a valid Black & White price." })
  .refine((n) => Number.isFinite(n), "Enter a valid Black & White price.")
  .refine(
    (n) => n >= BW_PRICE_PER_PAGE_MIN,
    `Black & White price must be at least ₹${BW_PRICE_PER_PAGE_MIN.toFixed(2)}.`,
  )
  .refine(
    (n) => n <= BW_PRICE_PER_PAGE_MAX,
    `Black & White price cannot exceed ₹${BW_PRICE_PER_PAGE_MAX.toFixed(2)}.`,
  )
  .refine(isValidMoneyAmount, "Use at most 2 decimal places.");

const pricingSchema = z.object({
  bwSingle: bwPriceField,
  bwDouble: moneyField,
  colorSingle: moneyField,
  colorDouble: moneyField,
  minimumCharge: moneyField,
});

const settingsSchema = z.object({
  shopName: z.string().trim().min(1, "Shop name is required."),
  phone: z.string().trim().min(1, "Phone is required."),
  address: z.string().trim().min(1, "Address is required."),
  currency: z.string().trim().min(1, "Currency is required."),
  timezone: z.string().trim().min(1, "Timezone is required."),
});

async function assertProductAccess(shopId: string): Promise<ApiResponse | null> {
  const ok = await hasSubscriptionAccess(shopId);
  if (!ok) {
    return {
      success: false,
      error: "Subscription required. Visit My Plan/Billing to renew access.",
    };
  }
  return null;
}

export async function updatePricingAction(
  input: z.infer<typeof pricingSchema>,
): Promise<ApiResponse> {
  const { shop } = await requireShop();
  const denied = await assertProductAccess(shop.id);
  if (denied) return denied;

  try {
    const parsed = pricingSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid pricing values.",
      };
    }

    if (!shop.printPrice) {
      return { success: false, error: "Pricing configuration not found." };
    }

    const data = {
      bwSingle: normalizeMoneyAmount(parsed.data.bwSingle),
      bwDouble: normalizeMoneyAmount(parsed.data.bwDouble),
      colorSingle: normalizeMoneyAmount(parsed.data.colorSingle),
      colorDouble: normalizeMoneyAmount(parsed.data.colorDouble),
      minimumCharge: normalizeMoneyAmount(parsed.data.minimumCharge),
    };

    await prisma.printPrice.update({
      where: { shopId: shop.id },
      data,
    });

    return { success: true };
  } catch {
    console.error("updatePricingAction failed");
    return {
      success: false,
      error: "Unable to update pricing. Please try again.",
    };
  }
}

export async function updateShopSettingsAction(
  input: z.infer<typeof settingsSchema>,
): Promise<ApiResponse> {
  const { shop } = await requireShop();

  try {
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid settings.",
      };
    }

    await prisma.$transaction([
      prisma.shop.update({
        where: { id: shop.id },
        data: {
          shopName: parsed.data.shopName,
          phone: parsed.data.phone,
          address: parsed.data.address,
        },
      }),
      prisma.settings.upsert({
        where: { shopId: shop.id },
        update: {
          currency: parsed.data.currency,
          timezone: parsed.data.timezone,
        },
        create: {
          shopId: shop.id,
          currency: parsed.data.currency,
          timezone: parsed.data.timezone,
          autoDeleteDays: 7,
        },
      }),
    ]);

    return { success: true };
  } catch {
    console.error("updateShopSettingsAction failed");
    return {
      success: false,
      error: "Unable to save settings. Please try again.",
    };
  }
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters.")
      .max(128, "New password is too long."),
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords do not match.",
    path: ["confirmPassword"],
  });

export async function changePasswordAction(
  input: z.infer<typeof changePasswordSchema>,
): Promise<ApiResponse> {
  const { user } = await requireShop();

  try {
    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Please check the form.",
      };
    }

    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return {
        success: false,
        error: "New password must be different from your current password.",
      };
    }

    const account = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, passwordHash: true },
    });
    if (!account) {
      return { success: false, error: "Account not found." };
    }

    const currentOk = await verifyPassword(
      parsed.data.currentPassword,
      account.passwordHash,
    );
    if (!currentOk) {
      return { success: false, error: "Current password is incorrect." };
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await prisma.user.update({
      where: { id: account.id },
      data: { passwordHash },
    });

    return { success: true };
  } catch {
    console.error("changePasswordAction failed");
    return {
      success: false,
      error: "Unable to change password. Please try again.",
    };
  }
}
