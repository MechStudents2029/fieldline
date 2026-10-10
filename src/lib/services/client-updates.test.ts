import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { clientUpdateFromFacts } from "@/lib/ai/client-update";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, changeOrders, clientUpdates, dailyLogs, messages } from "@/lib/db/schema";
import { authenticate } from "@/lib/services/read";
import {
  clientUpdateDetail,
  createClientUpdate,
  listClientUpdates,
  portalClientUpdates,
  publishClientUpdate,
  saveClientUpdate,
  staleClientUpdates,
  unpublishClientUpdate,
} from "@/lib/services/client-updates";
import { renderUpdateBody } from "@/lib/updates/draft";
import { gatherClientUpdateFacts } from "@/lib/updates/gather";
import { defaultRange } from "@/lib/updates/range";
import { localDay } from "@/lib/time/calendar";

const ORG = "org_rivera";
const NORTH = "org_northline";
const ZONE = "America/New_York";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("client updates", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("drafts only client-safe rows from this company", () => {
    const db = getDb();
    const range = defaultRange(Date.now(), ZONE);
    db.insert(dailyLogs)
      .values({
        id: "log_north_leak",
        orgId: NORTH,
        projectId: "proj_okonkwo",
        authorId: "user_jordan",
        logDate: range.end,
        status: "published",
        visibility: "client",
        notes: "Northline secret panel.",
        plannedNext: null,
        weatherSky: null,
        weatherHighF: null,
        weatherLowF: null,
        weatherLostMinutes: null,
        weatherImpact: null,
        delayCause: null,
        delayMinutes: null,
        deliveries: null,
        visitors: null,
        safetyNote: null,
        publishedAt: range.end,
        voidReason: null,
        createdAt: range.end,
        updatedAt: range.end,
      })
      .run();

    const facts = gatherClientUpdateFacts(db, ORG, "proj_okonkwo", range, ZONE);
    const blob = JSON.stringify(facts);
    expect(blob).toContain("Set the shower wall and kept the niche dry.");
    expect(blob).not.toContain("Northline secret");
    expect(blob).not.toContain("inspector");
    expect(blob).not.toContain("Wet floor");
    expect(blob).not.toContain("Dana");
    expect(blob).not.toContain("user_dana");
    expect(blob).not.toContain("Homeowner home");
    expect(blob).not.toContain("Framed the west");
    expect(blob).not.toContain("HP-510");
    expect(blob).not.toContain("PO-1055");
    expect(blob).not.toContain("64000");
    expect(blob).not.toContain("delayCause");

    const other = gatherClientUpdateFacts(db, NORTH, "proj_okonkwo", range, ZONE);
    expect(JSON.stringify(other)).toContain("Northline secret");
    expect(JSON.stringify(other)).not.toContain("shower wall");

    const draft = clientUpdateFromFacts(facts);
    const again = clientUpdateFromFacts(facts);
    expect(JSON.stringify(draft)).toBe(JSON.stringify(again));
    const body = renderUpdateBody(draft);
    expect(body).toContain("This week");
    expect(body).toContain("Next week");
    expect(body).toContain("Decisions needed");
    expect(body).toContain("Money");
    expect(body).toContain("Photos");
    expect(body).toContain("Set the shower wall and kept the niche dry.");
    expect(body).toContain("Clear, 72°/54°.");
    expect(body).toContain("Grout the curb.");
    expect(body).toContain("We walked the job with you on");
    expect(body).toContain("We finished demo on");
    expect(body).toContain("We still need your floor tile pick (was due");
    expect(body).not.toContain("Client walk started");
    expect(body).toContain("Shower substrate");
    expect(body).toContain("$960.00");
    expect(body).toContain("Heated floor mat");
    expect(body).not.toContain("Vanity location");
    expect(body).not.toContain("$640.00");
    expect(body).not.toContain("inspector");
    expect(body).not.toContain("Northline secret");
    for (const part of draft.sections) {
      for (const line of part.sentences) {
        if (line.text === "Nothing to report.") expect(line.source).toBeNull();
        else expect(line.source?.id).toBeTruthy();
      }
    }

    const seeded = db.select().from(clientUpdates).where(eq(clientUpdates.id, "upd_ok_published")).get();
    expect(seeded?.status).toBe("published");
    expect(seeded?.body).toContain("Set the shower wall");
    expect(seeded?.body).not.toContain("inspector");
    expect(db.select().from(clientUpdates).where(eq(clientUpdates.id, "upd_ok_draft")).get()?.status).toBe("draft");
  });

  it("classifies instants on the spring-forward and fall-back days", () => {
    const db = getDb();
    db.insert(changeOrders)
      .values([
        {
          id: "co_dst_in",
          orgId: ORG,
          projectId: "proj_okonkwo",
          number: 80,
          title: "Spring niche",
          status: "approved",
          description: null,
          priceDeltaCents: 100,
          costDeltaCents: 99999,
          publicToken: "demo_co_dst_in",
          sentAt: "2026-03-08T07:30:00.000Z",
          approvedAt: "2026-03-08T07:30:00.000Z",
          createdAt: "2026-03-08T07:30:00.000Z",
          updatedAt: "2026-03-08T07:30:00.000Z",
          createdBy: "user_maya",
        },
        {
          id: "co_dst_out",
          orgId: ORG,
          projectId: "proj_okonkwo",
          number: 81,
          title: "Evening niche",
          status: "approved",
          description: null,
          priceDeltaCents: 100,
          costDeltaCents: 99999,
          publicToken: "demo_co_dst_out",
          sentAt: "2026-03-08T04:30:00.000Z",
          approvedAt: "2026-03-08T04:30:00.000Z",
          createdAt: "2026-03-08T04:30:00.000Z",
          updatedAt: "2026-03-08T04:30:00.000Z",
          createdBy: "user_maya",
        },
      ])
      .run();
    const spring = gatherClientUpdateFacts(db, ORG, "proj_okonkwo", { start: "2026-03-08", end: "2026-03-08" }, ZONE);
    expect(spring.changeOrders.map((order) => order.id)).toContain("co_dst_in");
    expect(spring.changeOrders.map((order) => order.id)).not.toContain("co_dst_out");
    expect(JSON.stringify(spring)).not.toContain("99999");
    const fall = gatherClientUpdateFacts(db, ORG, "proj_okonkwo", { start: "2026-11-01", end: "2026-11-01" }, ZONE);
    expect(fall.logs.every((log) => log.logDate === "2026-11-01")).toBe(true);
  });

  it("publishes, versions, records a view, and unpublishes", () => {
    const maya = actor("maya@rivera.demo");
    const today = localDay(Date.now(), ZONE);
    expect(staleClientUpdates(ORG, today, ZONE).count).toBe(3);
    expect(() => createClientUpdate(actor("dana@rivera.demo"), "proj_okonkwo", null, null)).toThrow(/Office/);
    expect(() => listClientUpdates(actor("jordan@northline.demo"), "proj_okonkwo")).toThrow(/not in this company/);

    const db = getDb();
    const messagesBefore = db.select().from(messages).all().length;
    const created = createClientUpdate(maya, "proj_okonkwo", null, "office");
    saveClientUpdate(maya, created.id, "The niche is ready for grout.", ["doc_o1", "doc_o2"], "office");
    publishClientUpdate(maya, created.id, "office");
    const published = clientUpdateDetail(maya, "proj_okonkwo", created.id);
    expect(published?.update.status).toBe("published");
    expect(published?.update.viewedAt).toBeNull();
    expect(published?.update.photoIdsJson).toContain("doc_o1");
    expect(published?.update.photoIdsJson).not.toContain("doc_o2");
    expect(published?.versions).toHaveLength(1);
    expect(db.select().from(messages).all().length).toBe(messagesBefore);

    saveClientUpdate(maya, created.id, "The niche is ready for grout. Second pass.", ["doc_o1"], "office");
    const revised = clientUpdateDetail(maya, "proj_okonkwo", created.id);
    expect(revised?.update.version).toBe(2);
    expect(revised?.versions.map((version) => version.version).sort()).toEqual([1, 2]);

    const firstView = portalClientUpdates("demo_portal_okonkwo", "portal");
    expect(firstView?.updates[0]?.body).toContain("Second pass.");
    expect(firstView?.updates.some((update) => update.id === "upd_ok_draft")).toBe(false);
    expect(firstView?.updates.some((update) => update.body.includes("inspector"))).toBe(false);
    const viewedAt = clientUpdateDetail(maya, "proj_okonkwo", created.id)?.update.viewedAt;
    expect(viewedAt).toBeTruthy();
    portalClientUpdates("demo_portal_okonkwo", "portal");
    expect(clientUpdateDetail(maya, "proj_okonkwo", created.id)?.update.viewedAt).toBe(viewedAt);

    expect(() => unpublishClientUpdate(maya, created.id, "no", "office")).toThrow(/reason/);
    unpublishClientUpdate(maya, created.id, "Hold for the walkthrough.", "office");
    const hidden = portalClientUpdates("demo_portal_okonkwo", "portal");
    expect(hidden?.updates.some((update) => update.id === created.id)).toBe(false);
    expect(clientUpdateDetail(maya, "proj_okonkwo", created.id)?.update.status).toBe("unpublished");

    const actions = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, created.id))
      .all()
      .map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["client_update.draft", "client_update.edit", "client_update.publish", "client_update.view", "client_update.unpublish"]));
    expect(db.select().from(auditLogs).where(eq(auditLogs.entityType, "client_update")).all().every((row) => row.orgId === ORG)).toBe(true);
  });
});
