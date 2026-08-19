import { getAdminOverviewMetrics } from "@/lib/admin-metrics";
import { requireAdminApi } from "@/lib/auth";

export async function GET() {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    const metrics = await getAdminOverviewMetrics();
    return Response.json({
      success: true,
      metrics,
    });
  } catch (error) {
    console.error("GET /api/admin/overview failed");
    return Response.json(
      { error: "Unable to load admin overview." },
      { status: 500 },
    );
  }
}
