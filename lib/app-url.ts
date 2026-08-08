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
