import {
  CASHFREE_API_VERSION,
  getCashfreeConfig,
  type CashfreeEnvironment,
} from "@/lib/cashfree";
import { requireAdminApi } from "@/lib/auth";

export const runtime = "nodejs";

function cashfreeBaseUrl(environment: CashfreeEnvironment) {
  return environment === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

/**
 * Temporary diagnostic: verify Cashfree credentials without creating
 * orders/subscriptions. Uses official Fetch Subscription (GET).
 * Docs: GET /pg/subscriptions/{subscription_id}
 *
 * Auth success: Cashfree accepts credentials (response is not 401/403).
 * A 404 for a nonexistent probe id still means authentication worked.
 */
export async function GET() {
  const session = await requireAdminApi();
  if (session instanceof Response) return session;

  let environment: CashfreeEnvironment = "sandbox";

  try {
    const config = getCashfreeConfig();
    environment = config.environment;

    // Nonexistent merchant subscription_id — must not create anything.
    const probeId = "pme-credential-probe-do-not-create";
    const url = `${cashfreeBaseUrl(config.environment)}/subscriptions/${encodeURIComponent(probeId)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-api-version": CASHFREE_API_VERSION,
        "x-client-id": config.clientId,
        "x-client-secret": config.clientSecret,
      },
      cache: "no-store",
    });

    // Consume body so the connection is closed; never return/log it.
    await response.text().catch(() => undefined);

    if (response.status === 401 || response.status === 403) {
      console.info("Cashfree sandbox connectivity test: failed");
      return Response.json({
        ok: false,
        environment,
        error: "Cashfree authentication failed",
      });
    }

    // 404 (not found) or 200 (unexpected but authenticated) → credentials accepted.
    console.info("Cashfree sandbox connectivity test: success");
    return Response.json({
      ok: true,
      environment,
    });
  } catch {
    console.info("Cashfree sandbox connectivity test: failed");
    return Response.json({
      ok: false,
      environment,
      error: "Cashfree authentication failed",
    });
  }
}
