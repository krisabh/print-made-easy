/**
 * Public Windows Agent installer (static file, not stored in the database).
 * Served from /public/downloads — not imported into the Next.js JS bundle.
 */
export const WINDOWS_AGENT_DOWNLOAD = {
  productName: "PrintMadeEasy Agent",
  platform: "Windows",
  version: "1.0.0",
  fileName: "PrintMadeEasy-Agent-Setup-1.0.0.exe",
  href: "/downloads/PrintMadeEasy-Agent-Setup-1.0.0.exe",
} as const;
