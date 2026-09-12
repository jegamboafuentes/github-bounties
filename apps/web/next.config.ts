import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep the CDP SDK out of the webpack/turbopack graph. File tracing still
  // copies it (and its deps) into `.next/standalone` for Cloud Run.
  serverExternalPackages: ["@coinbase/cdp-sdk", "@x402/core", "@x402/evm", "@x402/extensions", "@x402/svm"],
  turbopack: {
    root: path.resolve("."),
  },
};

export default nextConfig;
