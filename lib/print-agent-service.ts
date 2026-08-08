import { unlink } from "fs/promises";
import { PrintStatus } from "@prisma/client";

import {
  DOCUMENT_RETENTION_MS,
  MAX_PRINT_ATTEMPTS,
  STALE_PRINTING_MS,
} from "@/lib/print-agent-auth";
import { prisma } from "@/lib/prisma";
import { getStoredFilePath } from "@/lib/storage";

export async function upsertShopPrinter(input: {
  shopId: string;
  printerName: string;
  printerModel?: string | null;
  status: string;
  isDefault: boolean;
}) {
  if (input.isDefault) {
    await prisma.printer.updateMany({
      where: { shopId: input.shopId },
      data: { isDefault: false },
    });
  }

  return prisma.printer.upsert({
    where: {
      shopId_printerName: {
        shopId: input.shopId,
        printerName: input.printerName,
      },
    },
    update: {
      printerModel: input.printerModel ?? undefined,
      status: input.status,
      isDefault: input.isDefault,
      lastSeen: new Date(),
    },
    create: {
      shopId: input.shopId,
      printerName: input.printerName,
      printerModel: input.printerModel ?? null,
      status: input.status,
      isDefault: input.isDefault,
      lastSeen: new Date(),
    },
  });
}

