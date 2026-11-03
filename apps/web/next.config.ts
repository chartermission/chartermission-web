import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@chartermission/ui", "@chartermission/contracts"],
  // Same-origin API: the browser calls /api/v1/* and Next proxies to the API, so the session
  // cookie is first-party. API_INTERNAL_URL is the API's address from the Next server.
  rewrites() {
    const api = process.env.API_INTERNAL_URL ?? "http://localhost:4000/api/v1";
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
