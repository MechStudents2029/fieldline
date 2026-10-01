import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // The office is opened at 127.0.0.1. Without this, Next blocks dev JS and client
  // components (signature pad, copilot) never hydrate.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
