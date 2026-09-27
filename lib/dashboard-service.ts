import { unlink } from "fs/promises";
import { PrintStatus, type Prisma } from "@prisma/client";

import type { AuthShop } from "@/lib/auth";
import { MAX_PRINT_ATTEMPTS } from "@/lib/print-agent-auth";
import { prisma } from "@/lib/prisma";
import { getStoredFilePath } from "@/lib/storage";
import type { DateFilter, StatusFilter } from "@/types";

/** Retained for local demo/seed references only — not used for dashboard auth. */
export const DEMO_SHOP_CODE = "PME001";
export const JOBS_PAGE_SIZE = 50;

export type { DateFilter, StatusFilter };

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function getDateRange(filter: DateFilter) {
  const now = new Date();

  if (filter === "today") {
    return { gte: startOfDay(now), lte: endOfDay(now) };
  }

  if (filter === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return { gte: startOfDay(yesterday), lte: endOfDay(yesterday) };
  }

  if (filter === "last7") {
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    return { gte: startOfDay(from), lte: endOfDay(now) };
  }

  if (filter === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { gte: startOfDay(from), lte: endOfDay(now) };
  }

  return null;
}

export async function getShopByIdForDashboard(shopId: string) {
  return prisma.shop.findFirst({
    where: { id: shopId, isActive: true },
    include: {
      printPrice: true,
      settings: true,
    },
  });
}

export async function getDashboardSummary(shopId: string) {
  const todayRange = getDateRange("today")!;

  const [todaysJobs, pendingJobs, printingJobs, readyJobs, todayRevenue] =
    await Promise.all([
      prisma.printJob.count({
        where: { shopId, createdAt: todayRange },
      }),
      prisma.printJob.count({
        where: {
          shopId,
          status: PrintStatus.PENDING,
          printAttempts: { lt: MAX_PRINT_ATTEMPTS },
          files: { some: { fileDeletedAt: null } },
        },
      }),
      prisma.printJob.count({
        where: { shopId, status: PrintStatus.PRINTING },
      }),
      prisma.printJob.count({
        where: { shopId, status: PrintStatus.READY_FOR_PICKUP },
      }),
      prisma.printJob.aggregate({
        where: {
          shopId,
          createdAt: todayRange,
          status: { not: PrintStatus.CANCELLED },
        },
        _sum: { totalPrice: true },
      }),
    ]);

  return {
    todaysJobs,
    pendingJobs,
    printingJobs,
    readyJobs,
    todaysRevenue: Number(todayRevenue._sum.totalPrice ?? 0),
  };
}

export type JobListParams = {
  shopId: string;
  status?: StatusFilter;
  search?: string;
  date?: DateFilter;
};

export async function getShopJobs(params: JobListParams) {
  const where: Prisma.PrintJobWhereInput = {
    shopId: params.shopId,
  };

  if (params.status && params.status !== "ALL") {
    where.status = params.status;
  }

  if (params.search?.trim()) {
    where.jobNumber = {
      contains: params.search.trim().toUpperCase(),
    };
  }

  const dateRange = getDateRange(params.date ?? "today");
  if (dateRange) {
    where.createdAt = dateRange;
  }

  const jobs = await prisma.printJob.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: JOBS_PAGE_SIZE,
    select: {
      id: true,
      jobNumber: true,
      createdAt: true,
      totalPages: true,
      copies: true,
      printMode: true,
      printType: true,
      totalPrice: true,
      status: true,
      printAttempts: true,
      lastError: true,
      files: {
        select: {
          id: true,
          originalFileName: true,
          fileExtension: true,
          fileSize: true,
          totalPages: true,
          printedAt: true,
          fileDeletedAt: true,
        },
      },
    },
  });

  return jobs.map((job) => ({
    ...job,
    totalPrice: Number(job.totalPrice),
    createdAt: job.createdAt.toISOString(),
    files: job.files.map((file) => ({
      ...file,
      printedAt: file.printedAt?.toISOString() ?? null,
      fileDeletedAt: file.fileDeletedAt?.toISOString() ?? null,
    })),
  }));
}

export async function getJobById(shopId: string, jobId: string) {
  const job = await prisma.printJob.findFirst({
    where: { id: jobId, shopId },
    select: {
      id: true,
      jobNumber: true,
      createdAt: true,
      totalPages: true,
      copies: true,
      printMode: true,
      printType: true,
      totalPrice: true,
      status: true,
      files: {
        select: {
          id: true,
          originalFileName: true,
          storedFileName: true,
          fileExtension: true,
          fileSize: true,
          totalPages: true,
        },
      },
    },
  });

  if (!job) return null;

  return {
    ...job,
    totalPrice: Number(job.totalPrice),
    createdAt: job.createdAt.toISOString(),
  };
}

/** Preview scoped to authenticated shop id (never trust client shopCode alone). */
export async function getFileForShopPreview(fileId: string, shopId: string) {
  return prisma.printJobFile.findFirst({
    where: {
      id: fileId,
      fileDeletedAt: null,
      printJob: {
        shopId,
        shop: {
          isActive: true,
        },
      },
    },
    select: {
      id: true,
      originalFileName: true,
      storedFileName: true,
      fileExtension: true,
      fileSize: true,
    },
  });
}

export function serializeShopForDashboard(shop: AuthShop) {
  return {
    id: shop.id,
    shopCode: shop.shopCode,
    shopName: shop.shopName,
    phone: shop.phone,
    email: shop.email,
    address: shop.address,
    pricing: shop.printPrice
      ? {
          bwSingle: Number(shop.printPrice.bwSingle),
          bwDouble: Number(shop.printPrice.bwDouble),
          colorSingle: Number(shop.printPrice.colorSingle),
          colorDouble: Number(shop.printPrice.colorDouble),
          minimumCharge: Number(shop.printPrice.minimumCharge),
        }
      : null,
    settings: shop.settings
      ? {
          currency: shop.settings.currency,
          timezone: shop.settings.timezone,
          autoDeleteDays: shop.settings.autoDeleteDays,
        }
      : {
          currency: "INR",
          timezone: "Asia/Kolkata",
          autoDeleteDays: 7,
        },
  };
}

