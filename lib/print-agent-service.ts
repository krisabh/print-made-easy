import { unlink } from "fs/promises";
import { Prisma, PrintStatus } from "@prisma/client";

import {
  AGENT_CLOCK_SKEW_MS,
  AGENT_OFFLINE_MS,
  DOCUMENT_RETENTION_MS,
  MAX_PRINT_ATTEMPTS,
  STALE_PRINTING_MS,
  isReportedPrinterOnline,
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

  // Intentionally omit colorSupported on update so heartbeat never overwrites
  // the shopkeeper's manual capability. New rows get schema default false.
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
      colorSupported: false,
      lastSeen: new Date(),
    },
  });
}

export type ShopPrinterCapability = {
  printerName: string;
  colorSupported: boolean;
  isDefault: boolean;
  status: string;
};

export async function listShopPrinterCapabilities(
  shopId: string,
): Promise<ShopPrinterCapability[]> {
  const rows = await prisma.printer.findMany({
    where: { shopId },
    orderBy: [{ isDefault: "desc" }, { printerName: "asc" }],
    select: {
      printerName: true,
      colorSupported: true,
      isDefault: true,
      status: true,
    },
  });
  return rows;
}

/**
 * Persist manual color capability for one printer in the authenticated shop.
 * Does not change isDefault or selectedPrinter semantics.
 * Creates the Printer row if missing (so capability can be set before/without a racey heartbeat).
 */
export async function setShopPrinterColorSupported(input: {
  shopId: string;
  printerName: string;
  colorSupported: boolean;
  status?: string;
}) {
  const printerName = input.printerName.trim();
  if (!printerName) {
    return { ok: false as const, error: "invalid_name" as const };
  }

  const existing = await prisma.printer.findUnique({
    where: {
      shopId_printerName: {
        shopId: input.shopId,
        printerName,
      },
    },
    select: { id: true },
  });

  if (!existing) {
    const created = await prisma.printer.create({
      data: {
        shopId: input.shopId,
        printerName,
        colorSupported: input.colorSupported,
        isDefault: false,
        status: (input.status || "unknown").toLowerCase(),
        lastSeen: new Date(),
      },
      select: {
        printerName: true,
        colorSupported: true,
        isDefault: true,
        status: true,
      },
    });
    return { ok: true as const, printer: created };
  }

  const updated = await prisma.printer.update({
    where: { id: existing.id },
    data: { colorSupported: input.colorSupported },
    select: {
      printerName: true,
      colorSupported: true,
      isDefault: true,
      status: true,
    },
  });

  return { ok: true as const, printer: updated };
}

/**
 * Customer-facing capability: does the shop's current default printer support Color?
 * No default printer → false (safe). Does not expose printer names/IDs.
 */
