import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sql.js ships a .wasm sibling; mark as external so serverless bundling
  // does not try to inline it and so the wasm file is traced correctly.
  serverExternalPackages: ["sql.js"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/sql.js/dist/sql-wasm.wasm"],
  },
  // Hide the "N" dev tools indicator in the bottom-left during local dev.
  // (It's auto-hidden in prod; this just keeps the demo screenshots clean.)
  devIndicators: false,
};

export default nextConfig;
