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
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "UNKNOWN")
        : "UNKNOWN";

    return Response.json(
      {
        status: "error",
        code,
        // Hint only — never includes password/url
        hint:
          code === "P1000"
            ? "MySQL username/password rejected. Reset DB password in hPanel and update DATABASE_URL."
            : code === "P1001"
              ? "Cannot reach MySQL. Try host 127.0.0.1 in DATABASE_URL."
              : "Database query failed. Check DATABASE_URL on Hostinger.",
        time: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
