import type { NextConfig } from "next";

// Set before any route loads `ws`. A missing `bufferutil` addon must not replace the JS mask.
process.env.WS_NO_BUFFER_UTIL ??= "1";

const ffmpegPackage = "./node_modules/ffmpeg-static/**";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "ws", "ffmpeg-static"],
  // schema.sql and the intonation script are read or spawned by path, so the tracer would drop them.
  // The ffmpeg binary is not a JS import, so the tracer drops it. Add it on the routes that spawn it.
  // Do not exclude it with a broad glob: excludes run after includes and `contains` matching would strip it.
  outputFileTracingIncludes: {
    "**": ["./lib/schema.sql", "./scripts/intonation.py"],
    "/api/assignments/[id]/demo": [ffmpegPackage],
    "/api/attempts": [ffmpegPackage],
    "/api/attempts/[id]/retry": [ffmpegPackage],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
    },
    middlewareClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
