import { extendAdminShopTrial, getAdminShopDetail } from "@/lib/admin-shops";
import { requireAdminApi } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ shopId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    const { shopId } = await context.params;
    if (!shopId?.trim()) {
      return Response.json({ error: "Shop id is required." }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid trial extension." }, { status: 400 });
    }

    const result = await extendAdminShopTrial({
      adminUserId: session.user.id,
      shopId,
      body,
    });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    const shop = await getAdminShopDetail(shopId.trim());
    return Response.json({
      success: true,
      days: result.days,
      shop,
    });
  } catch (error) {
    console.error("PATCH /api/admin/shops/[shopId]/trial failed");
    return Response.json(
      { error: "Unable to extend this trial." },
      { status: 500 },
    );
  }
}
