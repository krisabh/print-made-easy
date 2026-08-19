import { getAdminSubscriptionDetail } from "@/lib/admin-subscriptions";
import { requireAdminApi } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ subscriptionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    const { subscriptionId } = await context.params;
    if (!subscriptionId?.trim()) {
      return Response.json(
        { error: "Subscription id is required." },
        { status: 400 },
      );
    }

    const subscription = await getAdminSubscriptionDetail(subscriptionId.trim());
    if (!subscription) {
      return Response.json({ error: "Subscription not found." }, { status: 404 });
    }

    return Response.json({
      success: true,
      subscription,
    });
  } catch (error) {
    console.error("GET /api/admin/subscriptions/[subscriptionId] failed");
    return Response.json(
      { error: "Unable to load subscription details." },
      { status: 500 },
    );
  }
}
