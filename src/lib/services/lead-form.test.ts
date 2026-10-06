import fs from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { dataDir, getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, contacts, documents, leadFormAttempts, leadForms, leads, messages } from "@/lib/db/schema";
import { DEMO_NORTH_FORM_TOKEN, DEMO_RIVERA_FORM_TOKEN, IP_LIMIT, ORG_LIMIT } from "@/lib/lead-form/rules";
import { MAX_PHOTO_BYTES } from "@/lib/security";
import { authenticate } from "@/lib/services/read";
import {
  leadFormBoard,
  markWebLeadOpened,
  publicLeadForm,
  regenerateLeadFormKey,
  saveLeadForm,
  submitLeadForm,
  unseenWebLeadCount,
  webLeadSubmission,
} from "@/lib/services/lead-form";

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x10, 0xff, 0xd9]);

function submit(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  const fields = {
    token: DEMO_RIVERA_FORM_TOKEN,
    ip: "203.0.113.10",
    now,
    name: "Casey Ng",
    email: `casey.${now}.${Math.random().toString(16).slice(2)}@example.com`,
    phone: "",
    address: "18 Maple St",
    projectType: "Bath remodel",
    budget: "$25–50k",
    timeline: "1–3 months",
    description: "Primary bath, about 90 sq ft.",
    companyUrl: "",
    startedAt: String(now - 10_000),
    photos: [] as { filename: string; bytes: Buffer }[],
    ...overrides,
  };
  return submitLeadForm(fields);
}

