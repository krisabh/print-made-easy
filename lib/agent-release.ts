import { SITE } from "@/lib/marketing";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

/**
 * Server-owned Windows Agent release contract (manual download + future updater).
 *
 * Intentionally kept in sync with print-agent/package.json version until packaging
 * and the Next.js app share one build-time source. Keep both at the same value
 * on every Agent release.
 *
 * This module must stay free of Node `fs` so dashboard client components can
 * import WINDOWS_AGENT_DOWNLOAD / WINDOWS_AGENT_RELEASE safely.
 */
export const WINDOWS_AGENT_RELEASE = {
  productName: "PrintMadeEasy Agent",
  platform: "Windows",
  version: "1.4.0",
  fileName: "PrintMadeEasy-Agent-Setup-1.4.0.exe",
  /** Relative path served by the existing allowlisted download route. */
  downloadPath: "/api/agent/download",
  notes:
    "Agent 1.4.0: same-account multi-computer login, per-device authentication, device-scoped printers and job ownership, login rate limiting, Windows auto-start (with legacy Run-key migration), and in-app update check with secure download and SHA-256 verification.",
} as const;

/**
 * Public update manifest consumed by future Agent checkers.
 * Optional fields may be added later without breaking this core shape.
 */
export type AgentUpdateManifest = {
  version: string;
  /** Trusted HTTPS URL for the installer (never a filesystem path). */
  url: string;
  /**
   * Lowercase hex SHA-256 of the installer EXE.
   * null when WINDOWS_AGENT_SHA256 is not configured yet (EXE not hashed).
   */
  sha256: string | null;
  notes: string;
  fileName: string;
};

export function isSha256Hex(value: string | null | undefined): value is string {
  return typeof value === "string" && SHA256_HEX_RE.test(value);
}

/**
 * Resolve optional installer SHA-256 from env.
 * Invalid / missing values become null — never invent a fake digest.
 */
export function resolveConfiguredAgentSha256(
  envValue: string | undefined = process.env.WINDOWS_AGENT_SHA256,
): string | null {
  const raw = envValue?.trim().toLowerCase() ?? "";
  if (!raw) return null;
  return isSha256Hex(raw) ? raw : null;
}

/**
 * Absolute public download URL for the current Agent release.
 * Prefers NEXT_PUBLIC_APP_URL when set (local/dev), otherwise SITE.url.
 * Never exposes filesystem paths or Hostinger storage locations.
 */
export function getPublicAgentDownloadUrl(
  siteUrl: string = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    SITE.url,
): string {
  const base = siteUrl.replace(/\/$/, "");
  return `${base}${WINDOWS_AGENT_RELEASE.downloadPath}`;
}

/**
 * Public release metadata for GET /api/agent/update.
 * Does not read or expose WINDOWS_AGENT_FILE_PATH.
 */
export function getPublicAgentUpdateManifest(
  envSha256: string | undefined = process.env.WINDOWS_AGENT_SHA256,
): AgentUpdateManifest {
  return {
    version: WINDOWS_AGENT_RELEASE.version,
    url: getPublicAgentDownloadUrl(),
    sha256: resolveConfiguredAgentSha256(envSha256),
    notes: WINDOWS_AGENT_RELEASE.notes,
    fileName: WINDOWS_AGENT_RELEASE.fileName,
  };
}