export const SHOPKEEPER_CANCEL_REASON = "Cancelled by shopkeeper.";
export const CUSTOMER_CANCEL_REASON = "Cancelled by the customer.";

type ActiveCancelOutcome =
  | {
      outcome: "cancelled";
      job: {
        id: string;
        jobNumber: string;
        status: PrintStatus;
        totalPages: number;
        updatedAt: Date;
      };
    }
  | { outcome: "not_found" }
  | {
      outcome: "not_active";
      job: {
        id: string;
        jobNumber: string;
        status: PrintStatus;
        totalPages: number;
        updatedAt: Date;
      };
    };

/**
 * Soft-cancel a PENDING or PRINTING job.
 * The status write is conditional, so a job that finishes first is left as-is.
 * File cleanup runs only after that write succeeds.
 */
export async function cancelActiveShopJob(
  shopId: string,
  jobId: string,
  lastError: string,
): Promise<ActiveCancelOutcome> {
  const jobSelect = {
    id: true,
    jobNumber: true,
    status: true,
    totalPages: true,
    updatedAt: true,
  } as const;

  const updated = await prisma.printJob.updateMany({
    where: {
      id: jobId,
      shopId,
      status: { in: [PrintStatus.PENDING, PrintStatus.PRINTING] },
    },
    data: {
      status: PrintStatus.CANCELLED,
      claimedByAgentDeviceId: null,
      claimedAt: null,
      lastError,
    },
  });

  if (updated.count === 0) {
    const current = await prisma.printJob.findFirst({
      where: { id: jobId, shopId },
      select: jobSelect,
    });
    if (!current) return { outcome: "not_found" };
    return { outcome: "not_active", job: current };
  }

  const files = await prisma.printJobFile.findMany({
    where: { printJobId: jobId, fileDeletedAt: null },
    select: { storedFileName: true },
  });
  for (const file of files) {
    try {
      await unlink(getStoredFilePath(file.storedFileName));
    } catch {
      // File may already be gone
    }
  }
  await prisma.printJobFile.updateMany({
    where: { printJobId: jobId, fileDeletedAt: null },
    data: { fileDeletedAt: new Date() },
  });

  const job = await prisma.printJob.findFirst({
    where: { id: jobId, shopId },
    select: jobSelect,
  });
  if (!job) return { outcome: "not_found" };
  return { outcome: "cancelled", job };
}

/**
 * Customer stop for the job identified by the upload success screen.
 * Ownership is the existing customer check: job id plus that shop's code.
 * shopId is taken from the matched row, never from the browser.
 */
export async function cancelCustomerOwnedJob(shopCode: string, jobId: string) {
  const job = await prisma.printJob.findFirst({
    where: {
      id: jobId,
      shop: { shopCode, isActive: true },
    },
    select: {
      id: true,
      shopId: true,
      jobNumber: true,
      status: true,
      totalPages: true,
      updatedAt: true,
    },
  });

  if (!job) return { outcome: "not_found" as const };

  if (job.status === PrintStatus.CANCELLED) {
    return { outcome: "already_cancelled" as const, job };
  }

  if (
    job.status !== PrintStatus.PENDING &&
    job.status !== PrintStatus.PRINTING
  ) {
    return { outcome: "not_active" as const, job };
  }

  const cancelled = await cancelActiveShopJob(
    job.shopId,
    job.id,
    CUSTOMER_CANCEL_REASON,
  );
  if (cancelled.outcome === "cancelled") {
    return { outcome: "cancelled" as const, job: cancelled.job };
  }
  if (cancelled.outcome === "not_found") {
    return { outcome: "not_found" as const };
  }
  if (cancelled.job.status === PrintStatus.CANCELLED) {
    return { outcome: "already_cancelled" as const, job: cancelled.job };
  }
  return { outcome: "not_active" as const, job: cancelled.job };
}

/**
 * Delete a job for the shop.
 * PENDING/PRINTING → soft-cancel (CANCELLED) so the Agent can stop and cancel
 * related Windows spool work. Finished jobs are hard-deleted as before.
 */
export async function deleteShopJob(shopId: string, jobId: string) {
  const job = await prisma.printJob.findFirst({
    where: { id: jobId, shopId },
    include: {
      files: {
        select: {
          id: true,
          storedFileName: true,
          fileDeletedAt: true,
        },
      },
    },
  });

  if (!job) {
    return null;
  }

  const isActive =
    job.status === PrintStatus.PENDING || job.status === PrintStatus.PRINTING;

  if (isActive) {
    const cancelled = await cancelActiveShopJob(
      shopId,
      job.id,
      SHOPKEEPER_CANCEL_REASON,
    );
    if (cancelled.outcome === "not_found") return null;
    if (cancelled.outcome === "not_active") {
      return { ...job, status: cancelled.job.status, stopApplied: false as const };
    }
    return { ...job, status: PrintStatus.CANCELLED, stopApplied: true as const };
  }

  for (const file of job.files) {
    if (file.fileDeletedAt) continue;
    try {
      await unlink(getStoredFilePath(file.storedFileName));
    } catch {
      // File may already be gone
    }
  }

  await prisma.printJobFile.updateMany({
    where: {
      printJobId: job.id,
      fileDeletedAt: null,
    },
    data: { fileDeletedAt: new Date() },
  });

  await prisma.printJob.delete({
    where: { id: job.id },
  });

  return job;
}
