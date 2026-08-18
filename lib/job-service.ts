import {
  PrintMode,
  PrintStatus,
  PrintType,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { SavedUploadFile } from "@/lib/upload-service";

export type CreatePrintJobInput = {
  shopId: string;
  copies: number;
  totalPages: number;
  printMode: PrintMode;
  printType: PrintType;
  totalPrice: number;
  files: SavedUploadFile[];
};

function formatJobNumber(sequence: number) {
  return `PME-${String(sequence).padStart(6, "0")}`;
}

/**
 * Allocate next shop-local sequence under a row lock on Shop.
 * Concurrent uploads for the same shop serialize on SELECT ... FOR UPDATE.
 */
async function allocateShopJobSequence(
  tx: Prisma.TransactionClient,
  shopId: string,
) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT \`id\` FROM \`Shop\` WHERE \`id\` = ${shopId} FOR UPDATE
  `;

  if (!locked.length) {
    throw new Error("Shop not found.");
  }

  const lastJob = await tx.printJob.findFirst({
    where: { shopId },
    orderBy: { jobSequence: "desc" },
    select: { jobSequence: true },
  });

  const nextSequence = (lastJob?.jobSequence ?? 0) + 1;
  return {
    jobSequence: nextSequence,
    jobNumber: formatJobNumber(nextSequence),
  };
}

export async function createPrintJob(input: CreatePrintJobInput) {
  return prisma.$transaction(async (tx) => {
    const { jobSequence, jobNumber } = await allocateShopJobSequence(
      tx,
      input.shopId,
    );

    const printJob = await tx.printJob.create({
      data: {
        shopId: input.shopId,
        jobSequence,
        jobNumber,
        copies: input.copies,
        totalPages: input.totalPages,
        printMode: input.printMode,
        printType: input.printType,
        totalPrice: input.totalPrice,
        status: PrintStatus.PENDING,
        files: {
          create: input.files.map((file) => ({
            originalFileName: file.originalFileName,
            storedFileName: file.storedFileName,
            fileExtension: file.fileExtension,
            fileSize: file.fileSize,
            totalPages: file.totalPages,
          })),
        },
      },
      include: {
        files: true,
      },
    });

    return printJob;
  });
}
