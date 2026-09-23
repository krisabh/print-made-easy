import { NextRequest } from "next/server";

import { createAdminCoupon, listAdminCoupons } from "@/lib/admin-coupons";
import { requireAdminApi } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    const page = Number(request.nextUrl.searchParams.get("page") || "1");
    const result = await listAdminCoupons({ page });
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("GET /api/admin/coupons failed");
    return Response.json({ error: "Unable to load coupons." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid coupon." }, { status: 400 });
    }

    const result = await createAdminCoupon({
      adminUserId: session.user.id,
      body,
    });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ success: true, coupon: result.coupon }, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/coupons failed");
    return Response.json({ error: "Unable to create coupon." }, { status: 500 });
  }
}
