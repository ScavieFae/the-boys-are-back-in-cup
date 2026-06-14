import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Old routes consolidated into /standings and /draft.
  async redirects() {
    return [
      { source: "/head-to-head", destination: "/standings", permanent: false },
      { source: "/stats", destination: "/standings", permanent: false },
      { source: "/teams", destination: "/draft", permanent: false },
      { source: "/managers", destination: "/draft", permanent: false },
    ];
  },
};

export default nextConfig;
