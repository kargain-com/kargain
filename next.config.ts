import type { NextConfig } from "next";

import {
  CONTENT_IMAGE_MINIMUM_CACHE_TTL_SECONDS,
  contentImageRemotePatterns,
} from "./lib/storage/next-image-config";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Enables the React "use cache" directive & Partial Prerendering-related caching (Next.js 16+).
  cacheComponents: true,
  images: {
    remotePatterns: contentImageRemotePatterns(),
    minimumCacheTTL: CONTENT_IMAGE_MINIMUM_CACHE_TTL_SECONDS,
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
