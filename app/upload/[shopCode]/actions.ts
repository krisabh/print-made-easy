"use server";

import { PrintMode, PrintType } from "@prisma/client";
import { z } from "zod";

import { runDocumentCleanupIfDue } from "@/lib/cleanup";
import {
  cleanupIdCardArtifact,
  composeAndSaveIdCardPdf,
  composeIdCardPdfInMemory,
  JOB_MODE_ID_CARD_FRONT_BACK,
  parseSubmitJobMode,
  validateIdCardFormFiles,
} from "@/lib/id-card-upload";
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
import {
  saveUploadFiles,
  type SavedUploadFile,
  validateUploadFiles,
} from "@/lib/upload-service";
import { maxUploadSizeErrorMessage } from "@/lib/upload-limits";
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

  if (
    lower.includes("front of the id") ||
    lower.includes("back of the id") ||
    lower.includes("only front and back") ||
    lower.includes("one front and one back") ||
    lower.includes("id card uploads must be") ||
    (lower.includes("id card") && lower.includes("jpeg or png")) ||
    (lower.includes("id card") && lower.includes("could not be read"))
  ) {
    return message;
  }
  if (lower.includes("not allowed") || lower.includes("file type")) {
    return "This file type is not supported.";
  }
  if (
    lower.includes("too large") ||
    lower.includes("file size") ||
    (lower.includes("size") && lower.includes("mb"))
  ) {
    return maxUploadSizeErrorMessage();
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
  let idCardArtifact: SavedUploadFile | null = null;

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

    const jobMode = parseSubmitJobMode(formData.get("jobMode"));

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

    const rates = toPricingRates(shop.printPrice);
    const forcedPrintType = PrintType.SINGLE;

    // --- Isolated ID Card Front + Back path (Phase B) ---
    if (jobMode === JOB_MODE_ID_CARD_FRONT_BACK) {
      const sides = validateIdCardFormFiles(formData);
      if (!sides.ok) {
        return { success: false, error: sides.error };
      }

      try {
        idCardArtifact = await composeAndSaveIdCardPdf(sides.front, sides.back);
      } catch (composeError) {
        logError("id_card_compose_failed", composeError);
        return {
          success: false,
          error: toFriendlyError(
            composeError instanceof Error
              ? composeError.message
              : "Unable to create ID card print file.",
          ),
        };
      }

      // Authoritative: composed artifact is exactly one A4 page.
      const totalPages = 1;
      const totalPrice = calculatePrintCost(
        rates,
        totalPages,
        parsed.data.copies,
        printMode,
        forcedPrintType,
      );

      // Portrait PDF — force print-safe settings; Agent prints a normal PDF.
      const printSettings = buildPrintSettingsV1({
        copies: parsed.data.copies,
        orientation: "portrait",
        scale: "fit",
        margins: "normal",
        pageRange: "all",
        paperSize: "A4",
      });

      try {
        const job = await createPrintJob({
          shopId: shop.id,
          copies: parsed.data.copies,
          totalPages,
          printMode,
          printType: forcedPrintType,
          totalPrice,
          printSettings,
          files: [idCardArtifact],
        });

        idCardArtifact = null; // ownership transferred to job / retention

        logInfo("job_created", `${job.jobNumber} shop=${shop.shopCode} id_card`);
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
      } catch (jobError) {
        await cleanupIdCardArtifact(idCardArtifact);
        idCardArtifact = null;
        throw jobError;
      }
    }

    // --- Existing normal upload path (unchanged behavior) ---
    const files = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    const fileError = validateUploadFiles(files);
    if (fileError) {
      return { success: false, error: toFriendlyError(fileError) };
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

    // Pricing: full document pages × copies × SINGLE rates. Page range does not change price.
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
    await cleanupIdCardArtifact(idCardArtifact);
    logError("job_create_failed", error);
    return {
      success: false,
      error: "Something went wrong while uploading. Please try again.",
    };
  }
}

export type IdCardPreviewData = {
  /** Base64-encoded PDF bytes (in-memory only; never persisted). */
  pdfBase64: string;
  pageCount: 1;
  widthPt: number;
  heightPt: number;
};

/**
 * Optional ID-card print preview (Phase E1).
 * Same normalize + generateIdCardA4Pdf path as submit — no PrintJob, storage, or billing.
 */
export async function previewIdCardPdfAction(
  formData: FormData,
): Promise<ApiResponse<IdCardPreviewData>> {
  try {
    const shopCodeRaw = formData.get("shopCode");
    const shopCode =
      typeof shopCodeRaw === "string" ? shopCodeRaw.trim() : "";
    if (!shopCode || shopCode.length > 64 || !/^[A-Za-z0-9_-]+$/.test(shopCode)) {
      return { success: false, error: "Invalid shop code." };
    }

    const shop = await getShopWithPricing(shopCode);
    if (!shop) {
      return {
        success: false,
        error: "Sorry, this print shop link is no longer available.",
      };
    }

    const shopHasAccess = await hasSubscriptionAccess(shop.id);
    if (!shopHasAccess) {
      return {
        success: false,
        error:
          "This print shop is temporarily unavailable. Please try again later.",
      };
    }

    const sides = validateIdCardFormFiles(formData);
    if (!sides.ok) {
      return { success: false, error: sides.error };
    }

    const composed = await composeIdCardPdfInMemory(sides.front, sides.back);

    return {
      success: true,
      data: {
        pdfBase64: Buffer.from(composed.pdfBytes).toString("base64"),
        pageCount: 1,
        widthPt: composed.widthPt,
        heightPt: composed.heightPt,
      },
    };
  } catch (error) {
    logError("id_card_preview_failed", error);
    return {
      success: false,
      error:
        "Preview couldn't be generated. You can still submit the print job.",
    };
  }
}

