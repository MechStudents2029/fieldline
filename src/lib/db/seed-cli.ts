import { resetDatabase } from "@/lib/db/client";

const reset = process.argv.includes("--reset") || process.argv.includes("--force");
if (reset) {
  resetDatabase();
  console.log("Reseeded Fieldline demo data.");
} else {
  const { getDb } = await import("@/lib/db/client");
  getDb();
  console.log("Database ready. Pass --reset to wipe and reseed.");
}
