import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /api/* is handled by app/api/[...path]/route.ts (proxy to BACKEND_URL at request time).
  // No rewrites: the route forwards method, headers, and body so multipart/form-data (lease upload) works.
};

export default nextConfig;
