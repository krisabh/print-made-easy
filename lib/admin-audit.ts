/**
 * Admin audit log. Never persist passwords, tokens, or provider secrets.
 */

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type AuditDb = Prisma.TransactionClient | typeof prisma;

const SENSITIVE_KEY =
  /password|token|secret|authorization|cookie|credential|apikey|clientsecret|webhook/i;

export type AdminAuditInput = {
  adminUserId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
};

export function sanitizeAuditPayload(value: unknown): Prisma.InputJsonValue | null {
  const cleaned = stripSensitive(value);
  if (cleaned == null) return null;
  return cleaned as Prisma.InputJsonValue;
}

function stripSensitive(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripSensitive(item));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) continue;
      out[key] = stripSensitive(child);
    }
    return out;
  }
  return null;
}

export async function recordAdminAudit(input: AdminAuditInput, db: AuditDb = prisma) {
  return db.adminAuditLog.create({
    data: {
      adminUserId: input.adminUserId,
      action: input.action.slice(0, 64),
      targetType: input.targetType.slice(0, 64),
      targetId: input.targetId ? input.targetId.slice(0, 64) : null,
      beforeJson: input.before === undefined ? undefined : sanitizeAuditPayload(input.before) ?? undefined,
      afterJson: input.after === undefined ? undefined : sanitizeAuditPayload(input.after) ?? undefined,
    },
  });
}

export const ADMIN_AUDIT_PAGE_SIZE = 20;

export type AdminAuditListItem = {
  id: string;
  createdAt: string;
  adminName: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
};

export async function listAdminAuditLogs(input: { page?: number; pageSize?: number }) {
  const pageSize = Math.min(
    ADMIN_AUDIT_PAGE_SIZE,
    Math.max(1, Math.floor(input.pageSize ?? ADMIN_AUDIT_PAGE_SIZE)),
  );
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const skip = (page - 1) * pageSize;

  const [total, rows] = await Promise.all([
    prisma.adminAuditLog.count(),
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        action: true,
        targetType: true,
        targetId: true,
        beforeJson: true,
        afterJson: true,
        adminUser: { select: { name: true, email: true } },
      },
    }),
  ]);

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    entries: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      adminName: row.adminUser.name,
      adminEmail: row.adminUser.email,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      before: row.beforeJson ?? null,
      after: row.afterJson ?? null,
    })),
  };
}
