import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Frozen run artifacts live in ./data and are read at request time, so they
  // must be traced into the serverless bundle.
  outputFileTracingIncludes: {
    "/api/**": ["./data/**"],
  },
};

export default nextConfig;
