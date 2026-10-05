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

export type DatabaseTarget =
  | { kind: "sqlite"; file: string }
  | { kind: "postgres"; url: string };

export function databaseTarget(env: Env = process.env): DatabaseTarget {
  const url = env.DATABASE_URL?.trim();
  if (url && (POSTGRES_URL.test(url) || /^pglite:/i.test(url))) return { kind: "postgres", url };
  if (env.FIELDLINE_DB) return { kind: "sqlite", file: env.FIELDLINE_DB };
  return { kind: "sqlite", file: path.join(resolveDataDir(env), "fieldline.db") };
}

export function resolveDatabasePath(env: Env = process.env): string {
  const target = databaseTarget(env);
  if (target.kind === "postgres") {
    throw new Error("DATABASE_URL is a Postgres connection string, so there is no SQLite file.");
  }
  return target.file;
}

export function databaseKind(env: Env = process.env): "sqlite-tmp" | "sqlite-file" | "postgres" {
  const target = databaseTarget(env);
  if (target.kind === "postgres") return "postgres";
  return target.file === ":memory:" || target.file.startsWith("/tmp/") ? "sqlite-tmp" : "sqlite-file";
}
