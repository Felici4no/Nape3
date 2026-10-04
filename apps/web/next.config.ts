import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources.
  transpilePackages: [
    "@nape3/domain",
    "@nape3/market",
    "@nape3/agent",
    "@nape3/fixtures",
    "@nape3/payments",
    "@nape3/pay",
    "@nape3/chain"
  ]
};

export default config;
