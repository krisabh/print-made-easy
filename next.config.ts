import type { NextConfig } from "next";

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
};

export default nextConfig;
