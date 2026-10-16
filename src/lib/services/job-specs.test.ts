import fs from "node:fs";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb, useDatabaseFile } from "@/lib/db/client";
import { budgetLines } from "@/lib/db/schema";
import { mentionUnread } from "@/lib/services/comments";
import {
  addSpecLine,
  attachSpecFile,
  createFromBudget,
  keepSpecLine,
  publicSpec,
  publishSpec,
  refreshSpecLine,
  reviseSpec,
  specAttention,
  specCsv,
  specFileByToken,
  specPack,
  specPacks,
  updateSpec,
} from "@/lib/services/job-specs";
import { authenticate } from "@/lib/services/read";
import { resolveInside } from "@/lib/security";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

describe("job specifications", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("seeds a published shower pack and a budget-changed framing pack", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const riley = actor("riley@rivera.demo");
    const shower = specPack(maya, "spec_ok_shower");
    const framing = specPack(maya, "spec_br_frame");
    expect(shower?.status).toBe("published");
    expect(shower?.lines[0]?.files[0]?.filename).toBe("a101-floor-plan.pdf");
    expect(shower?.lines.some((line) => line.changed)).toBe(false);
    expect(framing?.lines[0]?.changed).toBe(true);
    expect(framing?.lines[0]?.notes).toBe("2x6 exterior.");
    expect(specAttention(maya)).toEqual({ count: 1, href: "/specs?flag=1" });
    expect(specPacks(dana).map((row) => row.id).sort()).toEqual(["spec_br_frame", "spec_ok_shower"]);
    expect(specPacks(dana, { status: "draft" })).toEqual([]);
    expect(specPack(riley, "spec_br_frame")?.canEdit).toBe(false);
    expect(() => createFromBudget(riley, "proj_chen")).toThrow(/cannot edit/);
    expect(() => createFromBudget(dana, "proj_chen")).toThrow(/cannot edit/);
    const file = specFileByToken("demo_spec_ok_a1", "spec_ok_file_a101");
    expect(file?.filename).toBe("a101-floor-plan.pdf");
    expect(file?.bytes.byteLength).toBeGreaterThan(20);
    const original = resolveInside(dataDir(), "uploads/org_rivera/doc_ok_a101_r2.pdf");
    expect(original && fs.readFileSync(original).equals(file!.bytes)).toBe(true);
    expect(specCsv(maya)).toContain("Shower niche, tiled");
    expect(specCsv(maya)).toContain("Framing");
    expect(specCsv(dana)).not.toContain("180000");
    expect(mentionUnread(maya)).toBe(2);
    const sql = readFileSync("supabase/rls.sql", "utf8");
    const member = sql.slice(sql.indexOf("foreach tbl in"), sql.lastIndexOf("foreach tbl in"));
    const money = sql.slice(sql.lastIndexOf("foreach tbl in"));
    for (const table of ["job_specs", "job_spec_lines", "job_spec_files", "job_spec_attempts"]) {
      expect(member).toContain(`'${table}'`);
      expect(money).toContain(`'${table}'`);
    }
    const published = publicSpec("demo_spec_ok_a1", "203.0.113.40");
    expect(published.state).toBe("published");
    if (published.state === "published") {
      expect(JSON.stringify(published)).toContain("Shower niche, tiled");
      expect(JSON.stringify(published)).not.toContain("180000");
      expect(JSON.stringify(published)).not.toContain("Budget changed");
    }
  });

  it("publishes a pack from the budget, hides the draft, and keeps the prior revision", () => {
    const maya = actor("maya@rivera.demo");
    const created = createFromBudget(maya, "proj_chen", "Chen specs");
    expect(publicSpec(created.shareToken, "203.0.113.41").state).toBe("unpublished");
    const draft = specPack(maya, created.id);
    expect(draft?.lines.some((line) => line.description === "Vanity and top")).toBe(true);
    expect(specPack(actor("dana@rivera.demo"), created.id)).toBeNull();
    const line = draft!.lines.find((row) => row.description === "Vanity and top");
    expect(line).toBeTruthy();
    publishSpec(maya, created.id);
    const open = publicSpec(created.shareToken, "203.0.113.42");
    expect(open.state).toBe("published");
    if (open.state === "published") expect(JSON.stringify(open)).toContain("Vanity and top");
    const next = reviseSpec(maya, created.id);
    addSpecLine(maya, next.id, { description: "Draft only canopy" });
    const still = publicSpec(created.shareToken, "203.0.113.43");
    expect(still.state).toBe("published");
    if (still.state === "published") {
      expect(JSON.stringify(still)).toContain("Vanity and top");
      expect(JSON.stringify(still)).not.toContain("Draft only canopy");
      expect(still.version).toBe(1);
    }
    expect(specPack(maya, created.id)?.status).toBe("published");
    expect(specPack(maya, next.id)?.status).toBe("draft");
    expect(specPack(maya, next.id)?.versions.map((row) => row.version).sort()).toEqual([1, 2]);
    const before = resolveInside(dataDir(), "uploads/org_rivera/doc_ok_a101_r2.pdf");
    const bytes = before ? fs.readFileSync(before) : Buffer.alloc(0);
    attachSpecFile(maya, specPack(maya, next.id)!.lines[0]!.id, { filename: "cut-sheet.pdf", bytes: pdf });
    expect(before && fs.readFileSync(before).equals(bytes)).toBe(true);
    expect(specFileByToken("demo_spec_ok_a1", "spec_ok_file_a101")?.filename).toBe("a101-floor-plan.pdf");
  });

  it("flags a budget change and clears it with refresh or keep", () => {
    const maya = actor("maya@rivera.demo");
    const created = createFromBudget(maya, "proj_diaz", "Diaz specs");
    const line = specPack(maya, created.id)!.lines[0]!;
    const db = getDb();
    const before = db.select().from(budgetLines).where(and(eq(budgetLines.id, line.budgetLineId!), eq(budgetLines.orgId, maya.orgId))).get();
    expect(before).toBeTruthy();
    try {
      db.update(budgetLines)
        .set({ budgetPriceCents: before!.budgetPriceCents + 5000, name: `${before!.name} revised` })
        .where(and(eq(budgetLines.id, before!.id), eq(budgetLines.orgId, maya.orgId)))
        .run();
      const flagged = specPack(maya, created.id)!.lines.find((row) => row.id === line.id);
      expect(flagged?.changed).toBe(true);
      expect(specAttention(maya).count).toBeGreaterThan(1);
      refreshSpecLine(maya, line.id);
      const refreshed = specPack(maya, created.id)!.lines.find((row) => row.id === line.id);
      expect(refreshed?.changed).toBe(false);
      expect(refreshed?.description).toBe(`${before!.name} revised`);
      db.update(budgetLines)
        .set({ budgetPriceCents: before!.budgetPriceCents + 9000 })
        .where(and(eq(budgetLines.id, before!.id), eq(budgetLines.orgId, maya.orgId)))
        .run();
      updateSpec(maya, created.id, { dueOn: "2020-01-01" });
      expect(specPack(maya, created.id)?.overdue).toBe(true);
      keepSpecLine(maya, line.id);
      const kept = specPack(maya, created.id)!.lines.find((row) => row.id === line.id);
      expect(kept?.changed).toBe(false);
      expect(kept?.description).toBe(`${before!.name} revised`);
      expect(kept?.notes).toBe("");
    } finally {
      db.update(budgetLines)
        .set({ budgetPriceCents: before!.budgetPriceCents, name: before!.name })
        .where(and(eq(budgetLines.id, before!.id), eq(budgetLines.orgId, maya.orgId)))
        .run();
    }
  });

  it("rate-limits the public page", () => {
    const page = publicSpec("demo_spec_br_b2", "203.0.113.77");
    expect(page.state).toBe("published");
    for (let i = 0; i < 7; i += 1) publicSpec("demo_spec_br_b2", "203.0.113.77");
    expect(publicSpec("demo_spec_br_b2", "203.0.113.77").state).toBe("limited");
  });
});
