import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // The office is opened at 127.0.0.1. Without this, Next blocks dev JS and client
  // components (signature pad, copilot) never hydrate.
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.trycloudflare.com"],
  // Serverless functions do not include these files unless they are traced.
  // The migration SQL is read at cold start. Sample receipts are read from public/.
  outputFileTracingIncludes: {
    "/**/*": ["./drizzle/0000_init.sql", "./public/demo/receipts/**/*"],
  },
};

export default nextConfig;
