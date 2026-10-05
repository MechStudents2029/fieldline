import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = 3921;
const databaseFile = path.join(process.cwd(), "e2e", ".data", "fieldline-e2e.db");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${port} -H 127.0.0.1`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      FIELDLINE_E2E: "1",
      FIELDLINE_DB: databaseFile,
      DATABASE_URL: "",
      STRIPE_SECRET_KEY: "",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      AI_GATEWAY_API_KEY: "",
      RESEND_API_KEY: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      SESSION_SECRET: "e2e-only-session-secret",
      APP_URL: `http://127.0.0.1:${port}`,
    },
  },
});
