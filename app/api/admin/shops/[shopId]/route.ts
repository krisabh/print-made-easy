import { getAdminShopDetail, setAdminShopActive } from "@/lib/admin-shops";
import { requireAdminApi } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ shopId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    const { shopId } = await context.params;
    if (!shopId?.trim()) {
      return Response.json({ error: "Shop id is required." }, { status: 400 });
    }

    const shop = await getAdminShopDetail(shopId.trim());
    if (!shop) {
      return Response.json({ error: "Shop not found." }, { status: 404 });
    }

    return Response.json({
      success: true,
      shop,
    });
  } catch (error) {
    console.error("GET /api/admin/shops/[shopId] failed");
    return Response.json(
      { error: "Unable to load shop details." },
      { status: 500 },
    );
  }
}

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
      return Response.json({ error: "Invalid shop update." }, { status: 400 });
    }

    const result = await setAdminShopActive({
      adminUserId: session.user.id,
      shopId,
      body,
    });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({
      success: true,
      shop: result.shop,
    });
  } catch (error) {
    console.error("PATCH /api/admin/shops/[shopId] failed");
    return Response.json(
      { error: "Unable to update shop." },
      { status: 500 },
    );
  }
}
