import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Browser calls Render directly via NEXT_PUBLIC_BACKEND_URL; no /api proxy.
  // No rewrites: the route forwards method, headers, and body so multipart/form-data (lease upload) works.
};

export default nextConfig;
