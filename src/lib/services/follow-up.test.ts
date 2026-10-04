import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { needsOfficeFollowUpCall, proposalNudgeCopy } from "@/lib/ai/nurture";
import { getDb, useDatabaseFile } from "@/lib/db/client";
import { followUpDrafts, proposals, tasks } from "@/lib/db/schema";
import { daysAgo, nowIso } from "@/lib/ids";
import { authenticate, listDrafts } from "@/lib/services/read";
import {
  approveDraft,
  createLeadFromText,
  declineProposal,
  generateEstimate,
  moveLead,
  scanFollowUps,
  sendProposal,
  signProposal,
} from "@/lib/services/write";

beforeAll(() => {
  useDatabaseFile(":memory:");
});

function draftStatus(id: string) {
  return getDb().select().from(followUpDrafts).where(eq(followUpDrafts.id, id)).get()?.status;
}

function insertDraft(input: { id: string; leadId: string; proposalId: string | null; kind: string; status?: string }) {
  const now = nowIso();
  getDb()
    .insert(followUpDrafts)
    .values({
      id: input.id,
      orgId: "org_rivera",
      contactId: null,
      leadId: input.leadId,
      proposalId: input.proposalId,
      kind: input.kind,
      status: input.status ?? "pending",
      subject: "Draft",
      body: "Still the proposal in the link.",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

describe("follow-up copy and call task", () => {
  it("writes a viewed draft differently from one that was never opened", () => {
    const viewed = proposalNudgeCopy({ firstName: "Tom", jobTitle: "Briggs deck stain", company: "Rivera", days: 2, opened: true });
    const unopened = proposalNudgeCopy({ firstName: "Tom", jobTitle: "Briggs deck stain", company: "Rivera", days: 4, opened: false });
    expect(viewed.body).toMatch(/opened/i);
    expect(unopened.body).toMatch(/not been opened/);
    expect(viewed.body).not.toMatch(/\$\d/);
    expect(unopened.subject).not.toBe(viewed.subject);
    const eightDays = daysAgo(8);
    expect(needsOfficeFollowUpCall("sent", eightDays, null, false)).toBe(false);
    expect(needsOfficeFollowUpCall("sent", eightDays, null, true)).toBe(true);
    expect(needsOfficeFollowUpCall("viewed", daysAgo(2), daysAgo(2), true)).toBe(false);
    expect(needsOfficeFollowUpCall("signed", eightDays, eightDays, true)).toBe(false);
  });
});

describe("follow-up stop rules", () => {
  it("clears pending drafts when the proposal is signed, declined, or the deal is lost", async () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    insertDraft({ id: "draft_sign_stale", leadId: "lead_briggs", proposalId: null, kind: "stale_lead" });
    expect(listDrafts("org_rivera").some((draft) => draft.id === "draft_briggs" && draft.status === "pending")).toBe(true);
    signProposal({ token: "demo_proposal_briggs", signerName: "Tom Briggs", typedName: "Tom Briggs", consent: true });
    expect(draftStatus("draft_briggs")).toBe("dismissed");
    expect(draftStatus("draft_sign_stale")).toBe("dismissed");

    const declined = createLeadFromText(maya, "Ruth Feldman, paint the hall. $3k.");
    const estimate = await generateEstimate(maya, declined.leadId);
    const sent = await sendProposal(maya, estimate.estimateId, true);
    insertDraft({ id: "draft_decline_prop", leadId: declined.leadId, proposalId: sent.proposalId, kind: "proposal_unsigned" });
    insertDraft({ id: "draft_decline_stale", leadId: declined.leadId, proposalId: null, kind: "stale_lead" });
    declineProposal(sent.publicToken, "Going another direction");
    expect(draftStatus("draft_decline_prop")).toBe("dismissed");
    expect(draftStatus("draft_decline_stale")).toBe("dismissed");

    const lost = createLeadFromText(maya, "Omar Haddad, replace a vanity. $8k.");
    insertDraft({ id: "draft_lost_prop", leadId: lost.leadId, proposalId: "prop_missing", kind: "proposal_unsigned" });
    insertDraft({ id: "draft_lost_stale", leadId: lost.leadId, proposalId: null, kind: "stale_lead" });
    moveLead(maya, lost.leadId, "stage_lost");
    expect(draftStatus("draft_lost_prop")).toBe("dismissed");
    expect(draftStatus("draft_lost_stale")).toBe("dismissed");
  });

  it("does not email twice, and a scan drops a draft after the proposal is signed", async () => {
    const maya = authenticate("maya@rivera.demo", "demo")!;
    const created = createLeadFromText(maya, "Helen Cho helen.cho@example.com, paint one bedroom, 120 sq ft. $40k.");
    const estimate = await generateEstimate(maya, created.leadId);
    const sent = await sendProposal(maya, estimate.estimateId, true);
    getDb()
      .update(proposals)
      .set({ status: "sent", sentAt: daysAgo(2), viewedAt: null })
      .where(eq(proposals.id, sent.proposalId))
      .run();
    scanFollowUps("org_rivera");
    expect(getDb().select().from(followUpDrafts).where(eq(followUpDrafts.proposalId, sent.proposalId)).all()).toHaveLength(0);

    getDb().update(proposals).set({ sentAt: daysAgo(4) }).where(eq(proposals.id, sent.proposalId)).run();
    scanFollowUps("org_rivera");
    const first = getDb().select().from(followUpDrafts).where(eq(followUpDrafts.proposalId, sent.proposalId)).all();
    expect(first).toHaveLength(1);
    expect(first[0]?.status).toBe("pending");
    expect(first[0]?.subject).toMatch(/not opened/);
    scanFollowUps("org_rivera");
    expect(getDb().select().from(followUpDrafts).where(eq(followUpDrafts.proposalId, sent.proposalId)).all()).toHaveLength(1);

    const approved = await approveDraft(maya, first[0]!.id);
    expect(approved.stub).toBe(true);
    getDb().update(proposals).set({ sentAt: daysAgo(8) }).where(eq(proposals.id, sent.proposalId)).run();
    scanFollowUps("org_rivera");
    const afterCall = getDb().select().from(followUpDrafts).where(eq(followUpDrafts.proposalId, sent.proposalId)).all();
    expect(afterCall.filter((draft) => draft.status === "pending")).toHaveLength(0);
    expect(afterCall.filter((draft) => draft.status === "sent")).toHaveLength(1);
    const callTasks = getDb().select().from(tasks).where(eq(tasks.relatedId, sent.proposalId)).all();
    expect(callTasks).toHaveLength(1);
    expect(callTasks[0]?.title).toMatch(/Call about unsigned proposal/);
    scanFollowUps("org_rivera");
    expect(getDb().select().from(tasks).where(eq(tasks.relatedId, sent.proposalId)).all()).toHaveLength(1);

    getDb().update(proposals).set({ status: "signed" }).where(eq(proposals.id, sent.proposalId)).run();
    insertDraft({ id: "draft_late_pending", leadId: created.leadId, proposalId: sent.proposalId, kind: "proposal_unsigned" });
    scanFollowUps("org_rivera");
    expect(draftStatus("draft_late_pending")).toBe("dismissed");
  });
});
