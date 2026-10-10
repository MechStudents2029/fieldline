import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, documents, markups, planPins } from "@/lib/db/schema";
import { reviseJobFile } from "@/lib/services/files";
import {
  clientMayReadVisual,
  clientPortalMarkups,
  clientPortalPins,
  placePin,
  recordVisual,
  reviewPins,
  saveMarkup,
  vendorMayReadVisual,
  vendorPortalMarkups,
  vendorPortalPins,
} from "@/lib/services/markup";
import { authenticate } from "@/lib/services/read";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const layer = { shapes: [{ id: "n1", tool: "rect", color: "teal", points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }] }] };

describe("markup and plan pins", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("keeps the original photo and stores the layer plus a flat image", () => {
    const maya = actor("maya@rivera.demo");
    const db = getDb();
    const before = db.select().from(documents).where(eq(documents.id, "doc_o1")).get();
    const saved = saveMarkup(maya, { projectId: "proj_okonkwo", targetType: "photo", targetId: "doc_o1", layer, flat: { filename: "flat.png", bytes: png } });
    const after = db.select().from(documents).where(eq(documents.id, "doc_o1")).get();
    expect(after?.storagePath).toBe(before?.storagePath);
    expect(after?.filename).toBe(before?.filename);
    expect(saved.flatDocumentId).not.toBe("doc_o1");
    const row = db.select().from(markups).where(eq(markups.id, saved.id)).get();
    expect(row?.sourceDocumentId).toBe("doc_o1");
    expect(JSON.parse(row?.layerJson ?? "{}").shapes[0].color).toBe("teal");
    const audit = db.select().from(auditLogs).where(eq(auditLogs.entityId, saved.id)).all();
    expect(audit.some((entry) => entry.action === "markup.save" && entry.actorId === maya.userId && entry.createdAt)).toBe(true);
    const again = saveMarkup(maya, {
      projectId: "proj_okonkwo",
      targetType: "photo",
      targetId: "doc_o1",
      layer: { shapes: [{ id: "n2", tool: "ellipse", color: "yellow", points: [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.5 }] }] },
      flat: { filename: "flat-2.png", bytes: png },
    });
    expect(again.id).toBe(saved.id);
    expect(again.flatDocumentId).not.toBe(saved.flatDocumentId);
    expect(getDb().select().from(documents).where(eq(documents.id, "doc_o1")).get()?.storagePath).toBe(before?.storagePath);
    expect(() => saveMarkup(maya, { projectId: "proj_okonkwo", targetType: "photo", targetId: "doc_o1", layer: { shapes: [{ id: "bad", tool: "pen", color: "blue", points: [{ x: 0, y: 0 }] }] }, flat: { filename: "x.png", bytes: png } })).toThrow(/could not be saved/);
    expect(() => saveMarkup(actor("riley@rivera.demo"), { projectId: "proj_okonkwo", targetType: "photo", targetId: "doc_o1", layer, flat: { filename: "x.png", bytes: png } })).toThrow(/cannot/);
  });

  it("shows shared pins and markups to the client, and only the vendor's pin to the vendor", () => {
    const client = clientPortalPins("demo_portal_okonkwo");
    expect(client.map((pin) => pin.linkId).sort()).toEqual(["punch_ok_curb", "punch_ok_vanity"]);
    expect(JSON.stringify(client)).not.toContain("Check before tile");
    expect(JSON.stringify(client)).not.toContain("allowance");
    expect(JSON.stringify(client)).not.toContain("internalNote");
    expect(clientPortalMarkups("demo_portal_okonkwo").some((row) => row.sourceDocumentId === "doc_o1")).toBe(true);
    const maya = actor("maya@rivera.demo");
    saveMarkup(maya, { projectId: "proj_okonkwo", targetType: "photo", targetId: "doc_o2", layer, flat: { filename: "vanity.png", bytes: png } });
    expect(clientPortalMarkups("demo_portal_okonkwo").some((row) => row.sourceDocumentId === "doc_o2")).toBe(false);
    const vendor = vendorPortalPins(DEMO_HARBOR_PORTAL_TOKEN);
    expect(vendor.map((pin) => pin.linkId)).toEqual(["rfi_ok_valve"]);
    expect(JSON.stringify(vendor)).not.toContain("Check before tile");
    expect(JSON.stringify(vendor)).not.toContain("allowance");
    expect(vendorPortalMarkups(DEMO_HARBOR_PORTAL_TOKEN)).toEqual([]);
    const db = getDb();
    expect(clientMayReadVisual(db, "doc_pin_curb")).toBe(true);
    expect(clientMayReadVisual(db, "doc_pin_valve")).toBe(false);
    expect(vendorMayReadVisual(db, "org_rivera", "c_harbor", "doc_pin_valve")).toBe(true);
    expect(vendorMayReadVisual(db, "org_rivera", "c_harbor", "doc_pin_curb")).toBe(false);
    expect(recordVisual(maya, "proj_okonkwo", "punch", "punch_ok_curb").marked).toBe(true);
    expect(recordVisual(maya, "proj_okonkwo", "punch", "punch_ok_curb").cropDocumentId).toBe("doc_pin_curb");
  });

  it("links a pin to a punch and carries pins forward, leaving the old revision read-only", () => {
    const maya = actor("maya@rivera.demo");
    const pin = placePin(maya, {
      projectId: "proj_okonkwo",
      jobFileId: "jf_ok_a101_r2",
      xMilli: 400,
      yMilli: 500,
      linkType: "punch",
      linkId: "punch_ok_mirror",
      note: "Office only",
      crop: { filename: "crop.png", bytes: png },
    });
    expect(pin.number).toBe(4);
    expect(recordVisual(maya, "proj_okonkwo", "punch", "punch_ok_mirror").cropDocumentId).toBe(pin.cropDocumentId);
    expect(() => placePin(maya, { projectId: "proj_okonkwo", jobFileId: "jf_ok_a101_r1", xMilli: 10, yMilli: 10, linkType: "punch", linkId: "punch_ok_curb" })).toThrow(/read-only/);
    const revised = reviseJobFile(maya, { projectId: "proj_okonkwo", fileId: "jf_ok_a101_r2", file: { filename: "A-101-r3.pdf", bytes: pdf } });
    const db = getDb();
    const oldPins = db.select().from(planPins).where(eq(planPins.jobFileId, "jf_ok_a101_r2")).all();
    const next = db.select().from(planPins).where(eq(planPins.jobFileId, revised.id)).all();
    expect(oldPins).toHaveLength(4);
    expect(next).toHaveLength(4);
    expect(next.every((row) => row.reviewed === 0 && row.copiedFromId)).toBe(true);
    expect(oldPins.every((row) => row.reviewed === 1)).toBe(true);
    expect(db.select().from(planPins).where(eq(planPins.jobFileId, "jf_ok_a101_r1")).all()).toHaveLength(1);
    reviewPins(maya, { projectId: "proj_okonkwo", jobFileId: revised.id });
    expect(db.select().from(planPins).where(eq(planPins.jobFileId, revised.id)).all().every((row) => row.reviewed === 1)).toBe(true);
    const shared = clientPortalPins("demo_portal_okonkwo").map((row) => row.linkId);
    expect(shared).toContain("punch_ok_mirror");
    expect(shared).not.toContain("rfi_ok_valve");
    expect(JSON.stringify(clientPortalPins("demo_portal_okonkwo"))).not.toContain("Office only");
  });
});
