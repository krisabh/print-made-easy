import type { NextConfig } from "next";

/** Prevent Hostinger/CDN from keeping year-long prerender HTML for public pages. */
const MARKETING_NO_STORE = [
  {
    key: "Cache-Control",
    value: "private, no-cache, no-store, max-age=0, must-revalidate",
  },
] as const;

const MARKETING_PATHS = [
  "/",
  "/features",
  "/how-it-works",
  "/products",
  "/pricing",
  "/about",
  "/support",
  "/contact",
  "/privacy",
  "/terms",
  "/refunds",
] as const;

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  // Hostinger production installs often omit devDependencies.
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return MARKETING_PATHS.map((source) => ({
      source,
      headers: [...MARKETING_NO_STORE],
    }));
  },
};

export default nextConfig;
