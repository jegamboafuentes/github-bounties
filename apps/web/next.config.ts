import type { NextConfig } from "next";
import path from "node:path";

/**
 * App root (`apps/web`). A parent `package-lock.json` makes Next infer the
 * repo as the trace root and nest `server.js` under `standalone/apps/web/`.
 * The Cloud Run image copies `public/` to the image root, so that nest 404s
 * `/og.png`. Keep the trace root here (same value as `turbopack.root`).
 */
const appDir = path.resolve(".");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: appDir,
  // Keep the CDP SDK out of the webpack/turbopack graph. File tracing still
  // copies it (and its deps) into `.next/standalone` for Cloud Run.
  serverExternalPackages: [
    "@coinbase/cdp-sdk",
    "@x402/core",
    "@x402/evm",
    "@x402/extensions",
    "@x402/svm",
    "@modelcontextprotocol/sdk",
    "swagger-ui-dist",
  ],
  outputFileTracingIncludes: {
    "/api/docs": ["./node_modules/swagger-ui-dist/**/*"],
    "/api/docs/assets/[file]": ["./node_modules/swagger-ui-dist/**/*"],
  },
  turbopack: {
    root: appDir,
  },
  async headers() {
    return [
      {
        source: "/settings",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
