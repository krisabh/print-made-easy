"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  clearAuthCookie,
  hashPassword,
  setAuthCookie,
  signAuthToken,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { allocateUniqueShopCode } from "@/lib/shop-code";
import { createNestedTrialSubscription } from "@/lib/subscription";
import type { ApiResponse } from "@/types";

const signupSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required.").max(100),
    email: z.string().trim().email("Enter a valid email.").max(255),
    password: z.string().min(8, "Password must be at least 8 characters.").max(128),
    confirmPassword: z.string().min(1, "Confirm your password."),
    shopName: z.string().trim().min(2, "Shop name is required.").max(255),
    phone: z.string().trim().min(7, "Phone is required.").max(32),
    address: z.string().trim().min(3, "Address is required.").max(1000),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(1, "Password is required."),
});

const DEFAULT_PRICING = {
  bwSingle: 2,
  bwDouble: 1.5,
  colorSingle: 10,
  colorDouble: 8,
  minimumCharge: 5,
};

export async function signupAction(
  input: z.infer<typeof signupSchema>,
): Promise<ApiResponse<{ shopCode: string }>> {
  try {
    const parsed = signupSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Please check the form.",
      };
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      return { success: false, error: "An account with this email already exists." };
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const shopCode = await allocateUniqueShopCode();

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          name: parsed.data.name,
          email,
          passwordHash,
          role: "SHOPKEEPER",
        },
      });

      await tx.shop.create({
        data: {
          shopCode,
          shopName: parsed.data.shopName,
          phone: parsed.data.phone,
          address: parsed.data.address,
          email,
          ownerId: createdUser.id,
          printPrice: { create: DEFAULT_PRICING },
          settings: {
            create: {
              currency: "INR",
              timezone: "Asia/Kolkata",
              autoDeleteDays: 7,
            },
          },
          inventory: {
            create: {
              paperAvailable: 0,
              estimatedInkLevel: 100,
            },
          },
          subscription: {
            create: createNestedTrialSubscription(),
          },
        },
      });

      return createdUser;
    });

    const token = signAuthToken({
      sub: user.id,
      email: user.email,
      role: "SHOPKEEPER",
    });
    await setAuthCookie(token);

    return { success: true, data: { shopCode } };
  } catch (error) {
    console.error("signupAction failed");
    return {
      success: false,
      error: "Unable to create your shop right now. Please try again.",
    };
  }
}

export async function loginAction(
  input: z.infer<typeof loginSchema>,
): Promise<ApiResponse<{ redirectTo: string }>> {
  try {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid email or password" };
    }

    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        shop: { select: { id: true, isActive: true } },
      },
    });

    if (!user) {
      return { success: false, error: "Invalid email or password" };
    }

    const ok = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!ok) {
      return { success: false, error: "Invalid email or password" };
    }

    // Role comes from the database only.
    if (user.role === "ADMIN") {
      const token = signAuthToken({
        sub: user.id,
        email: user.email,
        role: user.role,
      });
      await setAuthCookie(token);
      return { success: true, data: { redirectTo: "/admin" } };
    }

    if (user.role !== "SHOPKEEPER" || !user.shop?.isActive) {
      return { success: false, error: "Invalid email or password" };
    }

    const token = signAuthToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    await setAuthCookie(token);
    return { success: true, data: { redirectTo: "/dashboard" } };
  } catch {
    return { success: false, error: "Invalid email or password" };
  }
}

export async function logoutAction() {
  await clearAuthCookie();
  redirect("/login");
}

const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email.").max(255),
});

const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1, "Reset token is required."),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(128, "Password is too long."),
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

/**
 * Always returns the same generic success message (user-enumeration safe).
 */
export async function forgotPasswordAction(
  input: z.infer<typeof forgotPasswordSchema>,
): Promise<ApiResponse<{ message: string }>> {
  const {
    PASSWORD_RESET_GENERIC_MESSAGE,
    requestPasswordReset,
  } = await import("@/lib/password-reset");

  try {
    const parsed = forgotPasswordSchema.safeParse(input);
    if (!parsed.success) {
      // Invalid email format can be reported; existence cannot.
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Enter a valid email.",
      };
    }

    let ip: string | null = null;
    try {
      const headerStore = await headers();
      ip =
        headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        headerStore.get("x-real-ip") ||
        null;
    } catch {
      ip = null;
    }

    const result = await requestPasswordReset({
      email: parsed.data.email,
      ip,
    });

    return {
      success: true,
      data: { message: result.message || PASSWORD_RESET_GENERIC_MESSAGE },
    };
  } catch {
    console.error("forgotPasswordAction failed");
    return {
      success: true,
      data: { message: PASSWORD_RESET_GENERIC_MESSAGE },
    };
  }
}

export async function resetPasswordAction(
  input: z.infer<typeof resetPasswordSchema>,
): Promise<ApiResponse<{ message: string }>> {
  try {
    const parsed = resetPasswordSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Please check the form.",
      };
    }

    const { resetPasswordWithToken } = await import("@/lib/password-reset");
    const result = await resetPasswordWithToken({
      rawToken: parsed.data.token,
      newPassword: parsed.data.password,
    });

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    // Do not auto-login. Clear any session on this browser for safety.
    await clearAuthCookie();

    return {
      success: true,
      data: { message: "Your password has been reset successfully." },
    };
  } catch {
    console.error("resetPasswordAction failed");
    return {
      success: false,
      error: "Unable to reset password. Please try again.",
    };
  }
}
