import { NextRequest } from "next/server";
import { PrintStatus } from "@prisma/client";
import { z } from "zod";

import { authenticateAgent, MAX_PRINT_ATTEMPTS } from "@/lib/print-agent-auth";
import {
  claimJob,
  markFilePrinted,
  markJobReady,
  releaseJobToPending,
} from "@/lib/print-agent-service";
import { logError, logInfo } from "@/lib/log";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

const statusSchema = z.object({
  status: z.enum(["PRINTING", "READY_FOR_PICKUP", "PENDING", "FILE_PRINTED"]),
  error: z.string().trim().max(500).optional(),
  fileId: z.string().trim().min(1).optional(),
});

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const shop = await authenticateAgent(request);
    if (!shop) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { jobId } = await context.params;
    const body = await request.json();
    const parsed = statusSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json({ error: "Invalid status payload." }, { status: 400 });
    }

    const job = await prisma.printJob.findFirst({
      where: { id: jobId, shopId: shop.id },
      select: {
        id: true,
        status: true,
        printAttempts: true,
        jobNumber: true,
      },
    });

    if (!job) {
      return Response.json({ error: "Job not found." }, { status: 404 });
    }

    if (parsed.data.status === "PRINTING") {
      const claimed = await claimJob(shop.id, jobId);
      if (!claimed) {
        return Response.json(
          { error: "Job could not be claimed. It may already be printing." },
          { status: 409 },
        );
      }

      logInfo("job_claimed", `${claimed.jobNumber} shop=${shop.shopCode}`);

      return Response.json({
        ok: true,
        job: {
          id: claimed.id,
          jobNumber: claimed.jobNumber,
          status: claimed.status,
          copies: claimed.copies,
          printMode: claimed.printMode,
          printType: claimed.printType,
          // Optional; null/omitted on legacy jobs. Agent must tolerate missing.
          printSettings: claimed.printSettings ?? null,
          files: claimed.files.map((file) => ({
            id: file.id,
            originalFileName: file.originalFileName,
            fileExtension: file.fileExtension,
            fileSize: file.fileSize,
            printedAt: file.printedAt?.toISOString() ?? null,
          })),
        },
      });
    }

    if (parsed.data.status === "FILE_PRINTED") {
      if (job.status !== PrintStatus.PRINTING) {
        return Response.json(
          { error: "Only PRINTING jobs can mark files as printed." },
          { status: 409 },
        );
      }

      if (!parsed.data.fileId) {
        return Response.json({ error: "fileId is required." }, { status: 400 });
      }

      const file = await markFilePrinted(shop.id, jobId, parsed.data.fileId);
      if (!file) {
        return Response.json(
          { error: "File not found for this job." },
          { status: 404 },
        );
      }

      return Response.json({
        ok: true,
        file: {
          id: file.id,
          printedAt: file.printedAt?.toISOString() ?? null,
        },
      });
    }

    if (parsed.data.status === "READY_FOR_PICKUP") {
      if (job.status !== PrintStatus.PRINTING) {
        return Response.json(
          { error: "Only PRINTING jobs can be marked ready." },
          { status: 409 },
        );
      }

      const updated = await markJobReady(shop.id, jobId);
      if (!updated) {
        return Response.json({ error: "Unable to complete job." }, { status: 409 });
      }

      logInfo("job_ready", `${job.jobNumber} shop=${shop.shopCode}`);

      return Response.json({
        ok: true,
        job: {
          id: jobId,
          status: PrintStatus.READY_FOR_PICKUP,
        },
      });
    }

    // PENDING = release after failure / retry
    if (job.status !== PrintStatus.PRINTING) {
      return Response.json(
        { error: "Only PRINTING jobs can be released back to PENDING." },
        { status: 409 },
      );
    }

    const released = await releaseJobToPending(
      shop.id,
      jobId,
      parsed.data.error || "Print failed.",
    );

    if (!released) {
      return Response.json({ error: "Unable to release job." }, { status: 409 });
    }

    return Response.json({
      ok: true,
      job: {
        id: released.id,
        status: released.status,
        printAttempts: released.printAttempts,
        lastError: released.lastError,
        maxAttempts: MAX_PRINT_ATTEMPTS,
        retriesExhausted: released.printAttempts >= MAX_PRINT_ATTEMPTS,
      },
    });
  } catch (error) {
    logError("agent_job_status_failed", error);
    return Response.json(
      { error: "Unable to update job status." },
      { status: 500 },
    );
  }
}
