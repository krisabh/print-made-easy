import { prisma } from "@/lib/prisma";
import { runDocumentCleanupIfDue } from "@/lib/cleanup";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    // Opportunistic cleanup (Hostinger-safe: no background daemon)
    void runDocumentCleanupIfDue();

    return Response.json(
      {
        status: "ok",
        time: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json(
      {
        status: "error",
        time: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
