import { NextResponse } from "next/server";

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
