import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (see apps/web/Dockerfile).
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@chartermission/ui", "@chartermission/contracts"],
  // The service worker must never be served from a cache, or members would keep an old one.
  headers() {
    // Claude's consent screen must never be framed, or another site could trick a click on Allow.
    const noFraming = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    return Promise.resolve([
      { source: "/connect", headers: noFraming },
      { source: "/:locale(en|fr|ar)/connect", headers: noFraming },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ]);
  },
  // Same-origin API: the browser calls /api/v1/* and Next proxies to the API, so the session
  // cookie is first-party. API_INTERNAL_URL is the API's address from the Next server.
  rewrites() {
    const api = process.env.API_INTERNAL_URL || "http://localhost:4000/api/v1";
    return [{ source: "/api/v1/:path*", destination: `${api}/:path*` }];
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
