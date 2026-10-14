import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { withOfficeClaim } from "@/lib/db/rls-context";
import { auditLogs, changeOrders, leadSourceSpend, leads, projects, users } from "@/lib/db/schema";
import { createLeadFromText } from "@/lib/services/write";
import { createCompany } from "@/lib/services/onboarding";
import { authenticate } from "@/lib/services/read";
import {
  createLeadSource,
  leadSourceBoard,
  leadSourceEngineRows,
  leadSourceFacts,
  setLeadSource,
  setLeadSourceSpend,
  setLeadSourceStatus,
  sourceChoices,
} from "@/lib/services/lead-sources";

const JORDAN = "22222222-2222-4222-8222-222222222222";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

describe("lead sources", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
    getDb().update(users).set({ authUserId: JORDAN }).where(eq(users.id, "user_jordan")).run();
  });

  it("keeps Rivera spend off Northline, maps Website form, and holds a signed job after a retag", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const luis = actor("luis@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    const ellis = getDb().select().from(leads).where(eq(leads.id, "lead_web_ellis")).get();
    expect(ellis).toMatchObject({ source: "Website form", sourceId: "src_web" });
    const googleSpend = getDb()
      .select()
      .from(leadSourceSpend)
      .where(and(eq(leadSourceSpend.orgId, "org_rivera"), eq(leadSourceSpend.sourceId, "src_google")))
      .all()
      .reduce((sum, row) => sum + row.spendCents, 0);
    expect(googleSpend).toBe(98_000 + 145_000 + 120_000);
    expect(getDb().select().from(leadSourceSpend).where(eq(leadSourceSpend.orgId, "org_northline")).all()).toEqual([]);
    expect(leadSourceBoard(jordan)?.sources.some((source) => source.id === "src_google")).toBe(false);
    expect(leadSourceBoard(dana)).toBeNull();
    expect(() => createLeadSource(dana, "Nextdoor")).toThrow(/owner or admin/);
    expect(() => setLeadSourceSpend(dana, "src_google", "2026-10", 100)).toThrow(/owner or admin/);
    expect(() => setLeadSource(dana, "lead_vasquez", "src_google")).toThrow(/view/);

    const sql = readFileSync("supabase/rls.sql", "utf8");
    expect(sql).toContain("'lead_sources'");
    expect(sql).toContain("'lead_source_spend'");

    const chen = getDb().select().from(projects).where(eq(projects.id, "proj_chen")).get();
    const okonkwo = getDb().select().from(projects).where(eq(projects.id, "proj_okonkwo")).get();
    const orders = getDb().select().from(changeOrders).where(eq(changeOrders.projectId, "proj_okonkwo")).all();
    const approved = orders.filter((order) => order.status === "approved").reduce((sum, order) => sum + order.priceDeltaCents, 0);
    const sent = orders.find((order) => order.status === "sent");
    expect(sent?.priceDeltaCents).toBe(96_000);
    const before = leadSourceFacts("org_rivera", { from: "", to: "" });
    const referral = before.rows.find((row) => row.name === "Referral");
    expect(referral).toMatchObject({ leads: 4, won: 2, winRateBps: 5000, spendCents: 0, costPerLeadCents: 0, costPerWonCents: 0, returnHundredths: null });
    expect(referral?.soldCents).toBe((chen?.originalContractCents ?? 0) + (okonkwo?.originalContractCents ?? 0) + approved);
    expect(sent?.status).toBe("sent");
    const show = before.rows.find((row) => row.name === "Home show");
    expect(show).toMatchObject({ archived: true, leads: 1, spendCents: 80_000 });
    const google = before.rows.find((row) => row.name === "Google");
    expect(google?.spendCents).toBe(googleSpend);
    expect(google?.costPerLeadCents).toBe(Math.round(googleSpend / (google?.leads || 1)));
    expect(leadSourceEngineRows("org_rivera", { from: "", to: "" }).find((row) => row.id === "src_ref")?.cells.ret?.text).toBe("—");
    expect(before.rows.some((row) => row.name === "Online booking")).toBe(true);
    const quiet = createLeadSource(maya, "Billboard");
    setLeadSourceStatus(maya, quiet, true);
    expect(leadSourceFacts("org_rivera", { from: "", to: "" }).rows.some((row) => row.name === "Billboard")).toBe(false);

    const other = sourceChoices("org_rivera").find((source) => source.name === "Other");
    if (!other) throw new Error("missing Other");
    setLeadSource(luis, "lead_chen", other.id);
    expect(getDb().select().from(projects).where(eq(projects.id, "proj_chen")).get()?.leadSourceId).toBe("src_ref");
    const after = leadSourceFacts("org_rivera", { from: "", to: "" }).rows.find((row) => row.name === "Referral");
    expect(after?.soldCents).toBe(referral?.soldCents);
    expect(after?.won).toBe(2);
    expect(after?.leads).toBe(3);
    expect(getDb().select().from(auditLogs).where(and(eq(auditLogs.action, "lead.source"), eq(auditLogs.entityId, "lead_chen"))).get()?.payloadJson).toContain("Other");

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public-test";
    expect(() => withOfficeClaim(JORDAN, () => leadSourceFacts("org_rivera", { from: "", to: "" }))).toThrow(/signed-in account/);
    const north = withOfficeClaim(JORDAN, () => leadSourceFacts("org_northline", { from: "", to: "" }));
    expect(north.rows.every((row) => row.spendCents === 0)).toBe(true);
    expect(north.rows.some((row) => row.id === "src_google" || row.id === "src_ref")).toBe(false);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const created = createCompany({
      ownerName: "Avery Cole",
      email: "sources-new@example.com",
      password: "fieldline-test",
      companyName: "Cole Sources",
      trade: "remodel",
      state: "CA",
      starter: false,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(sourceChoices(created.actor.orgId).map((source) => source.name)).toEqual(["Website form", "Referral", "Google", "Repeat client", "Yard sign", "Other"]);
  });

  it("counts a lead on the first and last day of the range and ignores the months outside it", () => {
    const maya = actor("maya@rivera.demo");
    const sourceId = createLeadSource(maya, "Radio");
    const days = ["2026-07-31", "2026-08-01", "2026-08-31", "2026-09-01"];
    const ids = days.map((day) => {
      const created = createLeadFromText(maya, `${day} Radio, 10 sq ft deck.`, sourceId);
      getDb().update(leads).set({ createdAt: `${day}T15:00:00.000Z` }).where(eq(leads.id, created.leadId)).run();
      return created.leadId;
    });
    setLeadSourceSpend(maya, sourceId, "2026-07", 7_000);
    setLeadSourceSpend(maya, sourceId, "2026-08", 8_000);
    setLeadSourceSpend(maya, sourceId, "2026-09", 9_000);
    const august = leadSourceFacts("org_rivera", { from: "2026-08-01", to: "2026-08-31" }).rows.find((row) => row.id === sourceId);
    expect(august).toMatchObject({ leads: 2, spendCents: 8_000, costPerLeadCents: 4_000, costPerWonCents: null, returnHundredths: 0 });
    const edges = leadSourceFacts("org_rivera", { from: "2026-08-01", to: "2026-08-01" }).rows.find((row) => row.id === sourceId);
    expect(edges?.leads).toBe(1);
    expect(edges?.spendCents).toBe(8_000);
    const july = leadSourceFacts("org_rivera", { from: "2026-07-01", to: "2026-07-31" }).rows.find((row) => row.id === sourceId);
    expect(july).toMatchObject({ leads: 1, spendCents: 7_000 });
    expect(ids).toHaveLength(4);
    const text = JSON.stringify(leadSourceEngineRows("org_rivera", { from: "2026-08-01", to: "2026-08-31" }));
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
  });
});
