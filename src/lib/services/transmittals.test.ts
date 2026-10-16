import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { messages, notifications, submittals } from "@/lib/db/schema";
import { mentionUnread } from "@/lib/services/comments";
import { ServiceError } from "@/lib/services/errors";
import { authenticate } from "@/lib/services/read";
import {
  acknowledgeByToken,
  addTransmittalFile,
  addTransmittalNote,
  copyTransmittal,
  createTransmittal,
  declineTransmittalByToken,
  listTransmittals,
  markTransmittalSent,
  portalTransmittalsForClient,
  portalTransmittalsForVendor,
  publicTransmittal,
  saveTransmittal,
  transmittalAttention,
  transmittalDetail,
  transmittalFileByToken,
  transmittalsCsv,
  voidTransmittal,
} from "@/lib/services/transmittals";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(email);
  return user;
}

function open(token: string, ip = "198.51.100.10") {
  return { token, startedAt: String(Date.now() - 4_000), companyUrl: "", ip, nowMs: Date.now() };
}

describe("document transmittals", () => {
  beforeAll(() => {
    clearSupabaseEnv();
    useDatabaseFile(":memory:");
  });

  it("names the new tables in the Postgres policy list", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    for (const table of ["transmittals", "transmittal_ccs", "transmittal_lines", "transmittal_attempts"]) {
      expect(sql.split(`'${table}'`).length - 1).toBe(2);
    }
  });

  it("seeds one past-due sent package, one acknowledgment, and one draft", () => {
    const maya = actor("maya@rivera.demo");
    expect(transmittalAttention(maya)).toEqual({ count: 1, href: "/transmittals?filter=due" });
    expect(listTransmittals(maya, { filter: "due" }).map((row) => row.subject)).toEqual(["Valve cut sheet"]);
    expect(listTransmittals(maya, { filter: "acknowledged" }).map((row) => [row.subject, row.toName])).toEqual([["Finish schedule", "Amara Okonkwo"]]);
    expect(listTransmittals(maya, { filter: "draft" }).map((row) => row.subject)).toEqual(["Vanity dimensions"]);
    const due = transmittalDetail(maya, "tx_ok_due");
    expect(due?.number).toBe(1);
    expect(due?.toName).toBe("Harbor Plumbing");
    expect(due?.cc.map((row) => row.name)).toEqual(["Sam Patel"]);
    expect(due?.lines.filter((line) => line.returnRequired).map((line) => line.title)).toEqual(["A-101 floor plan"]);
    expect(transmittalDetail(actor("dana@rivera.demo"), "tx_ok_due")?.subject).toBe("Valve cut sheet");
    expect(transmittalDetail(actor("jordan@northline.demo"), "tx_ok_due")).toBeNull();
    expect(portalTransmittalsForVendor(DEMO_HARBOR_PORTAL_TOKEN).map((row) => row.subject)).toEqual(["Valve cut sheet"]);
    expect(portalTransmittalsForClient("demo_portal_okonkwo").map((row) => row.subject)).toEqual(["Finish schedule"]);
    expect(portalTransmittalsForClient("demo_portal_diaz")).toEqual([]);
    expect(portalTransmittalsForVendor("nope")).toEqual([]);
    expect(publicTransmittal("demo_tx_ok_due").state).toBe("open");
    expect(publicTransmittal("demo_tx_chen_draft")).toMatchObject({ state: "closed", line: "This package has not been sent." });
    expect(publicTransmittal("missing").state).toBe("missing");
    expect(transmittalFileByToken("demo_tx_ok_due", "txl_ok_due_plan")?.filename).toBe("a101-floor-plan.pdf");
    expect(transmittalFileByToken("demo_tx_chen_draft", "txl_chen_note")).toBeNull();
    expect(transmittalsCsv(maya)).toContain("Valve cut sheet");
    expect(mentionUnread(maya)).toBe(2);
  });

  it("numbers per job, locks a sent package, and does not write a message", () => {
    const maya = actor("maya@rivera.demo");
    const first = createTransmittal(maya, "proj_brooks", { subject: "Framing set", toKind: "user", toId: "user_luis", purpose: "construction" });
    const second = createTransmittal(maya, "proj_brooks", { subject: "Second set", toKind: "user", toId: "user_luis", purpose: "information" });
    expect(transmittalDetail(maya, first)?.number).toBe(1);
    expect(transmittalDetail(maya, second)?.number).toBe(2);
    expect(() => markTransmittalSent(maya, first)).toThrow(/line/i);
    addTransmittalNote(maya, first, "Hold the header height", false);
    const beforeMessages = getDb().select().from(messages).all().length;
    const beforeNotes = getDb().select().from(notifications).all().length;
    copyTransmittal(maya, first);
    markTransmittalSent(maya, first);
    const sent = transmittalDetail(maya, first);
    expect(sent?.status).toBe("sent");
    expect(sent?.sentBy).toBe("user_maya");
    expect(sent?.copiedBy).toBe("user_maya");
    expect(getDb().select().from(messages).all().length).toBe(beforeMessages);
    expect(getDb().select().from(notifications).all().length).toBe(beforeNotes);
    expect(() => saveTransmittal(maya, first, { subject: "Changed", toKind: "user", toId: "user_luis", purpose: "information" })).toThrow(/locked/);
    expect(() => addTransmittalNote(maya, first, "Late note", false)).toThrow(/locked/);
    expect(mentionUnread(maya)).toBe(2);
  });

  it("attaches a plan, a published spec, and an approved submittal", () => {
    const maya = actor("maya@rivera.demo");
    getDb().update(submittals).set({ status: "approved" }).where(eq(submittals.id, "sub_ok_valve")).run();
    const packageId = createTransmittal(maya, "proj_okonkwo", { subject: "Shower set", toKind: "vendor", toId: "c_harbor", purpose: "approval" });
    addTransmittalFile(maya, packageId, "plan", "jf_ok_a101_r2", true);
    addTransmittalFile(maya, packageId, "spec", "spec_ok_shower", false);
    addTransmittalFile(maya, packageId, "submittal", "sub_ok_valve", false);
    expect(transmittalDetail(maya, packageId)?.lines.map((line) => [line.kind, line.title, line.returnRequired])).toEqual([
      ["plan", "A-101 floor plan", true],
      ["spec", "Shower specs", false],
      ["submittal", "Shower valve cut sheet", false],
    ]);
    expect(() => addTransmittalFile(maya, packageId, "plan", "jf_ok_a101_r2", false)).toThrow(/attached/i);
  });

  it("acknowledges and declines on the public link", () => {
    const maya = actor("maya@rivera.demo");
    const ackId = createTransmittal(maya, "proj_chen", { subject: "Ack set", toKind: "client", toId: "c_chen", purpose: "information" });
    addTransmittalNote(maya, ackId, "Look at the niche", false);
    markTransmittalSent(maya, ackId);
    const ackToken = transmittalDetail(maya, ackId)?.shareToken ?? "";
    expect(() => acknowledgeByToken({ ...open(ackToken), startedAt: String(Date.now()), name: "Mei Chen" })).toThrow(/Wait/);
    expect(acknowledgeByToken({ ...open(ackToken), companyUrl: "https://spam.example", name: "Mei Chen" })).toEqual({ dropped: "honeypot" });
    expect(() => acknowledgeByToken({ ...open(ackToken), name: " " })).toThrow(/name/i);
    acknowledgeByToken({ ...open(ackToken), name: "Mei Chen", note: "Got it" });
    expect(transmittalDetail(maya, ackId)).toMatchObject({ status: "acknowledged", ackName: "Mei Chen", ackNote: "Got it" });
    expect(publicTransmittal(ackToken).state).toBe("done");

    const declineId = createTransmittal(maya, "proj_chen", { subject: "Decline set", toKind: "user", toId: "user_luis", purpose: "requested" });
    addTransmittalNote(maya, declineId, "Old drawing", false);
    markTransmittalSent(maya, declineId);
    const declineToken = transmittalDetail(maya, declineId)?.shareToken ?? "";
    expect(() => declineTransmittalByToken({ ...open(declineToken, "198.51.100.11"), reason: " " })).toThrow(/reason/i);
    declineTransmittalByToken({ ...open(declineToken, "198.51.100.11"), reason: "Wrong revision" });
    expect(transmittalDetail(maya, declineId)).toMatchObject({ status: "declined", declineReason: "Wrong revision" });
  });

  it("limits repeated public attempts", () => {
    const maya = actor("maya@rivera.demo");
    const packageId = createTransmittal(maya, "proj_chen", { subject: "Limit set", toKind: "user", toId: "user_sam", purpose: "other" });
    addTransmittalNote(maya, packageId, "Hold", false);
    markTransmittalSent(maya, packageId);
    const share = transmittalDetail(maya, packageId)?.shareToken ?? "";
    const ip = "203.0.113.44";
    for (let i = 0; i < 8; i += 1) {
      expect(() => acknowledgeByToken({ token: share, name: "Sam", note: "", startedAt: String(Date.now()), companyUrl: "", ip, nowMs: Date.now() })).toThrow(/Wait/);
    }
    expect(() => acknowledgeByToken({ ...open(share, ip), name: "Sam Patel" })).toThrow(/Too many/);
  });

  it("lets office void with a reason and refuses field edits", () => {
    const maya = actor("maya@rivera.demo");
    const packageId = createTransmittal(maya, "proj_chen", { subject: "Void set", toKind: "user", toId: "user_luis", purpose: "other" });
    expect(() => voidTransmittal(actor("luis@rivera.demo"), packageId, "Wrong job")).toThrow(/void/);
    expect(() => voidTransmittal(maya, packageId, " ")).toThrow(/reason/i);
    voidTransmittal(maya, packageId, "Wrong job");
    expect(transmittalDetail(maya, packageId)?.status).toBe("voided");
    expect(publicTransmittal(transmittalDetail(maya, packageId)?.shareToken ?? "")).toMatchObject({ state: "closed" });
    expect(() => createTransmittal(actor("dana@rivera.demo"), "proj_chen", { subject: "Field", toKind: "user", toId: "user_luis", purpose: "information" })).toThrow(ServiceError);
    expect(() => createTransmittal(actor("jordan@northline.demo"), "proj_okonkwo", { subject: "Other", toKind: "user", toId: "user_luis", purpose: "information" })).toThrow(ServiceError);
  });
});
