import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Browser calls Render directly via NEXT_PUBLIC_BACKEND_URL; no /api proxy.
  // No rewrites: the route forwards method, headers, and body so multipart/form-data (lease upload) works.
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || "",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV || "",
  },
};

export default nextConfig;
