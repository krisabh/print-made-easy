import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";

export const AUTH_COOKIE_NAME = "pme_session";

export type AuthTokenPayload = {
  sub: string;
  email: string;
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

export type AuthSession = {
  user: {
    id: string;
    name: string;
    email: string;
  };
  shop: AuthShop;
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
    return { sub, email };
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

export async function getCurrentUser(): Promise<AuthSession | null> {
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
      shop: {
        include: shopInclude,
      },
    },
  });

  if (!user?.shop || !user.shop.isActive) {
    return null;
  }

  // Extra safety: email in token should still match DB
  if (user.email.toLowerCase() !== payload.email.toLowerCase()) {
    return null;
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    shop: user.shop,
  };
}

export async function requireAuth(): Promise<AuthSession> {
  const session = await getCurrentUser();
  if (!session) {
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
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return session;
}
