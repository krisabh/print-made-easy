import { requireShopApi } from "@/lib/auth";
import { cancelShopSubscription } from "@/lib/subscription";

/**
 * POST /api/subscription/cancel
 * Cancels the authenticated shop's Cashfree subscription at period end.
 * Shop is derived from session only — never from client body.
 */
export async function POST() {
  try {
    const session = await requireShopApi();
    if (session instanceof Response) return session;

    const result = await cancelShopSubscription({
      shopId: session.shop.id,
    });

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 409 });
    }

    return Response.json({
      success: true,
      message:
        result.view?.detail ||
        "Subscription cancelled. Access continues until the end of the billing period.",
      subscription: result.view,
    });
  } catch (error) {
    console.error("POST /api/subscription/cancel failed");
    return Response.json(
      { error: "Unable to cancel subscription." },
      { status: 500 },
    );
  }
}
