import path from "node:path";

const POSTGRES_URL = /^postgres(ql)?:/i;

/**
 * Where the demo may write. Vercel functions can write only under /tmp, and that
 * directory is wiped when the instance goes cold. Local dev keeps ./data.
 */
type Env = Record<string, string | undefined>;

export function resolveDataDir(env: Env = process.env): string {
  if (env.FIELDLINE_DATA_DIR) return env.FIELDLINE_DATA_DIR;
  if (env.VERCEL) return "/tmp/fieldline";
  return path.join(process.cwd(), "data");
}

export function resolveDatabasePath(env: Env = process.env): string {
  const url = env.DATABASE_URL?.trim();
  if (url && POSTGRES_URL.test(url)) {
    throw new Error(
      "DATABASE_URL is a Postgres connection string. This build still runs the seeded SQLite demo and does not open Postgres. Unset DATABASE_URL to deploy the demo, or follow the README section Durable database before pointing the app at Supabase.",
    );
  }
  if (env.FIELDLINE_DB) return env.FIELDLINE_DB;
  return path.join(resolveDataDir(env), "fieldline.db");
}

export function databaseKind(env: Env = process.env): "sqlite-tmp" | "sqlite-file" {
  const file = resolveDatabasePath(env);
  return file === ":memory:" || file.startsWith("/tmp/") ? "sqlite-tmp" : "sqlite-file";
}