describe("lead form", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("seeds Rivera on and Northline off, with one unopened web lead", () => {
    expect(publicLeadForm(DEMO_RIVERA_FORM_TOKEN).state).toBe("open");
    expect(publicLeadForm(DEMO_NORTH_FORM_TOKEN)).toMatchObject({ state: "disabled", orgName: "Northline Electric" });
    expect(publicLeadForm("missing-token")).toEqual({ state: "missing" });
    expect(unseenWebLeadCount("org_rivera")).toBe(1);
    expect(leadFormBoard(actor("luis@rivera.demo"))).toBeNull();
    expect(leadFormBoard(actor("maya@rivera.demo"))?.enabled).toBe(true);
    const sql = readFileSync("supabase/rls.sql", "utf8");
    for (const table of ["lead_forms", "lead_form_submissions", "lead_form_attempts"]) {
      expect(sql).toContain(`'${table}'`);
    }
  });

  it("rejects a disabled form, a honeypot, and a fast submit without a lead", () => {
    const before = getDb().select().from(leads).where(eq(leads.orgId, "org_northline")).all().length;
    expect(() => submit({ token: DEMO_NORTH_FORM_TOKEN, ip: "203.0.113.20" })).toThrow(/Not taking requests/);
    expect(getDb().select().from(leads).where(eq(leads.orgId, "org_northline")).all().length).toBe(before);
    expect(getDb().select().from(leadFormAttempts).where(eq(leadFormAttempts.orgId, "org_northline")).all()).toHaveLength(0);

    const dropped = submit({ companyUrl: "https://spam.test", ip: "203.0.113.21", email: "honeypot.leadform@example.com" });
    expect(dropped).toEqual({ dropped: "honeypot" });
    expect(getDb().select().from(contacts).all().some((row) => row.email === "honeypot.leadform@example.com")).toBe(false);

    expect(() => submit({ startedAt: String(Date.now()), ip: "203.0.113.22", email: "fast.leadform@example.com" })).toThrow(/Wait/);
    expect(getDb().select().from(contacts).all().some((row) => row.email === "fast.leadform@example.com")).toBe(false);
  });

  it("validates through the submit path", () => {
    expect(() => submit({ name: "", ip: "203.0.113.30" })).toThrow(/name/i);
    expect(() => submit({ email: "", phone: "", ip: "203.0.113.31" })).toThrow(/email or a phone/i);
    expect(() => submit({ description: "a".repeat(4001), ip: "203.0.113.32" })).toThrow(/too long/i);
    expect(() => submit({ photos: [jpeg, jpeg, jpeg, jpeg].map((bytes) => ({ filename: "a.jpg", bytes })), ip: "203.0.113.33" })).toThrow(/Three photos/);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_PHOTO_BYTES)]);
    expect(() => submit({ photos: [{ filename: "big.jpg", bytes: big }], ip: "203.0.113.34" })).toThrow(/2\.5 MB/);
    expect(() => submit({ photos: [{ filename: "note.svg", bytes: jpeg }], ip: "203.0.113.35" })).toThrow(/JPEG/);
  });

  it("reuses a contact by email or phone and does not send a message", () => {
    const beforeMessages = getDb().select().from(messages).all().length;
    const byEmail = submit({
      email: "amara.okonkwo@example.com",
      phone: "",
      name: "A Okonkwo",
      ip: "203.0.113.40",
      description: "Kitchen about 200 sq ft, budget $40k.",
      projectType: "Deck",
    });
    expect("deduped" in byEmail && byEmail.deduped).toBe(true);
    if (!("leadId" in byEmail)) throw new Error("expected a lead");
    expect(byEmail.contactId).toBe("c_okonkwo");
    const emails = getDb().select().from(contacts).all().filter((row) => row.email === "amara.okonkwo@example.com");
    expect(emails).toHaveLength(1);
    const lead = getDb().select().from(leads).where(eq(leads.id, byEmail.leadId)).get();
    expect(lead?.orgId).toBe("org_rivera");
    expect(lead?.source).toBe("Website form");
    expect(lead?.stageId).toBe("stage_new");
    expect(lead?.title).toContain("Deck");
    expect(lead?.title).not.toContain("Kitchen");
    expect(lead?.sqft).toBe(200);
    expect(lead?.valueEstCents).toBe(4_000_000);
    expect(getDb().select().from(messages).all().length).toBe(beforeMessages);

    const byPhone = submit({
      email: "",
      phone: "5105550166",
      name: "Amara Again",
      ip: "203.0.113.41",
      projectType: "",
      description: "",
    });
    expect("deduped" in byPhone && byPhone.deduped && byPhone.contactId).toBe("c_okonkwo");
  });

  it("reads project type from the description when the form leaves it blank", () => {
    const created = submit({
      projectType: "",
      description: "Kitchen about 80 sq ft.",
      ip: "203.0.113.42",
    });
    if (!("leadId" in created)) throw new Error("expected a lead");
    const lead = getDb().select().from(leads).where(eq(leads.id, created.leadId)).get();
    expect(lead?.title).toContain("Kitchen remodel");
    expect(lead?.sqft).toBe(80);
  });

  it("stores a photo on the lead and keeps the submitted answers", () => {
    const created = submit({
      photos: [{ filename: "sink.jpg", bytes: jpeg }],
      ip: "203.0.113.43",
      source: "yard-sign",
      utmSource: "google",
    });
    if (!("leadId" in created)) throw new Error("expected a lead");
    const photo = getDb().select().from(documents).where(and(eq(documents.leadId, created.leadId), eq(documents.orgId, "org_rivera"))).get();
    expect(photo?.type).toBe("photo");
    expect(photo && fs.existsSync(path.join(dataDir(), photo.storagePath))).toBe(true);
    if (photo) fs.rmSync(path.join(dataDir(), photo.storagePath));
    const view = webLeadSubmission("org_rivera", created.leadId);
    expect(view?.answers.budget).toBe("$25–50k");
    expect(view?.attribution).toContain("yard-sign");
    expect(view?.attribution).toContain("utm_source google");
    const audit = getDb().select().from(auditLogs).where(eq(auditLogs.entityId, created.leadId)).get();
    expect(audit?.action).toBe("lead_form.submit");
    expect(audit?.orgId).toBe("org_rivera");
    expect(unseenWebLeadCount("org_rivera")).toBeGreaterThan(1);
    markWebLeadOpened("org_rivera", created.leadId);
    expect(webLeadSubmission("org_rivera", created.leadId)?.answers.name).toBeTruthy();
  });

  it("cannot write another company from this form key", () => {
    const northBefore = getDb().select().from(leads).where(eq(leads.orgId, "org_northline")).all().length;
    const created = submit({
      email: "ada.mensah@example.com",
      name: "Ada Mensah",
      ip: "203.0.113.44",
    });
    if (!("leadId" in created)) throw new Error("expected a lead");
    const lead = getDb().select().from(leads).where(eq(leads.id, created.leadId)).get();
    expect(lead?.orgId).toBe("org_rivera");
    expect(created.contactId).not.toBe("c_north_ada");
    const matches = getDb().select().from(contacts).all().filter((row) => row.email === "ada.mensah@example.com");
    expect(matches.map((row) => row.orgId).sort()).toEqual(["org_northline", "org_rivera"]);
    expect(getDb().select().from(leads).where(eq(leads.orgId, "org_northline")).all().length).toBe(northBefore);

    saveLeadForm(actor("jordan@northline.demo"), {
      enabled: true,
      intro: "Panel work.",
      thanks: "Got it.",
      fields: { address: false, projectType: true, budget: false, timeline: false, description: true, photos: false },
      projectTypes: ["Panel", "EV charger"],
    });
    const north = submit({
      token: DEMO_NORTH_FORM_TOKEN,
      email: "ada.mensah@example.com",
      name: "Ada Mensah",
      projectType: "Panel",
      description: "New circuit.",
      ip: "203.0.113.45",
    });
    if (!("leadId" in north)) throw new Error("expected a northline lead");
    expect(north.deduped).toBe(true);
    expect(north.contactId).toBe("c_north_ada");
    expect(getDb().select().from(leads).where(eq(leads.id, north.leadId)).get()?.orgId).toBe("org_northline");
  });

  it("replaces the public key and refuses the old one", () => {
    const maya = actor("maya@rivera.demo");
    const northToken = getDb().select().from(leadForms).where(eq(leadForms.orgId, "org_northline")).get()?.token;
    const next = regenerateLeadFormKey(maya);
    expect(next).not.toBe(DEMO_RIVERA_FORM_TOKEN);
    expect(() => submit({ token: DEMO_RIVERA_FORM_TOKEN, ip: "203.0.113.46" })).toThrow(/Not taking requests/);
    const created = submit({ token: next, ip: "203.0.113.47" });
    expect("leadId" in created).toBe(true);
    expect(getDb().select().from(leadForms).where(eq(leadForms.orgId, "org_northline")).get()?.token).toBe(northToken);
    getDb().update(leadForms).set({ token: DEMO_RIVERA_FORM_TOKEN }).where(eq(leadForms.orgId, "org_rivera")).run();
    expect(() => saveLeadForm(actor("luis@rivera.demo"), {
      enabled: false,
      intro: "",
      thanks: "Thanks.",
      fields: { address: false, projectType: false, budget: false, timeline: false, description: false, photos: false },
      projectTypes: [],
    })).toThrow(/owner or admin/);
  });

  it("stops an address and a company after the limit", () => {
    const ip = "203.0.113.60";
    for (let i = 0; i < IP_LIMIT; i += 1) submit({ ip, email: `limit.${i}@example.com` });
    expect(() => submit({ ip, email: "limit.over@example.com" })).toThrow(/Too many/);
    const now = new Date().toISOString();
    for (let i = 0; i < ORG_LIMIT; i += 1) {
      getDb().insert(leadFormAttempts).values({ id: `att_org_${i}`, orgId: "org_rivera", ip: "198.51.100.9", createdAt: now }).run();
    }
    expect(() => submit({ ip: "203.0.113.70", email: "org.limit@example.com" })).toThrow(/Too many/);
  });
});
