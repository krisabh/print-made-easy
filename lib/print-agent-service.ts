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

export class PrinterOwnershipError extends Error {
  constructor(message = "Invalid printer ownership.") {
    super(message);
    this.name = "PrinterOwnershipError";
  }
}

/**
 * Set AgentDevice.localDefaultPrinterId after ownership validation.
 * Printer must belong to the same AgentDevice and Shop.
 */
export async function setAgentDeviceLocalDefault(input: {
  shopId: string;
  agentDeviceId: string;
  printerId: string;
}) {
  const device = await prisma.agentDevice.findFirst({
    where: { id: input.agentDeviceId, shopId: input.shopId },
    select: { id: true },
  });
  if (!device) {
    throw new PrinterOwnershipError(
      "Printer AgentDevice does not belong to this Shop.",
    );
  }

  const printer = await prisma.printer.findFirst({
    where: {
      id: input.printerId,
      shopId: input.shopId,
      agentDeviceId: input.agentDeviceId,
    },
    select: { id: true },
  });
  if (!printer) {
    throw new PrinterOwnershipError(
      "Default printer must belong to this AgentDevice.",
    );
  }

  await prisma.agentDevice.update({
    where: { id: input.agentDeviceId },
    data: { localDefaultPrinterId: printer.id },
  });

  return printer.id;
}

/**
 * Upsert a shop printer.
 * - AgentDevice auth: identity is (agentDeviceId, printerName); default → localDefaultPrinterId.
 * - Legacy Shop-token auth: identity is (shopId, printerName) among NULL rows; default → Printer.isDefault.
 * Does not invent AgentDevice rows. Does not migrate NULL → device during heartbeat.
 */
