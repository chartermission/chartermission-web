import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (see apps/admin/Dockerfile).
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@chartermission/ui", "@chartermission/contracts"],
  // Same-origin API: the browser calls /api/v1/* and Next proxies to the API.
  rewrites() {
    const api = process.env.API_INTERNAL_URL || "http://localhost:4000/api/v1";
    return [{ source: "/api/v1/:path*", destination: `${api}/:path*` }];
  },
  // The console opens on the moderation queue.
  redirects() {
    return [{ source: "/", destination: "/moderation", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
