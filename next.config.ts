import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Enables the React "use cache" directive & Partial Prerendering-related caching (Next.js 16+).
  cacheComponents: true,
};

export default nextConfig;
