import { getAdminCoupon, updateAdminCoupon } from "@/lib/admin-coupons";
import { requireAdminApi } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ couponId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    const { couponId } = await context.params;
    if (!couponId?.trim()) {
      return Response.json({ error: "Coupon id is required." }, { status: 400 });
    }
    const coupon = await getAdminCoupon(couponId);
    if (!coupon) {
      return Response.json({ error: "Coupon not found." }, { status: 404 });
    }
    return Response.json({ success: true, coupon });
  } catch (error) {
    console.error("GET /api/admin/coupons/[couponId] failed");
    return Response.json({ error: "Unable to load coupon." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    const { couponId } = await context.params;
    if (!couponId?.trim()) {
      return Response.json({ error: "Coupon id is required." }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid coupon." }, { status: 400 });
    }

    const result = await updateAdminCoupon({
      adminUserId: session.user.id,
      couponId,
      body,
    });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ success: true, coupon: result.coupon });
  } catch (error) {
    console.error("PATCH /api/admin/coupons/[couponId] failed");
    return Response.json({ error: "Unable to update coupon." }, { status: 500 });
  }
}
