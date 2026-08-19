import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const AUTH_COOKIE_NAME = "pme_session";

export type AuthTokenPayload = {
  sub: string;
  email: string;
  /** Informational only — authorization always uses DB role. */
  role?: UserRole;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

export type AuthShop = {
  id: string;
  shopCode: string;
  shopName: string;
  phone: string;
  email: string | null;
  address: string;
  isActive: boolean;
  printPrice: {
    bwSingle: { toString(): string } | number;
    bwDouble: { toString(): string } | number;
    colorSingle: { toString(): string } | number;
    colorDouble: { toString(): string } | number;
    minimumCharge: { toString(): string } | number;
  } | null;
  settings: {
    currency: string;
    timezone: string;
    autoDeleteDays: number;
  } | null;
};

/** Shopkeeper session — always has an active shop. */
export type AuthSession = {
  user: AuthUser;
  shop: AuthShop;
};

/** Admin session — shop is not required. */
export type AdminSession = {
  user: AuthUser;
};

export type AuthenticatedAccount = {
  user: AuthUser;
  shop: AuthShop | null;
};

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured.");
  }
  return secret;
}

function getJwtExpiresIn() {
  return process.env.JWT_EXPIRES_IN?.trim() || "7d";
}

/** Approximate maxAge (seconds) for cookie from JWT_EXPIRES_IN like 7d / 24h. */
export function cookieMaxAgeSeconds() {
  const raw = getJwtExpiresIn();
  const match = /^(\d+)([smhd])$/i.exec(raw);
  if (!match) {
    return 60 * 60 * 24 * 7;
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "s") return amount;
  if (unit === "m") return amount * 60;
  if (unit === "h") return amount * 60 * 60;
  return amount * 60 * 60 * 24;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function signAuthToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: getJwtExpiresIn() as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded || typeof decoded !== "object") return null;
    const sub = "sub" in decoded ? String(decoded.sub ?? "") : "";
    const email = "email" in decoded ? String(decoded.email ?? "") : "";
    if (!sub || !email) return null;
    const roleRaw =
      "role" in decoded && decoded.role != null ? String(decoded.role) : "";
    const role: UserRole | undefined =
      roleRaw === "ADMIN" || roleRaw === "SHOPKEEPER"
        ? (roleRaw as UserRole)
        : undefined;
    return { sub, email, role };
  } catch {
    return null;
  }
}

export async function setAuthCookie(token: string) {
  const jar = await cookies();
  jar.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: cookieMaxAgeSeconds(),
  });
}

export async function clearAuthCookie() {
  const jar = await cookies();
  jar.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

const shopInclude = {
  printPrice: true,
  settings: true,
} as const;

/**
 * Load authenticated account from cookie + database.
 * Role and shop always come from the database — never from client input.
 */
export async function getAuthenticatedAccount(): Promise<AuthenticatedAccount | null> {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = verifyAuthToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      shop: {
        include: shopInclude,
      },
    },
  });

  if (!user) return null;

  // Extra safety: email in token should still match DB
  if (user.email.toLowerCase() !== payload.email.toLowerCase()) {
    return null;
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    shop: user.shop?.isActive ? user.shop : null,
  };
}

/**
 * Shopkeeper session only (active shop required).
 * Admins and users without an active shop return null.
 */
export async function getCurrentUser(): Promise<AuthSession | null> {
  const account = await getAuthenticatedAccount();
  if (!account) return null;
  if (account.user.role !== "SHOPKEEPER") return null;
  if (!account.shop || !account.shop.isActive) return null;

  return {
    user: account.user,
    shop: account.shop,
  };
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const account = await getAuthenticatedAccount();
  if (!account) return null;
  if (account.user.role !== "ADMIN") return null;
  return { user: account.user };
}

export async function requireAuth(): Promise<AuthSession> {
  const session = await getCurrentUser();
  if (!session) {
    const account = await getAuthenticatedAccount();
    if (account?.user.role === "ADMIN") {
      redirect("/admin");
    }
    redirect("/login");
  }
  return session;
}

export async function requireShop(): Promise<AuthSession> {
  return requireAuth();
}

/** For API routes — returns null instead of redirecting. */
export async function getSessionOrNull() {
  return getCurrentUser();
}

export async function requireShopApi(): Promise<AuthSession | Response> {
  const session = await getCurrentUser();
  if (!session) {
    const account = await getAuthenticatedAccount();
    if (account?.user.role === "ADMIN") {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return session;
}

export async function requireAdmin(): Promise<AdminSession> {
  const account = await getAuthenticatedAccount();
  if (!account) {
    redirect("/login");
  }
  if (account.user.role !== "ADMIN") {
    redirect("/dashboard");
  }
  return { user: account.user };
}

export async function requireAdminApi(): Promise<AdminSession | Response> {
  const account = await getAuthenticatedAccount();
  if (!account) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (account.user.role !== "ADMIN") {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  return { user: account.user };
}
