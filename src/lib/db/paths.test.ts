import { describe, expect, it } from "vitest";
import { databaseKind, resolveDatabasePath, resolveDataDir } from "@/lib/db/paths";

describe("demo database paths", () => {
  it("keeps local data on disk", () => {
    expect(resolveDataDir({})).toMatch(/data$/);
    expect(resolveDatabasePath({})).toMatch(/data[/\\]fieldline\.db$/);
    expect(databaseKind({})).toBe("sqlite-file");
  });

  it("uses /tmp on Vercel so the read-only bundle can still seed", () => {
    const env = { VERCEL: "1" };
    expect(resolveDataDir(env)).toBe("/tmp/fieldline");
    expect(resolveDatabasePath(env)).toBe("/tmp/fieldline/fieldline.db");
    expect(databaseKind(env)).toBe("sqlite-tmp");
  });

  it("honors an explicit file and refuses a Postgres URL", () => {
    expect(resolveDatabasePath({ FIELDLINE_DB: ":memory:" })).toBe(":memory:");
    expect(() => resolveDatabasePath({ DATABASE_URL: "postgres://user:pass@host/db" })).toThrow(/Postgres/);
  });
});