export async function listPendingJobsForShop(shopId: string) {
  const printingCount = await prisma.printJob.count({
    where: { shopId, status: PrintStatus.PRINTING },
  });

  // Do not hand out new work while a job is already PRINTING.
  if (printingCount > 0) {
    return [];
  }

  return prisma.printJob.findMany({
    where: {
      shopId,
      status: PrintStatus.PENDING,
      printAttempts: { lt: MAX_PRINT_ATTEMPTS },
      // Never offer jobs whose documents were already purged.
      files: {
        some: {
          fileDeletedAt: null,
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 10,
    select: {
      id: true,
      jobNumber: true,
      copies: true,
      totalPages: true,
      printMode: true,
      printType: true,
      status: true,
      printAttempts: true,
      createdAt: true,
      files: {
        where: { fileDeletedAt: null },
        select: {
          id: true,
          originalFileName: true,
          fileExtension: true,
          fileSize: true,
          totalPages: true,
        },
      },
    },
  });
}

/** Atomic claim: PENDING → PRINTING for this shop only. */
export async function claimJob(shopId: string, jobId: string) {
  return prisma.$transaction(async (tx) => {
    const alreadyPrinting = await tx.printJob.count({
      where: {
        shopId,
        status: PrintStatus.PRINTING,
        NOT: { id: jobId },
      },
    });

    if (alreadyPrinting > 0) {
      return null;
    }

    const updated = await tx.printJob.updateMany({
      where: {
        id: jobId,
        shopId,
        status: PrintStatus.PENDING,
        printAttempts: { lt: MAX_PRINT_ATTEMPTS },
      },
      data: {
        status: PrintStatus.PRINTING,
        lastError: null,
      },
    });

    if (updated.count !== 1) {
      return null;
    }

    return tx.printJob.findFirst({
      where: { id: jobId, shopId },
      include: {
        files: {
          where: { fileDeletedAt: null },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  });
}

export async function releaseJobToPending(
  shopId: string,
  jobId: string,
  errorMessage: string,
) {
  const job = await prisma.printJob.findFirst({
    where: { id: jobId, shopId },
    select: {
      printAttempts: true,
      status: true,
      files: {
        where: { fileDeletedAt: null },
        select: { id: true },
      },
    },
  });

  if (!job || job.status !== PrintStatus.PRINTING) {
    return null;
  }

  const noFiles = job.files.length === 0;
  const permanent =
    noFiles ||
    /no longer available|no printable files/i.test(errorMessage);

  const attempts = permanent
    ? MAX_PRINT_ATTEMPTS
    : job.printAttempts + 1;
  const keepRetrying = !permanent && attempts < MAX_PRINT_ATTEMPTS;

  return prisma.printJob.update({
    where: { id: jobId },
    data: {
      status: PrintStatus.PENDING,
      printAttempts: attempts,
      lastError: keepRetrying
        ? errorMessage
        : permanent
          ? errorMessage
          : `Failed after ${MAX_PRINT_ATTEMPTS} attempts: ${errorMessage}`,
    },
  });
}

export async function markJobReady(shopId: string, jobId: string) {
  const updated = await prisma.printJob.updateMany({
    where: {
      id: jobId,
      shopId,
      status: PrintStatus.PRINTING,
    },
    data: {
      status: PrintStatus.READY_FOR_PICKUP,
      lastError: null,
    },
  });

  if (updated.count !== 1) {
    return null;
  }

  // Ensure any remaining undeleted files are marked printed when job completes.
  await prisma.printJobFile.updateMany({
    where: {
      printJobId: jobId,
      printedAt: null,
      fileDeletedAt: null,
    },
    data: { printedAt: new Date() },
  });

  return prisma.printJob.findFirst({
    where: { id: jobId, shopId },
  });
}

export async function markFilePrinted(
  shopId: string,
  jobId: string,
  fileId: string,
) {
  const job = await prisma.printJob.findFirst({
    where: {
      id: jobId,
      shopId,
      status: PrintStatus.PRINTING,
    },
    select: { id: true },
  });

  if (!job) return null;

  const file = await prisma.printJobFile.findFirst({
    where: {
      id: fileId,
      printJobId: jobId,
      fileDeletedAt: null,
    },
  });

  if (!file) return null;

  return prisma.printJobFile.update({
    where: { id: fileId },
    data: { printedAt: file.printedAt ?? new Date() },
  });
}

/**
 * Safety cleanup: remove upload files older than 1 hour.
 * Files are kept after printing so the shop can preview until retention expires.
 * Does not delete files for PRINTING jobs still inside the retention window.
 */
export async function cleanupExpiredDocuments() {
  const cutoff = new Date(Date.now() - DOCUMENT_RETENTION_MS);

  const files = await prisma.printJobFile.findMany({
    where: {
      fileDeletedAt: null,
      createdAt: { lt: cutoff },
      printJob: {
        OR: [
          { status: { not: PrintStatus.PRINTING } },
          {
            status: PrintStatus.PRINTING,
            updatedAt: { lt: cutoff },
          },
        ],
      },
    },
    select: {
      id: true,
      storedFileName: true,
      printJobId: true,
      printJob: {
        select: { status: true },
      },
    },
  });

  let deleted = 0;
  const expiredPendingJobIds = new Set<string>();

  for (const file of files) {
    try {
      await unlink(getStoredFilePath(file.storedFileName));
    } catch {
      // File may already be gone
    }
    await prisma.printJobFile.update({
      where: { id: file.id },
      data: { fileDeletedAt: new Date() },
    });
    if (
      file.printJob.status === PrintStatus.PENDING ||
      file.printJob.status === PrintStatus.PRINTING
    ) {
      expiredPendingJobIds.add(file.printJobId);
    }
    deleted += 1;
  }

  // Expired unprinted jobs must not keep inflating the Pending count.
  if (expiredPendingJobIds.size > 0) {
    await prisma.printJob.updateMany({
      where: {
        id: { in: [...expiredPendingJobIds] },
        status: {
          in: [PrintStatus.PENDING, PrintStatus.PRINTING],
        },
      },
      data: {
        status: PrintStatus.CANCELLED,
        printAttempts: MAX_PRINT_ATTEMPTS,
        lastError:
          "Document expired and was deleted after 1 hour. Submit a new print job.",
      },
    });
  }

  // Stuck PRINTING jobs (crash / failed report) → PENDING so Agent can retry
  const printingCutoff = new Date(Date.now() - STALE_PRINTING_MS);
  await prisma.printJob.updateMany({
    where: {
      status: PrintStatus.PRINTING,
      updatedAt: { lt: printingCutoff },
      // Only recover jobs that still have a document
      files: { some: { fileDeletedAt: null } },
    },
    data: {
      status: PrintStatus.PENDING,
      lastError: "Recovered stale PRINTING job after Agent disconnect.",
    },
  });

  return deleted;
}

export async function getShopAgentStatus(shopId: string) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      agentId: true,
      agentLastSeen: true,
      printers: {
        where: { isDefault: true },
        take: 1,
        select: {
          printerName: true,
          status: true,
          lastSeen: true,
        },
      },
    },
  });

  if (!shop) return null;

  const defaultPrinter = shop.printers[0] ?? null;
  const online =
    !!shop.agentLastSeen &&
    Date.now() - shop.agentLastSeen.getTime() <= 15_000;

  return {
    agentId: shop.agentId,
    connected: online,
    lastSeen: shop.agentLastSeen?.toISOString() ?? null,
    printerName: defaultPrinter?.printerName ?? null,
    printerStatus: defaultPrinter?.status ?? "offline",
    printerOffline: defaultPrinter
      ? defaultPrinter.status.toLowerCase() === "offline"
      : false,
  };
}
