"use server";

import { PrintMode, PrintType } from "@prisma/client";
import { z } from "zod";

import { runDocumentCleanupIfDue } from "@/lib/cleanup";
import { createPrintJob } from "@/lib/job-service";
import { logError, logInfo } from "@/lib/log";
import { getShopDefaultColorSupported } from "@/lib/print-agent-service";
import {
  calculatePrintCost,
  getShopWithPricing,
  toPricingRates,
} from "@/lib/pricing-service";
import {
  buildPrintSettingsV1,
  isValidPageRange,
  type PrintMarginsV1,
  type PrintOrientationV1,
  type PrintScaleV1,
} from "@/lib/print-settings";
import { resolveJobPrintCategory } from "@/lib/print-file-category";
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
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  scale: z.enum(["fit", "noscale"]).default("fit"),
  margins: z.enum(["normal", "none"]).default("normal"),
  pagesMode: z.enum(["all", "custom"]).default("all"),
  pageRange: z.string().trim().max(120).optional().default(""),
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
  if (lower.includes("page")) {
    return "Please enter a valid page range (e.g. 1-5 or 1,3,7).";
  }

  return "Something went wrong while uploading. Please try again.";
}

export async function submitPrintJobAction(
  formData: FormData,
): Promise<ApiResponse<UploadSuccessData>> {
  try {
    // Intentionally ignore any client printType / DOUBLE — new jobs are SINGLE only.
    const parsed = submitSchema.safeParse({
      shopCode: formData.get("shopCode"),
      copies: formData.get("copies"),
      printMode: formData.get("printMode") || PrintMode.BW,
      orientation: formData.get("orientation") || "portrait",
      scale: formData.get("scale") || "fit",
      margins: formData.get("margins") || "normal",
      pagesMode: formData.get("pagesMode") || "all",
      pageRange: formData.get("pageRange") || "",
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

    // Re-check current default printer at submit time (never trust page props / client).
    const colorSupported = await getShopDefaultColorSupported(shop.id);
    let printMode = parsed.data.printMode;
    if (printMode === PrintMode.COLOR && !colorSupported) {
      return {
        success: false,
        error:
          "Color printing is not available right now. Please choose Black & White.",
      };
    }
    if (!colorSupported) {
      printMode = PrintMode.BW;
    }

    let pageRange = "all";
    let scale: PrintScaleV1 = "fit";
    let margins: PrintMarginsV1 = "normal";

    // Derive category from actual uploaded files — never trust client category.
    const aggregateCategory = resolveJobPrintCategory(
      files.map((f) => ({ name: f.name, type: f.type })),
    );

    if (aggregateCategory === "DOCUMENT") {
      scale = parsed.data.scale === "noscale" ? "noscale" : "fit";
      margins = "normal";
      if (parsed.data.pagesMode === "custom") {
        const raw = parsed.data.pageRange?.trim() || "";
        if (!raw || !isValidPageRange(raw) || raw.toLowerCase() === "all") {
          return {
            success: false,
            error: "Please enter a valid page range (e.g. 1-5 or 1,3,7).",
          };
        }
        pageRange = raw;
      }
    } else if (aggregateCategory === "IMAGE") {
      scale = "fit";
      margins = parsed.data.margins === "none" ? "none" : "normal";
      pageRange = "all";
    } else {
      // MIXED (or NONE): only job-safe settings
      scale = "fit";
      margins = "normal";
      pageRange = "all";
    }

    const savedFiles = await saveUploadFiles(files);
    const totalPages = savedFiles.reduce((sum, file) => sum + file.totalPages, 0);
    const rates = toPricingRates(shop.printPrice);

    // Pricing: full document pages × copies × SINGLE rates. Page range does not change price.
    const forcedPrintType = PrintType.SINGLE;
    const totalPrice = calculatePrintCost(
      rates,
      totalPages,
      parsed.data.copies,
      printMode,
      forcedPrintType,
    );

    const printSettings = buildPrintSettingsV1({
      copies: parsed.data.copies,
      orientation: parsed.data.orientation as PrintOrientationV1,
      scale,
      margins,
      pageRange,
      paperSize: "A4",
    });

    const job = await createPrintJob({
      shopId: shop.id,
      copies: parsed.data.copies,
      totalPages,
      printMode,
      printType: forcedPrintType,
      totalPrice,
      printSettings,
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
