import { unlink } from "fs/promises";
import { PrintStatus, type Prisma } from "@prisma/client";

import { MAX_PRINT_ATTEMPTS } from "@/lib/print-agent-auth";
import { prisma } from "@/lib/prisma";
import { toPricingRates } from "@/lib/pricing-service";
import { getStoredFilePath } from "@/lib/storage";
import type { DateFilter, StatusFilter } from "@/types";

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

export async function getDemoShop() {
  return prisma.shop.findFirst({
    where: { shopCode: DEMO_SHOP_CODE, isActive: true },
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
      // Only count jobs the Agent can still print (have a live document).
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
      mode: "insensitive",
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

export async function getFileForShopPreview(fileId: string, shopCode: string) {
  return prisma.printJobFile.findFirst({
    where: {
      id: fileId,
      fileDeletedAt: null,
      printJob: {
        shop: {
          shopCode,
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

export function serializeShopForDashboard(
  shop: NonNullable<Awaited<ReturnType<typeof getDemoShop>>>,
) {
  return {
    id: shop.id,
    shopCode: shop.shopCode,
    shopName: shop.shopName,
    phone: shop.phone,
    email: shop.email,
    address: shop.address,
    pricing: shop.printPrice ? toPricingRates(shop.printPrice) : null,
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

/** Delete a job for the shop: removes DB row and any remaining server files. */
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

  for (const file of job.files) {
    if (file.fileDeletedAt) continue;
    try {
      await unlink(getStoredFilePath(file.storedFileName));
    } catch {
      // File may already be gone
    }
  }

  await prisma.printJob.delete({
    where: { id: job.id },
  });

  return job;
}
