import { NextResponse } from "next/server";

import { cancelCustomerOwnedJob } from "@/lib/dashboard-service";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

/**
 * Customer-facing job status for the upload success screen.
 * Returns status only — no file paths or shop secrets.
 */
export async function GET(request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const shopCode = new URL(request.url).searchParams.get("shopCode")?.trim();

  if (!jobId || !shopCode) {
    return NextResponse.json(
      { success: false, error: "Missing job or shop." },
      { status: 400 },
    );
  }

  const job = await prisma.printJob.findFirst({
    where: {
      id: jobId,
      shop: { shopCode, isActive: true },
    },
    select: {
      id: true,
      jobNumber: true,
      status: true,
      updatedAt: true,
    },
  });

  if (!job) {
    return NextResponse.json(
      { success: false, error: "Job not found." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        jobId: job.id,
        jobNumber: job.jobNumber,
        status: job.status,
        updatedAt: job.updatedAt.toISOString(),
      },
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}

/**
 * Customer stop for the job on this upload screen.
 * Same ownership check as GET: job id + shop code. shopId from the client is ignored.
 */
export async function POST(request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const shopCode = new URL(request.url).searchParams.get("shopCode")?.trim();

  if (!jobId || !shopCode) {
    return NextResponse.json(
      { success: false, error: "Missing job or shop." },
      { status: 400 },
    );
  }

  const result = await cancelCustomerOwnedJob(shopCode, jobId);
  if (result.outcome === "not_found") {
    return NextResponse.json(
      { success: false, error: "Job not found." },
      { status: 404 },
    );
  }

  const cancelled =
    result.outcome === "cancelled" || result.outcome === "already_cancelled";

  return NextResponse.json(
    {
      success: true,
      data: {
        jobId: result.job.id,
        jobNumber: result.job.jobNumber,
        status: result.job.status,
        updatedAt: result.job.updatedAt.toISOString(),
        cancelled,
        outcome: result.outcome,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
