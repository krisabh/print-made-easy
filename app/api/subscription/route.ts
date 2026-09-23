import { getCurrentPremiumPriceInr } from "@/lib/admin-settings";
import { requireShopApi } from "@/lib/auth";
import {
  getShopSubscription,
  toPublicSubscriptionView,
} from "@/lib/subscription";

export async function GET() {
  try {
    const session = await requireShopApi();
    if (session instanceof Response) return session;

    const [subscription, premiumPriceInr] = await Promise.all([
      getShopSubscription(session.shop.id),
      getCurrentPremiumPriceInr(),
    ]);
    const view = toPublicSubscriptionView(subscription, new Date(), premiumPriceInr);

    if (!view) {
      return Response.json(
        { error: "Subscription not found for this shop." },
        { status: 404 },
      );
    }

    return Response.json(view);
  } catch (error) {
    console.error("GET /api/subscription failed");
    return Response.json(
      { error: "Unable to load subscription." },
      { status: 500 },
    );
  }
}
