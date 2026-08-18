"use server";

import { z } from "zod";

import { requireShop } from "@/lib/auth";
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
  const { shop } = await requireShop();

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

    await prisma.printPrice.update({
      where: { shopId: shop.id },
      data: parsed.data,
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