export async function upsertShopPrinter(input: {
  shopId: string;
  printerName: string;
  printerModel?: string | null;
  status: string;
  isDefault: boolean;
  /** Authenticated AgentDevice id — never trust a client-supplied value alone. */
  agentDeviceId?: string | null;
}) {
  const agentDeviceId = input.agentDeviceId?.trim() || null;

  if (agentDeviceId) {
    const device = await prisma.agentDevice.findFirst({
      where: { id: agentDeviceId, shopId: input.shopId },
      select: { id: true },
    });
    if (!device) {
      throw new PrinterOwnershipError(
        "Printer AgentDevice does not belong to this Shop.",
      );
    }
  }

  // Legacy only: shop-wide isDefault clear. Device path must never touch siblings.
  if (input.isDefault && !agentDeviceId) {
    await prisma.printer.updateMany({
      where: { shopId: input.shopId },
      data: { isDefault: false },
    });
  }

  // Intentionally omit colorSupported on update so heartbeat never overwrites
  // the shopkeeper's manual capability. New rows get schema default false.
  if (agentDeviceId) {
    const updateData = {
      shopId: input.shopId,
      printerModel: input.printerModel ?? undefined,
      status: input.status,
      lastSeen: new Date(),
    };
    const createData = {
      shopId: input.shopId,
      agentDeviceId,
      printerName: input.printerName,
      printerModel: input.printerModel ?? null,
      status: input.status,
      // Device rows do not use Printer.isDefault as authority.
      isDefault: false,
      colorSupported: false,
      lastSeen: new Date(),
    };

    let printer;
    try {
      printer = await prisma.printer.upsert({
        where: {
          agentDeviceId_printerName: {
            agentDeviceId,
            printerName: input.printerName,
          },
        },
        update: updateData,
        create: createData,
      });
    } catch (error) {
      // MySQL upsert races can hit the unique key on concurrent creates.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        printer = await prisma.printer.update({
          where: {
            agentDeviceId_printerName: {
              agentDeviceId,
              printerName: input.printerName,
            },
          },
          data: updateData,
        });
      } else {
        throw error;
      }
    }

    if (input.isDefault) {
      await setAgentDeviceLocalDefault({
        shopId: input.shopId,
        agentDeviceId,
        printerId: printer.id,
      });
    }

    return printer;
  }

  // Legacy shop-token path: only rows with agentDeviceId NULL.
  const existing = await prisma.printer.findFirst({
    where: {
      shopId: input.shopId,
      printerName: input.printerName,
      agentDeviceId: null,
    },
    select: { id: true },
  });

  if (existing) {
    return prisma.printer.update({
      where: { id: existing.id },
      data: {
        printerModel: input.printerModel ?? undefined,
        status: input.status,
        isDefault: input.isDefault,
        lastSeen: new Date(),
      },
    });
  }

  return prisma.printer.create({
    data: {
      shopId: input.shopId,
      agentDeviceId: null,
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
  options?: { agentDeviceId?: string | null },
): Promise<ShopPrinterCapability[]> {
  const agentDeviceId = options?.agentDeviceId?.trim() || null;

  if (agentDeviceId) {
    const device = await prisma.agentDevice.findFirst({
      where: { id: agentDeviceId, shopId },
      select: { localDefaultPrinterId: true },
    });
    const rows = await prisma.printer.findMany({
      where: { shopId, agentDeviceId },
      orderBy: [{ printerName: "asc" }],
      select: {
        id: true,
        printerName: true,
        colorSupported: true,
        status: true,
      },
    });
    return rows
      .map((row) => ({
        printerName: row.printerName,
        colorSupported: row.colorSupported,
        status: row.status,
        isDefault: device?.localDefaultPrinterId === row.id,
      }))
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.printerName.localeCompare(b.printerName);
      });
  }

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
 * Device auth: scopes to that AgentDevice. Legacy: agentDeviceId NULL rows only.
 */
export async function setShopPrinterColorSupported(input: {
  shopId: string;
  printerName: string;
  colorSupported: boolean;
  status?: string;
  agentDeviceId?: string | null;
}) {
  const printerName = input.printerName.trim();
  if (!printerName) {
    return { ok: false as const, error: "invalid_name" as const };
  }

  const agentDeviceId = input.agentDeviceId?.trim() || null;
  if (agentDeviceId) {
    const device = await prisma.agentDevice.findFirst({
      where: { id: agentDeviceId, shopId: input.shopId },
      select: { id: true, localDefaultPrinterId: true },
    });
    if (!device) {
      throw new PrinterOwnershipError(
        "Printer AgentDevice does not belong to this Shop.",
      );
    }

    const existing = await prisma.printer.findUnique({
      where: {
        agentDeviceId_printerName: {
          agentDeviceId,
          printerName,
        },
      },
      select: { id: true },
    });

    if (!existing) {
      const created = await prisma.printer.create({
        data: {
          shopId: input.shopId,
          agentDeviceId,
          printerName,
          colorSupported: input.colorSupported,
          isDefault: false,
          status: (input.status || "unknown").toLowerCase(),
          lastSeen: new Date(),
        },
        select: {
          id: true,
          printerName: true,
          colorSupported: true,
          status: true,
        },
      });
      return {
        ok: true as const,
        printer: {
          printerName: created.printerName,
          colorSupported: created.colorSupported,
          isDefault: device.localDefaultPrinterId === created.id,
          status: created.status,
        },
      };
    }

    const updated = await prisma.printer.update({
      where: { id: existing.id },
      data: { colorSupported: input.colorSupported },
      select: {
        id: true,
        printerName: true,
        colorSupported: true,
        status: true,
      },
    });
    return {
      ok: true as const,
      printer: {
        printerName: updated.printerName,
        colorSupported: updated.colorSupported,
        isDefault: device.localDefaultPrinterId === updated.id,
        status: updated.status,
      },
    };
  }

  const existing = await prisma.printer.findFirst({
    where: {
      shopId: input.shopId,
      printerName,
      agentDeviceId: null,
    },
    select: { id: true },
  });

  if (!existing) {
    const created = await prisma.printer.create({
      data: {
        shopId: input.shopId,
        agentDeviceId: null,
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
 * Resolution order:
 * 1. Freshest AgentDevice with a localDefaultPrinterId → that printer's colorSupported
 * 2. Legacy shop-wide Printer.isDefault=true → colorSupported
 * No default → false (safe). Does not expose printer names/IDs.
 */
export async function getShopDefaultColorSupported(
  shopId: string,
): Promise<boolean> {
  const deviceDefault = await prisma.agentDevice.findFirst({
    where: {
      shopId,
      localDefaultPrinterId: { not: null },
    },
    orderBy: [{ lastSeen: "desc" }, { updatedAt: "desc" }],
    select: {
      localDefaultPrinter: {
        select: { colorSupported: true },
      },
    },
  });
  if (deviceDefault?.localDefaultPrinter) {
    return deviceDefault.localDefaultPrinter.colorSupported === true;
  }

  const printer = await prisma.printer.findFirst({
    where: { shopId, isDefault: true },
    select: { colorSupported: true },
  });
  return printer?.colorSupported === true;
}

export async function listPendingJobsForShop(
  shopId: string,
  options?: { agentDeviceId?: string | null },
) {
  const agentDeviceId = options?.agentDeviceId?.trim() || null;

  /**
   * Feature 2 Phase 2E — concurrency gate:
   * - Device auth: at most one PRINTING job per AgentDevice (other devices may print).
   * - Legacy Shop-token: keep shop-wide single PRINTING (existing single-Agent safety).
   */
  if (agentDeviceId) {
    const myPrinting = await prisma.printJob.count({
      where: {
        shopId,
        status: PrintStatus.PRINTING,
        claimedByAgentDeviceId: agentDeviceId,
      },
    });
    if (myPrinting > 0) {
      return [];
    }
  } else {
    const printingCount = await prisma.printJob.count({
      where: { shopId, status: PrintStatus.PRINTING },
    });
    if (printingCount > 0) {
      return [];
    }
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

const jobClaimInclude = {
  files: {
    where: { fileDeletedAt: null },
    orderBy: { createdAt: "asc" as const },
  },
};

/**
 * Atomic claim: PENDING → PRINTING for this shop.
 * Device auth: sets claimedByAgentDeviceId + claimedAt; one PRINTING per device.
 * Legacy: claimedByAgentDeviceId stays null; shop-wide one PRINTING preserved.
 *
 * Phase 2F: serialize per-device (or per-shop legacy) claims with SELECT … FOR UPDATE
 * on the AgentDevice/Shop row so the count-then-CAS gate cannot admit two PRINTING
 * jobs for the same claimant under concurrent requests.
 */
export async function claimJob(
  shopId: string,
  jobId: string,
  options?: { agentDeviceId?: string | null },
) {
  const agentDeviceId = options?.agentDeviceId?.trim() || null;
  const claimedAt = new Date();

  return prisma.$transaction(async (tx) => {
    if (agentDeviceId) {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM AgentDevice WHERE id = ${agentDeviceId} FOR UPDATE
      `;
      if (locked.length === 0) {
        return null;
      }

      const myPrinting = await tx.printJob.count({
        where: {
          shopId,
          status: PrintStatus.PRINTING,
          claimedByAgentDeviceId: agentDeviceId,
          NOT: { id: jobId },
        },
      });
      if (myPrinting > 0) {
        return null;
      }
    } else {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM Shop WHERE id = ${shopId} FOR UPDATE
      `;
      if (locked.length === 0) {
        return null;
      }

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
        claimedByAgentDeviceId: agentDeviceId,
        claimedAt,
      },
    });

    if (updated.count === 1) {
      return tx.printJob.findFirst({
        where: { id: jobId, shopId },
        include: jobClaimInclude,
      });
    }

    // Idempotent retry: already PRINTING and owned by this claimant.
    return tx.printJob.findFirst({
      where: agentDeviceId
        ? {
            id: jobId,
            shopId,
            status: PrintStatus.PRINTING,
            claimedByAgentDeviceId: agentDeviceId,
          }
        : {
            id: jobId,
            shopId,
            status: PrintStatus.PRINTING,
            claimedByAgentDeviceId: null,
          },
      include: jobClaimInclude,
    });
  });
}

/**
 * Assert the authenticated Agent may act on a PRINTING job.
 * Device auth: must own claimedByAgentDeviceId.
 * Legacy: only jobs with null device ownership.
 */
export async function assertPrintJobActor(
  shopId: string,
  jobId: string,
  options?: { agentDeviceId?: string | null },
) {
  const agentDeviceId = options?.agentDeviceId?.trim() || null;
  return prisma.printJob.findFirst({
    where: agentDeviceId
      ? {
          id: jobId,
          shopId,
          status: PrintStatus.PRINTING,
          claimedByAgentDeviceId: agentDeviceId,
        }
      : {
          id: jobId,
          shopId,
          status: PrintStatus.PRINTING,
          claimedByAgentDeviceId: null,
        },
    select: {
      id: true,
      status: true,
      jobNumber: true,
      claimedByAgentDeviceId: true,
      claimedAt: true,
    },
  });
}

export async function releaseJobToPending(
  shopId: string,
  jobId: string,
  errorMessage: string,
  options?: { agentDeviceId?: string | null },
) {
  const owned = await assertPrintJobActor(shopId, jobId, options);
  if (!owned) {
    return null;
  }

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
      claimedByAgentDeviceId: null,
      claimedAt: null,
      lastError: keepRetrying
        ? errorMessage
        : permanent
          ? errorMessage
          : `Failed after ${MAX_PRINT_ATTEMPTS} attempts: ${errorMessage}`,
    },
  });
}

export async function markJobReady(
  shopId: string,
  jobId: string,
  options?: { agentDeviceId?: string | null },
) {
  const agentDeviceId = options?.agentDeviceId?.trim() || null;
  const updated = await prisma.printJob.updateMany({
    where: agentDeviceId
      ? {
          id: jobId,
          shopId,
          status: PrintStatus.PRINTING,
          claimedByAgentDeviceId: agentDeviceId,
        }
      : {
          id: jobId,
          shopId,
          status: PrintStatus.PRINTING,
          claimedByAgentDeviceId: null,
        },
    data: {
      status: PrintStatus.READY_FOR_PICKUP,
      lastError: null,
      // Retain claimedByAgentDeviceId / claimedAt for history.
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
  options?: { agentDeviceId?: string | null },
) {
  const job = await assertPrintJobActor(shopId, jobId, options);
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
      claimedByAgentDeviceId: null,
      claimedAt: null,
      lastError: "Recovered stale PRINTING job after Agent disconnect.",
    },
  });

  return deleted;
}

type HeartbeatFreshnessRow = {
  agentId: string | null;
  agentLastSeen: Date | null;
  deviceLastSeenMax: Date | null;
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

/**
 * Feature 2 Phase 2D — shop Agent online if ANY AgentDevice has a fresh lastSeen,
 * else fall back to legacy Shop.agentLastSeen. Never uses device count alone.
 */
async function getShopHeartbeatFreshness(shopId: string) {
  const rows = await prisma.$queryRaw<HeartbeatFreshnessRow[]>(Prisma.sql`
    SELECT
      s.agentId AS agentId,
      s.agentLastSeen AS agentLastSeen,
      (
        SELECT MAX(ad.lastSeen)
        FROM AgentDevice ad
        WHERE ad.shopId = s.id
      ) AS deviceLastSeenMax,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM AgentDevice ad
          WHERE ad.shopId = s.id
            AND ${sqlIsFreshHeartbeat(Prisma.raw("ad.lastSeen"))}
        )
        OR ${sqlIsFreshHeartbeat(Prisma.raw("s.agentLastSeen"))}
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

function pickMostRecentLastSeen(
  legacy: Date | null | undefined,
  deviceMax: Date | null | undefined,
): Date | null {
  const a = legacy ? new Date(legacy).getTime() : null;
  const b = deviceMax ? new Date(deviceMax).getTime() : null;
  if (a == null && b == null) return null;
  if (a == null) return new Date(b!);
  if (b == null) return new Date(a);
  return new Date(Math.max(a, b));
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

  const lastSeen = pickMostRecentLastSeen(
    row.agentLastSeen,
    row.deviceLastSeenMax,
  );

  return {
    agentId: row.agentId,
    connected: agentOnline,
    lastSeen: lastSeen ? lastSeen.toISOString() : null,
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

/** Safe AgentDevice summary for dashboard — never includes token/hash. */
export type ShopAgentDeviceSummary = {
  id: string;
  agentId: string;
  createdAt: string;
  lastSeen: string | null;
};

/**
 * Feature 2 Phase 2B.2 — list paired AgentDevices for a shop.
 * lastSeen is device-reported; shop-level online aggregates device + legacy (Phase 2D).
 */
export async function listShopAgentDevices(
  shopId: string,
): Promise<ShopAgentDeviceSummary[]> {
  const rows = await prisma.agentDevice.findMany({
    where: { shopId },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      agentId: true,
      createdAt: true,
      lastSeen: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    agentId: row.agentId,
    createdAt: row.createdAt.toISOString(),
    lastSeen: row.lastSeen ? row.lastSeen.toISOString() : null,
  }));
}
