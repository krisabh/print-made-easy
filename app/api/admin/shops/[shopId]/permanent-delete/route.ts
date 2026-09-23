import { permanentlyDeleteAdminShop } from "@/lib/admin-shops";
import { requireAdminApi } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ shopId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
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
      return Response.json({ error: "CONFIRMATION_REQUIRED" }, { status: 409 });
    }

    const result = await permanentlyDeleteAdminShop({
      adminUserId: session.user.id,
      shopId,
      body,
    });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({
      deleted: true,
      shopId: result.shopId,
      shopCode: result.shopCode,
    });
  } catch (error) {
    console.error("POST /api/admin/shops/[shopId]/permanent-delete failed");
    return Response.json(
      { error: "Unable to delete this shop." },
      { status: 500 },
    );
  }
}
