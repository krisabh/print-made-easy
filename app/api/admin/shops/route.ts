import { NextRequest } from "next/server";

import { listAdminShops } from "@/lib/admin-shops";
import { requireAdminApi } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    const params = request.nextUrl.searchParams;
    const page = Number(params.get("page") || "1");
    const pageSize = Number(params.get("pageSize") || "20");
    const search = params.get("search") || params.get("q") || "";

    const result = await listAdminShops({
      page,
      pageSize,
      search,
    });

    return Response.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("GET /api/admin/shops failed");
    return Response.json(
      { error: "Unable to load shops." },
      { status: 500 },
    );
  }
}
