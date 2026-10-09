import type { NextConfig } from "next";

// Set before any route loads `ws`. A missing `bufferutil` addon must not replace the JS mask.
process.env.WS_NO_BUFFER_UTIL ??= "1";

const ffmpegPackage = "./node_modules/ffmpeg-static/**";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "ws", "ffmpeg-static"],
  // schema.sql is read with fs at runtime. The path is not static, so the tracer would drop it.
  // The ffmpeg binary is not a JS import, so the tracer drops it. Add it on the routes that spawn it.
  // Do not exclude it with a broad glob: excludes run after includes and `contains` matching would strip it.
  outputFileTracingIncludes: {
    "**": ["./lib/schema.sql"],
    "/api/assignments/[id]/demo": [ffmpegPackage],
    "/api/attempts": [ffmpegPackage],
    "/api/attempts/[id]/retry": [ffmpegPackage],
  },
  experimental: {
    // These raise Next's own parser limits for a long-running server.
    // Vercel still rejects a function body over 4.5MB before this code runs.
    serverActions: {
      bodySizeLimit: "200mb",
    },
    middlewareClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
