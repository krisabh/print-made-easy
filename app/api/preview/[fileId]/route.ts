import { createReadStream } from "fs";
import { access } from "fs/promises";
import { Readable } from "stream";

import { getFileForShopPreview } from "@/lib/dashboard-service";
import { requireProductAccessApi } from "@/lib/require-product-access";
import {
  canPreviewInBrowser,
  getContentType,
  getStoredFilePath,
} from "@/lib/storage";

type RouteContext = {
  params: Promise<{ fileId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const gated = await requireProductAccessApi();
    if (gated instanceof Response) return gated;
    const { shop } = gated.session;

    const { fileId } = await context.params;
    const file = await getFileForShopPreview(fileId, shop.id);

    if (!file) {
      return Response.json({ error: "Document not found." }, { status: 404 });
    }

    if (!canPreviewInBrowser(file.fileExtension)) {
      return Response.json(
        { error: "Preview not available for this file type." },
        { status: 415 },
      );
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
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.originalFileName)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Preview failed");
    return Response.json(
      { error: "Unable to preview this document." },
      { status: 500 },
    );
  }
}
