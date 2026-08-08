import { createReadStream } from "fs";
import { access } from "fs/promises";
import { Readable } from "stream";

import { NextRequest } from "next/server";
import { PrintStatus } from "@prisma/client";

import { authenticateAgent } from "@/lib/print-agent-auth";
import { prisma } from "@/lib/prisma";
import { getContentType, getStoredFilePath } from "@/lib/storage";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const shop = await authenticateAgent(request);
    if (!shop) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { jobId } = await context.params;
    const fileId = request.nextUrl.searchParams.get("fileId");

    const job = await prisma.printJob.findFirst({
      where: {
        id: jobId,
        shopId: shop.id,
        status: PrintStatus.PRINTING,
      },
      include: {
        files: {
          where: {
            fileDeletedAt: null,
            ...(fileId ? { id: fileId } : {}),
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!job) {
      return Response.json({ error: "Job not found or not printable." }, { status: 404 });
    }

    const file = job.files[0];
    if (!file) {
      return Response.json({ error: "Document not found." }, { status: 404 });
    }

    const filePath = getStoredFilePath(file.storedFileName);

    try {
      await access(filePath);
    } catch {
      return Response.json(
        { error: "Document file is no longer available." },
        { status: 404 },
      );
    }

    const stream = createReadStream(filePath);
    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": getContentType(file.fileExtension),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.originalFileName)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-File-Id": file.id,
        "X-File-Extension": file.fileExtension,
      },
    });
  } catch (error) {
    console.error("Agent file download failed:", error);
    return Response.json(
      { error: "Unable to download document." },
      { status: 500 },
    );
  }
}
