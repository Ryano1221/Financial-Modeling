import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Production: BACKEND_URL must be set (verify-prod-env.js runs before build).
    // Development: fallback to local backend for convenience.
    const backend =
      process.env.NODE_ENV === "production"
        ? process.env.BACKEND_URL
        : process.env.BACKEND_URL || "http://127.0.0.1:8010";
    if (!backend) return [];
    return [{ source: "/api/:path*", destination: `${backend}/:path*` }];
  },
};

export default nextConfig;
