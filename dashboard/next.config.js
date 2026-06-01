/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_ORCHESTRATOR_URL: process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "",
    NEXT_PUBLIC_ORCHESTRATOR_SECRET: process.env.NEXT_PUBLIC_ORCHESTRATOR_SECRET || "",
  },
};

module.exports = nextConfig;
