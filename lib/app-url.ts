import { headers } from "next/headers";

/**
 * Hostnames that are valid for binding a server but invalid in browser URLs.
 * (e.g. `next dev --hostname 0.0.0.0`)
 */
export function isNonBrowserBindHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h === "0.0.0.0" || h === "::" || h === "[::]";
}

export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]"
  );
}

function parseRequestHost(hostHeader: string): string {
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return hostHeader.split(":")[0] || hostHeader;
  }
}

/**
 * Rewrite bind-only hosts (0.0.0.0) to localhost for browser-facing links.
 * Leaves production hosts (e.g. clauras.com) unchanged.
 */
export function toBrowserFacingBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  if (!trimmed) return "http://localhost:3000";
  try {
    const url = new URL(trimmed);
    if (isNonBrowserBindHostname(url.hostname)) {
      url.hostname = "localhost";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed.includes("0.0.0.0")
      ? trimmed.replace(/0\.0\.0\.0/g, "localhost")
      : trimmed;
  }
}

/**
 * Public base URL for QR codes and absolute links.
 * Prefer request host (LAN IP when opened from phone/Wi‑Fi),
 * then NEXT_PUBLIC_APP_URL, then localhost.
 * Never emit 0.0.0.0 in browser-facing URLs.
 */
export async function getAppBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

  try {
    const headerStore = await headers();
    const host =
      headerStore.get("x-forwarded-host") ?? headerStore.get("host");
    const proto = headerStore.get("x-forwarded-proto") ?? "http";

    if (host) {
      const hostname = parseRequestHost(host);
      // Skip loopback and bind-any hosts; fall through to configured / localhost.
      if (
        !isLoopbackHostname(hostname) &&
        !isNonBrowserBindHostname(hostname)
      ) {
        return toBrowserFacingBaseUrl(`${proto}://${host}`);
      }
    }
  } catch {
    // headers() unavailable outside a request context
  }

  if (configured) {
    return toBrowserFacingBaseUrl(configured);
  }

  return "http://localhost:3000";
}

/**
 * Prefer configured public site URL for payment return / webhook-facing links.
 * Avoids LAN IPs and bind hosts (0.0.0.0) that browsers/PGs cannot use after
 * hosted checkout. Production: NEXT_PUBLIC_APP_URL=https://clauras.com.
 * Local: NEXT_PUBLIC_APP_URL=http://localhost:3000.
 */
export async function getPublicAppBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "").trim();
  if (configured) {
    // Always prefer the configured public URL (prod domain or local localhost).
    // Do not substitute the request Host when it is 0.0.0.0 / loopback.
    return toBrowserFacingBaseUrl(configured);
  }
  return toBrowserFacingBaseUrl(await getAppBaseUrl());
}
