"use server";

import { PrintMode, PrintType } from "@prisma/client";
import { z } from "zod";

import { runDocumentCleanupIfDue } from "@/lib/cleanup";
import { createPrintJob } from "@/lib/job-service";
import { logError, logInfo } from "@/lib/log";
import {
  calculatePrintCost,
  getShopWithPricing,
  toPricingRates,
} from "@/lib/pricing-service";
import { hasSubscriptionAccess } from "@/lib/subscription";
import { saveUploadFiles, validateUploadFiles } from "@/lib/upload-service";
import type { ApiResponse, UploadSuccessData } from "@/types";

const submitSchema = z.object({
  shopCode: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Invalid shop code."),
  copies: z.coerce.number().int().min(1, "Copies must be at least 1.").max(100),
  printMode: z.nativeEnum(PrintMode),
  printType: z.nativeEnum(PrintType),
});

function toFriendlyError(message: string) {
  const lower = message.toLowerCase();

  if (lower.includes("not allowed") || lower.includes("file type")) {
    return "This file type is not supported.";
  }
  if (lower.includes("size") || lower.includes("mb")) {
    return "File size must be less than 20 MB.";
  }
  if (lower.includes("maximum") && lower.includes("files")) {
    return "You can upload a maximum of 10 files.";
  }
  if (lower.includes("at least one")) {
    return "Please upload at least one document.";
  }
  if (lower.includes("invalid shop")) {
    return "Sorry, this print shop link is no longer available.";
  }

  return "Something went wrong while uploading. Please try again.";
}

export async function submitPrintJobAction(
  formData: FormData,
): Promise<ApiResponse<UploadSuccessData>> {
  try {
    const parsed = submitSchema.safeParse({
      shopCode: formData.get("shopCode"),
      copies: formData.get("copies"),
      printMode: formData.get("printMode"),
      printType: formData.get("printType"),
    });

    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Please check the form and try again.",
      };
    }

    const files = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    const fileError = validateUploadFiles(files);
    if (fileError) {
      return { success: false, error: toFriendlyError(fileError) };
    }

    const shop = await getShopWithPricing(parsed.data.shopCode);

    if (!shop || !shop.printPrice) {
      return {
        success: false,
        error: "Sorry, this print shop link is no longer available.",
      };
    }

    const shopHasAccess = await hasSubscriptionAccess(shop.id);
    if (!shopHasAccess) {
      return {
        success: false,
        error: "This print shop is temporarily unavailable. Please try again later.",
      };
    }

    const savedFiles = await saveUploadFiles(files);
    const totalPages = savedFiles.reduce((sum, file) => sum + file.totalPages, 0);
    const rates = toPricingRates(shop.printPrice);

    // Server is the source of truth for final price
    const totalPrice = calculatePrintCost(
      rates,
      totalPages,
      parsed.data.copies,
      parsed.data.printMode,
      parsed.data.printType,
    );

    const job = await createPrintJob({
      shopId: shop.id,
      copies: parsed.data.copies,
      totalPages,
      printMode: parsed.data.printMode,
      printType: parsed.data.printType,
      totalPrice,
      files: savedFiles,
    });

    logInfo("job_created", `${job.jobNumber} shop=${shop.shopCode}`);
    void runDocumentCleanupIfDue();

    return {
      success: true,
      data: {
        jobId: job.id,
        jobNumber: job.jobNumber,
        totalPrice: Number(job.totalPrice),
        totalPages,
        copies: parsed.data.copies,
      },
    };
  } catch (error) {
    logError("job_create_failed", error);
    return {
      success: false,
      error: "Something went wrong while uploading. Please try again.",
    };
  }
}
