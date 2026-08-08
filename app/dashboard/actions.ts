"use server";

import { z } from "zod";

import { DEMO_SHOP_CODE, getDemoShop } from "@/lib/dashboard-service";
import { prisma } from "@/lib/prisma";
import type { ApiResponse } from "@/types";

const pricingSchema = z.object({
  bwSingle: z.coerce.number().min(0, "Price cannot be negative."),
  bwDouble: z.coerce.number().min(0, "Price cannot be negative."),
  colorSingle: z.coerce.number().min(0, "Price cannot be negative."),
  colorDouble: z.coerce.number().min(0, "Price cannot be negative."),
  minimumCharge: z.coerce.number().min(0, "Price cannot be negative."),
});

const settingsSchema = z.object({
  shopName: z.string().trim().min(1, "Shop name is required."),
  phone: z.string().trim().min(1, "Phone is required."),
  address: z.string().trim().min(1, "Address is required."),
  currency: z.string().trim().min(1, "Currency is required."),
  timezone: z.string().trim().min(1, "Timezone is required."),
});

export async function updatePricingAction(
  input: z.infer<typeof pricingSchema>,
): Promise<ApiResponse> {
  try {
    const parsed = pricingSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid pricing values.",
      };
    }

    const shop = await getDemoShop();
    if (!shop?.printPrice) {
      return { success: false, error: "Pricing configuration not found." };
    }

    await prisma.printPrice.update({
      where: { shopId: shop.id },
      data: parsed.data,
    });

    return { success: true };
  } catch (error) {
    console.error("updatePricingAction failed:", error);
    return {
      success: false,
      error: "Unable to update pricing. Please try again.",
    };
  }
}

export async function updateShopSettingsAction(
  input: z.infer<typeof settingsSchema>,
): Promise<ApiResponse> {
  try {
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid settings.",
      };
    }

    const shop = await getDemoShop();
    if (!shop) {
      return {
        success: false,
        error: `Shop ${DEMO_SHOP_CODE} is not available.`,
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
  } catch (error) {
    console.error("updateShopSettingsAction failed:", error);
    return {
      success: false,
      error: "Unable to save settings. Please try again.",
    };
  }
}
