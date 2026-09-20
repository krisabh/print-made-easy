import type { NextConfig } from "next";

import { resolveMaxUploadSizeMb } from "./lib/upload-limits";

/**
 * Server Actions multipart body limit — must be ≥ MAX_UPLOAD_SIZE_MB.
 * Small overhead buffer covers FormData field metadata around the file.
 */
const maxUploadMb = resolveMaxUploadSizeMb();
const serverActionBodySizeLimit = `${maxUploadMb + 20}mb` as `${number}mb`;

/** Prevent Hostinger/CDN from keeping year-long prerender HTML for public pages. */
const MARKETING_NO_STORE = [
  {
    key: "Cache-Control",
    value: "private, no-cache, no-store, max-age=0, must-revalidate",
  },
] as const;

/** Content-hashed build assets — safe to cache forever; must never inherit HTML no-store. */
const NEXT_STATIC_IMMUTABLE = [
  {
    key: "Cache-Control",
    value: "public, max-age=31536000, immutable",
  },
] as const;

/** Exact document paths only — never `/_next/*` or nested static assets. */
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
      bodySizeLimit: serverActionBodySizeLimit,
    },
  },
  // Native / Node-only packages used when baking brightness into PDFs.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  // Hostinger production installs often omit devDependencies.
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [...NEXT_STATIC_IMMUTABLE],
      },
      ...MARKETING_PATHS.map((source) => ({
        source,
        headers: [...MARKETING_NO_STORE],
      })),
    ];
  },
};

export default nextConfig;
