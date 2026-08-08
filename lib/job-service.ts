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

async function generateJobNumber(tx: Prisma.TransactionClient) {
  const lastJob = await tx.printJob.findFirst({
    where: {
      jobNumber: {
        startsWith: "PME-",
      },
    },
    orderBy: {
      jobNumber: "desc",
    },
    select: {
      jobNumber: true,
    },
  });

  let nextNumber = 1;

  if (lastJob?.jobNumber) {
    const parsed = Number.parseInt(lastJob.jobNumber.replace("PME-", ""), 10);
    if (!Number.isNaN(parsed)) {
      nextNumber = parsed + 1;
    }
  }

  return `PME-${String(nextNumber).padStart(6, "0")}`;
}

export async function createPrintJob(input: CreatePrintJobInput) {
  return prisma.$transaction(async (tx) => {
    const jobNumber = await generateJobNumber(tx);

    const printJob = await tx.printJob.create({
      data: {
        shopId: input.shopId,
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
