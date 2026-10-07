import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { auditLogs, commentAttempts, commentMentions, comments, notifications } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { authenticate, portalByToken } from "@/lib/services/read";
import { vendorPortal } from "@/lib/services/vendor-portal";
import { clientPortalRfis, vendorPortalRfis, answerVendorRfi } from "@/lib/services/rfis";
import { DEMO_HARBOR_PORTAL_TOKEN } from "@/lib/vendor/token";
import {
  COMMENT_USER_LIMIT,
  commentThread,
  deleteComment,
  editComment,
  listInbox,
  mentionUnread,
  parseMentions,
  postComment,
  setNotifyPreference,
} from "@/lib/services/comments";

function actor(email: string) {
  const user = authenticate(email, "demo");
  if (!user) throw new Error(`missing ${email}`);
  return user;
}

describe("comments and inbox", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    useDatabaseFile(":memory:");
  });

  it("keeps comment rows off the money-table list and scopes financial comments", () => {
    const sql = readFileSync("supabase/rls.sql", "utf8");
    const money = sql.slice(sql.lastIndexOf("foreach tbl in array array["));
    expect(money).not.toContain("'comments'");
    expect(sql).toContain("comments_scope");
    expect(sql).toContain("notifications_scope");
    expect(sql).toContain("user_id = public.current_user_id()");
    expect(sql).toContain("entity_type not in ('estimate', 'change_order', 'purchase_order', 'bill')");
  });

  it("parses names, role words, and structured tokens", () => {
    const members = [
      { id: "user_maya", name: "Maya Rivera" },
      { id: "user_luis", name: "Luis Ortega" },
    ];
    const parsed = parseMentions("Ask @Maya Rivera and @office and @[role:admins]", members);
    expect(parsed.error).toBeUndefined();
    expect(parsed.body).toContain("@[user:user_maya]");
    expect(parsed.body).toContain("@[role:office]");
    expect(parsed.body).toContain("@[role:admins]");
    expect(parsed.mentions).toEqual([
      { kind: "role", role: "admins" },
      { kind: "user", userId: "user_maya" },
      { kind: "role", role: "office" },
    ]);
    expect(parseMentions("Hi @Jordan", members).error).toMatch(/No match for @Jordan/);
  });

  it("shows seeded inbox rows for the demo owner and hides them from portals", () => {
    const maya = actor("maya@rivera.demo");
    const inbox = listInbox(maya, "unread");
    expect(inbox.some((row) => row.record.includes("RFI-001") && row.kind === "mention")).toBe(true);
    expect(inbox.some((row) => row.snippet.includes("Niche tile") && row.kind === "mention")).toBe(true);
    expect(inbox.some((row) => row.kind === "assignment" && row.record.includes("Client walk"))).toBe(true);
    expect(mentionUnread(maya)).toBe(2);
    const thread = commentThread(maya, "rfi", "rfi_ok_valve");
    expect(thread?.comments.some((row) => row.parts.some((part) => part.kind === "pill" && part.text === "Maya Rivera"))).toBe(true);
    expect(JSON.stringify(vendorPortalRfis(DEMO_HARBOR_PORTAL_TOKEN))).not.toContain("Valve center is 48 inches");
    expect(JSON.stringify(clientPortalRfis("demo_portal_okonkwo"))).not.toContain("Niche tile is on site");
    expect(JSON.stringify(portalByToken("demo_portal_okonkwo"))).not.toContain("Niche tile is on site");
    expect(JSON.stringify(vendorPortal(DEMO_HARBOR_PORTAL_TOKEN))).not.toContain("Valve center is 48 inches");
  });

  it("fans out one mention when a person is named and in the role, and skips the author", () => {
    const luis = actor("luis@rivera.demo");
    const dana = actor("dana@rivera.demo");
    postComment(dana, "rfi", "rfi_ok_vanity", "On site for the vanity");
    const commentId = postComment(luis, "rfi", "rfi_ok_vanity", "Check @Maya Rivera and @admins");
    const notes = getDb().select().from(notifications).where(eq(notifications.commentId, commentId)).all();
    expect(notes.filter((row) => row.userId === "user_maya")).toEqual([expect.objectContaining({ kind: "mention" })]);
    expect(notes.filter((row) => row.userId === "user_sam")).toHaveLength(1);
    expect(notes.filter((row) => row.userId === "user_luis")).toHaveLength(0);
    expect(notes.filter((row) => row.userId === "user_dana").map((row) => row.kind)).toEqual(["reply"]);
    const stored = getDb().select().from(commentMentions).where(eq(commentMentions.commentId, commentId)).all();
    expect(stored.some((row) => row.kind === "user" && row.userId === "user_maya")).toBe(true);
    expect(stored.some((row) => row.kind === "role" && row.role === "admins")).toBe(true);
    const officeId = postComment(luis, "schedule_item", "sch_ok_tile", "@office tile is set");
    const officeNotes = getDb().select().from(notifications).where(eq(notifications.commentId, officeId)).all();
    expect(officeNotes.find((row) => row.userId === "user_luis")).toBeUndefined();
  });

  it("skips reply notices when the user only wants mentions", () => {
    const luis = actor("luis@rivera.demo");
    const dana = actor("dana@rivera.demo");
    postComment(dana, "daily_log", "log_ok_draft", "Morning on site");
    setNotifyPreference(dana, "mentions");
    const commentId = postComment(luis, "daily_log", "log_ok_draft", "Copy that");
    const notes = getDb().select().from(notifications).where(eq(notifications.commentId, commentId)).all();
    expect(notes.find((row) => row.userId === "user_dana")).toBeUndefined();
  });

  it("refuses a mention without access and hides financial comments from field and other companies", () => {
    const maya = actor("maya@rivera.demo");
    const dana = actor("dana@rivera.demo");
    const jordan = actor("jordan@northline.demo");
    expect(() => postComment(maya, "bill", "bill_ok_harbor", "Look @Dana Cho")).toThrow(/Dana Cho cannot see this/);
    expect(() => postComment(maya, "project", "proj_okonkwo", "Ask @Jordan Hale")).toThrow(/No match for @Jordan/);
    expect(commentThread(dana, "bill", "bill_ok_harbor")).toBeNull();
    expect(() => postComment(dana, "bill", "bill_ok_harbor", "Field note")).toThrow(/cannot see/);
    expect(commentThread(jordan, "rfi", "rfi_ok_valve")).toBeNull();
    expect(() => postComment(jordan, "rfi", "rfi_ok_valve", "Other company")).toThrow(/not in your company/);
    expect(listInbox(jordan, "all").some((row) => row.snippet.includes("48 inches"))).toBe(false);
    expect(commentThread(dana, "rfi", "rfi_ok_valve")?.comments.length).toBeGreaterThan(0);
  });

  it("edits inside 15 minutes, then refuses, and soft-deletes with an audit row", () => {
    const maya = actor("maya@rivera.demo");
    const commentId = postComment(maya, "project", "proj_okonkwo", "Fresh note");
    editComment(maya, commentId, "Fresh note edited");
    expect(commentThread(maya, "project", "proj_okonkwo")?.comments.find((row) => row.id === commentId)?.plain).toBe("Fresh note edited");
    getDb()
      .update(comments)
      .set({ createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString() })
      .where(and(eq(comments.orgId, "org_rivera"), eq(comments.id, commentId)))
      .run();
    expect(() => editComment(maya, commentId, "Too late")).toThrow(/15 minutes/);
    deleteComment(maya, commentId);
    expect(commentThread(maya, "project", "proj_okonkwo")?.comments.some((row) => row.id === commentId)).toBe(false);
    const row = getDb().select().from(comments).where(eq(comments.id, commentId)).get();
    expect(row?.deletedAt).toBeTruthy();
    const audits = getDb().select().from(auditLogs).where(eq(auditLogs.entityId, commentId)).all().map((item) => item.action);
    expect(audits).toEqual(expect.arrayContaining(["comment.create", "comment.edit", "comment.delete"]));
  });

  it("notifies the asker when a vendor answers, and rate-limits posting", () => {
    const maya = actor("maya@rivera.demo");
    answerVendorRfi({ token: DEMO_HARBOR_PORTAL_TOKEN, rfiId: "rfi_ok_valve", body: "Center is 42 inches.", ip: "203.0.113.70" });
    expect(listInbox(maya, "unread").some((row) => row.kind === "answer")).toBe(true);
    const db = getDb();
    for (let index = 0; index < COMMENT_USER_LIMIT; index += 1) {
      db.insert(commentAttempts)
        .values({ id: id("catt"), orgId: "org_rivera", userId: maya.userId, createdAt: new Date().toISOString() })
        .run();
    }
    expect(() => postComment(maya, "project", "proj_okonkwo", "One more")).toThrow(/Wait a few minutes/);
  });
});