export async function getShopDefaultColorSupported(
  shopId: string,
): Promise<boolean> {
  const printer = await prisma.printer.findFirst({
    where: { shopId, isDefault: true },
    select: { colorSupported: true },
  });
  return printer?.colorSupported === true;
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
      printSettings: true,
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

type HeartbeatFreshnessRow = {
  agentId: string | null;
  agentLastSeen: Date | null;
  agentFresh: number | bigint;
  printerName: string | null;
  printerStatus: string | null;
  printerLastSeen: Date | null;
  printerFresh: number | bigint;
};

function heartbeatWindowSeconds() {
  const timeoutSec = Math.ceil(AGENT_OFFLINE_MS / 1000);
  const skewSec = Math.ceil(AGENT_CLOCK_SKEW_MS / 1000);
  if (
    !Number.isInteger(timeoutSec) ||
    timeoutSec < 1 ||
    timeoutSec > 3600 ||
    !Number.isInteger(skewSec) ||
    skewSec < 0 ||
    skewSec > 60
  ) {
    throw new Error("Invalid agent heartbeat freshness window.");
  }
  return {
    timeoutSql: Prisma.raw(String(timeoutSec)),
    skewSql: Prisma.raw(String(skewSec)),
  };
}

/**
 * True when `column` is within AGENT_OFFLINE_MS of MySQL NOW() or UTC_TIMESTAMP().
 *
 * Prisma MySQL DateTime has no timezone. Depending on session TZ, a live
 * heartbeat may be stored in local wall-clock or UTC wall-clock. Comparing
 * only in JavaScript (Date.now() - lastSeen) can treat a stopped agent as
 * still online for hours (lastSeen appears in the future) or treat a live
 * agent as offline. SQL comparison against both clocks, with an upper bound,
 * is the source of truth for dashboard status.
 */
function sqlIsFreshHeartbeat(column: Prisma.Sql) {
  const { timeoutSql, skewSql } = heartbeatWindowSeconds();
  return Prisma.sql`
    ${column} IS NOT NULL
    AND (
      (
        ${column} >= (UTC_TIMESTAMP() - INTERVAL ${timeoutSql} SECOND)
        AND ${column} <= (UTC_TIMESTAMP() + INTERVAL ${skewSql} SECOND)
      )
      OR
      (
        ${column} >= (NOW() - INTERVAL ${timeoutSql} SECOND)
        AND ${column} <= (NOW() + INTERVAL ${skewSql} SECOND)
      )
    )
  `;
}

async function getShopHeartbeatFreshness(shopId: string) {
  const rows = await prisma.$queryRaw<HeartbeatFreshnessRow[]>(Prisma.sql`
    SELECT
      s.agentId AS agentId,
      s.agentLastSeen AS agentLastSeen,
      CASE
        WHEN ${sqlIsFreshHeartbeat(Prisma.raw("s.agentLastSeen"))}
        THEN 1 ELSE 0
      END AS agentFresh,
      p.printerName AS printerName,
      p.status AS printerStatus,
      p.lastSeen AS printerLastSeen,
      CASE
        WHEN ${sqlIsFreshHeartbeat(Prisma.raw("p.lastSeen"))}
        THEN 1 ELSE 0
      END AS printerFresh
    FROM Shop s
    LEFT JOIN Printer p
      ON p.shopId = s.id AND p.isDefault = 1
    WHERE s.id = ${shopId}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function getShopAgentStatus(shopId: string) {
  const row = await getShopHeartbeatFreshness(shopId);
  if (!row) return null;

  const agentOnline = Number(row.agentFresh) === 1;
  const printerReportFresh = Number(row.printerFresh) === 1;
  const printerOnline =
    agentOnline &&
    printerReportFresh &&
    isReportedPrinterOnline(row.printerStatus);

  return {
    agentId: row.agentId,
    connected: agentOnline,
    lastSeen: row.agentLastSeen ? new Date(row.agentLastSeen).toISOString() : null,
    printerName: row.printerName,
    printerStatus: printerOnline ? row.printerStatus : "offline",
    printerOffline: !printerOnline,
  };
}

type PrinterLiveStatusRow = {
  id: string;
  printerName: string;
  status: string;
  lastSeen: Date | null;
  isDefault: number | boolean;
  reportFresh: number | bigint;
};

export async function listShopPrintersWithLiveStatus(shopId: string) {
  const agent = await getShopHeartbeatFreshness(shopId);
  const agentOnline = agent ? Number(agent.agentFresh) === 1 : false;

  const rows = await prisma.$queryRaw<PrinterLiveStatusRow[]>(Prisma.sql`
    SELECT
      p.id AS id,
      p.printerName AS printerName,
      p.status AS status,
      p.lastSeen AS lastSeen,
      p.isDefault AS isDefault,
      CASE
        WHEN ${sqlIsFreshHeartbeat(Prisma.raw("p.lastSeen"))}
        THEN 1 ELSE 0
      END AS reportFresh
    FROM Printer p
    WHERE p.shopId = ${shopId}
    ORDER BY p.isDefault DESC, p.printerName ASC
  `);

  return rows.map((printer) => {
    const reportFresh = Number(printer.reportFresh) === 1;
    const online =
      agentOnline && reportFresh && isReportedPrinterOnline(printer.status);
    return {
      id: printer.id,
      printerName: printer.printerName,
      isDefault: Boolean(printer.isDefault),
      lastSeen: printer.lastSeen ? new Date(printer.lastSeen) : null,
      status: online ? printer.status : "offline",
    };
  });
}
