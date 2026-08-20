import { NextRequest } from "next/server";

import {
  getAdminAnalytics,
  normalizeAdminAnalyticsRange,
} from "@/lib/admin-analytics";
import { requireAdminApi } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    const range = normalizeAdminAnalyticsRange(
      request.nextUrl.searchParams.get("range"),
    );
    const analytics = await getAdminAnalytics({ range });

    return Response.json({ success: true, analytics });
  } catch (error) {
    console.error("GET /api/admin/analytics failed");
    return Response.json(
      { error: "Unable to load admin analytics." },
      { status: 500 },
    );
  }
}
