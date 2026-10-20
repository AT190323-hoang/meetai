import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundling `ws` replaces its optional native `bufferutil` with a stub, which breaks
  // sending frames ("bufferUtil.mask is not a function") in connectOpenAi
  serverExternalPackages: ["ws", "@stream-io/openai-realtime-api", "@openai/realtime-api-beta"],
  async redirects() {
    return [
      {
        source: "/",
        destination: "/meetings",
        permanent: false,
      }
    ];
  },
};

export default nextConfig;
