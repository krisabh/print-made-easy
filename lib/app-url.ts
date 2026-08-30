import { headers } from "next/headers";

/**
 * Public base URL for QR codes and absolute links.
 * Prefer request host (LAN IP when opened from phone/Wi‑Fi),
 * then NEXT_PUBLIC_APP_URL, then localhost.
 */
export async function getAppBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

  try {
    const headerStore = await headers();
    const host =
      headerStore.get("x-forwarded-host") ?? headerStore.get("host");
    const proto = headerStore.get("x-forwarded-proto") ?? "http";

    if (host && !host.includes("localhost") && !host.startsWith("127.")) {
      return `${proto}://${host}`;
    }
  } catch {
    // headers() unavailable outside a request context
  }

  if (configured) {
    return configured;
  }

  return "http://localhost:3000";
}

/**
 * Prefer configured public site URL for Cashfree return/webhook-facing links.
 * Avoids LAN IPs that Cashfree and browsers cannot use after hosted checkout.
 */
export async function getPublicAppBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "").trim();
  if (
    configured &&
    !configured.includes("localhost") &&
    !configured.includes("127.0.0.1")
  ) {
    return configured;
  }
  return getAppBaseUrl();
}
