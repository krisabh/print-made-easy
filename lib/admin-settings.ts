/**
 * Platform Admin settings (singleton).
 * New checkouts and new signups read these values. Existing payments and trials are not rewritten.
 */

import { recordAdminAudit } from "@/lib/admin-audit";
import { prisma } from "@/lib/prisma";

export const ADMIN_SETTINGS_ID = "platform";

export const DEFAULT_PREMIUM_AMOUNT_INR = 199;
export const DEFAULT_TRIAL_ENABLED = true;
export const DEFAULT_TRIAL_DAYS = 7;

export const PREMIUM_AMOUNT_MIN = 1;
export const PREMIUM_AMOUNT_MAX = 100_000;
export const TRIAL_DAYS_MIN_WHEN_DISABLED = 0;
export const TRIAL_DAYS_MAX = 365;

export type AdminSettingsView = {
  id: typeof ADMIN_SETTINGS_ID;
  premiumAmountInr: number;
  trialEnabled: boolean;
  trialDays: number;
  createdAt: string;
  updatedAt: string;
};

type SettingsRow = {
  id: string;
  premiumAmountInr: number;
  trialEnabled: boolean;
  trialDays: number;
  createdAt: Date;
  updatedAt: Date;
};

function toView(row: SettingsRow): AdminSettingsView {
  return {
    id: ADMIN_SETTINGS_ID,
    premiumAmountInr: row.premiumAmountInr,
    trialEnabled: row.trialEnabled,
    trialDays: row.trialDays,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Current Premium price for NEW checkouts. Falls back to ₹199 when unset. */
export async function getCurrentPremiumPriceInr(): Promise<number> {
  const row = await getAdminSettings();
  return row?.premiumAmountInr ?? DEFAULT_PREMIUM_AMOUNT_INR;
}

/** Trial offer for NEW shop signups only. Falls back to 7 days when unset. */
export async function getCurrentTrialOffer(): Promise<{
  enabled: boolean;
  days: number;
}> {
  const row = await getAdminSettings();
  if (!row) {
    return { enabled: DEFAULT_TRIAL_ENABLED, days: DEFAULT_TRIAL_DAYS };
  }
  return { enabled: row.trialEnabled, days: row.trialDays };
}

export async function getAdminSettings(): Promise<AdminSettingsView | null> {
  const row = await prisma.adminSetting.findUnique({
    where: { id: ADMIN_SETTINGS_ID },
  });
  return row ? toView(row) : null;
}

export async function getOrCreateAdminSettings(): Promise<AdminSettingsView> {
  const row = await prisma.adminSetting.upsert({
    where: { id: ADMIN_SETTINGS_ID },
    update: {},
    create: {
      id: ADMIN_SETTINGS_ID,
      premiumAmountInr: DEFAULT_PREMIUM_AMOUNT_INR,
      trialEnabled: DEFAULT_TRIAL_ENABLED,
      trialDays: DEFAULT_TRIAL_DAYS,
    },
  });
  return toView(row);
}

export type AdminSettingsUpdate = {
  premiumAmountInr: number;
  trialEnabled: boolean;
  trialDays: number;
};

export function parseAdminSettingsUpdate(
  body: unknown,
  current: Pick<AdminSettingsView, "premiumAmountInr" | "trialEnabled" | "trialDays">,
): { ok: true; value: AdminSettingsUpdate } | { ok: false; error: string } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid settings." };
  }
  const raw = body as Record<string, unknown>;
  const allowed = new Set(["premiumAmountInr", "trialEnabled", "trialDays"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      return { ok: false, error: "Invalid settings." };
    }
  }

  let premiumAmountInr = current.premiumAmountInr;
  if ("premiumAmountInr" in raw) {
    const parsed = parsePositiveInt(raw.premiumAmountInr);
    if (parsed == null) {
      return { ok: false, error: "Monthly price must be a whole number of rupees." };
    }
    if (parsed < PREMIUM_AMOUNT_MIN || parsed > PREMIUM_AMOUNT_MAX) {
      return {
        ok: false,
        error: `Monthly price must be between ₹${PREMIUM_AMOUNT_MIN} and ₹${PREMIUM_AMOUNT_MAX}.`,
      };
    }
    premiumAmountInr = parsed;
  }

  let trialEnabled = current.trialEnabled;
  if ("trialEnabled" in raw) {
    if (typeof raw.trialEnabled !== "boolean") {
      return { ok: false, error: "Free trial must be on or off." };
    }
    trialEnabled = raw.trialEnabled;
  }

  let trialDays = current.trialDays;
  if ("trialDays" in raw) {
    const parsed = parseNonNegativeInt(raw.trialDays);
    if (parsed == null) {
      return { ok: false, error: "Trial duration must be a whole number of days." };
    }
    trialDays = parsed;
  }

  if (trialDays > TRIAL_DAYS_MAX) {
    return {
      ok: false,
      error: `Trial duration cannot be more than ${TRIAL_DAYS_MAX} days.`,
    };
  }
  if (trialEnabled && trialDays < 1) {
    return {
      ok: false,
      error: "Trial duration must be at least 1 day when the free trial is on.",
    };
  }
  if (!trialEnabled && trialDays < TRIAL_DAYS_MIN_WHEN_DISABLED) {
    return { ok: false, error: "Trial duration cannot be negative." };
  }

  return {
    ok: true,
    value: { premiumAmountInr, trialEnabled, trialDays },
  };
}

function parsePositiveInt(value: unknown): number | null {
  const n = parseWholeNumber(value);
  if (n == null || n < 1) return null;
  return n;
}

function parseNonNegativeInt(value: unknown): number | null {
  return parseWholeNumber(value);
}

export async function updateAdminSettings(input: {
  adminUserId: string;
  patch: unknown;
}): Promise<
  | { ok: true; settings: AdminSettingsView }
  | { ok: false; error: string; status: 400 }
> {
  const current = await getOrCreateAdminSettings();
  const parsed = parseAdminSettingsUpdate(input.patch, current);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, status: 400 };
  }

  const next = parsed.value;
  if (
    next.premiumAmountInr === current.premiumAmountInr &&
    next.trialEnabled === current.trialEnabled &&
    next.trialDays === current.trialDays
  ) {
    return { ok: true, settings: current };
  }

  const before = {
    premiumAmountInr: current.premiumAmountInr,
    trialEnabled: current.trialEnabled,
    trialDays: current.trialDays,
  };

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.adminSetting.update({
      where: { id: ADMIN_SETTINGS_ID },
      data: next,
    });
    await recordAdminAudit(
      {
        adminUserId: input.adminUserId,
        action: "admin_settings.update",
        targetType: "AdminSetting",
        targetId: ADMIN_SETTINGS_ID,
        before,
        after: next,
      },
      tx,
    );
    return updated;
  });

  return { ok: true, settings: toView(row) };
}

function parseWholeNumber(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) return null;
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (!Number.isSafeInteger(n)) return null;
    return n;
  }
  return null;
}
