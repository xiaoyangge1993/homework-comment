import type { NextConfig } from "next";

// Set before any route loads `ws`. A missing `bufferutil` addon must not replace the JS mask.
process.env.WS_NO_BUFFER_UTIL ??= "1";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "ws"],
  // schema.sql is read with fs at runtime. The path is not static, so the tracer would drop it.
  outputFileTracingIncludes: {
    "**": ["./lib/schema.sql"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
    },
    middlewareClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
