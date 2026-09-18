import { WINDOWS_AGENT_RELEASE } from "@/lib/agent-release";

/**
 * Dashboard / manual download card metadata.
 * Sourced from WINDOWS_AGENT_RELEASE (single release contract for the web app).
 */
export const WINDOWS_AGENT_DOWNLOAD = {
  productName: WINDOWS_AGENT_RELEASE.productName,
  platform: WINDOWS_AGENT_RELEASE.platform,
  version: WINDOWS_AGENT_RELEASE.version,
  fileName: WINDOWS_AGENT_RELEASE.fileName,
  href: WINDOWS_AGENT_RELEASE.downloadPath,
} as const;
