import { NextRequest } from "next/server";

import { listAdminSubscriptions } from "@/lib/admin-subscriptions";
import { requireAdminApi } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    const params = request.nextUrl.searchParams;
    const page = Number(params.get("page") || "1");
    const pageSize = Number(params.get("pageSize") || "20");
    const search = params.get("search") || params.get("q") || "";
    const status = params.get("status") || "";
    const plan = params.get("plan") || "";

    const result = await listAdminSubscriptions({
      page,
      pageSize,
      search,
      status,
      plan,
    });

    return Response.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("GET /api/admin/subscriptions failed");
    return Response.json(
      { error: "Unable to load subscriptions." },
      { status: 500 },
    );
  }
}
