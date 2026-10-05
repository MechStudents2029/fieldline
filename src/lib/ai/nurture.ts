/** A viewed proposal gets a draft the next day. One that was never opened waits three days. */
export const VIEWED_NUDGE_MS = 86_400_000;
export const UNOPENED_NUDGE_MS = 3 * 86_400_000;
/** After the first nudge was approved and sent, the office gets a call task. No second client email. */
export const VIEWED_CALL_MS = 4 * 86_400_000;
export const UNOPENED_CALL_MS = 7 * 86_400_000;

export function needsProposalNudge(
  status: string,
  sentAt: string | null,
  now = Date.now(),
  viewedAt: string | null = null,
): boolean {
  if (status !== "sent" && status !== "viewed") return false;
  if (status === "viewed") {
    const anchor = viewedAt || sentAt;
    if (!anchor) return false;
    return now - new Date(anchor).getTime() >= VIEWED_NUDGE_MS;
  }
  if (!sentAt) return false;
  return now - new Date(sentAt).getTime() >= UNOPENED_NUDGE_MS;
}

export function needsOfficeFollowUpCall(
  status: string,
  sentAt: string | null,
  viewedAt: string | null,
  nudgeSent: boolean,
  now = Date.now(),
): boolean {
  if (!nudgeSent) return false;
  if (status !== "sent" && status !== "viewed") return false;
  if (status === "viewed") {
    const anchor = viewedAt || sentAt;
    if (!anchor) return false;
    return now - new Date(anchor).getTime() >= VIEWED_CALL_MS;
  }
  if (!sentAt) return false;
  return now - new Date(sentAt).getTime() >= UNOPENED_CALL_MS;
}

export function needsStaleLead(
  status: string,
  stageKind: string,
  updatedAt: string,
  now = Date.now(),
): boolean {
  if (status !== "open") return false;
  if (stageKind === "won" || stageKind === "lost") return false;
  return now - new Date(updatedAt).getTime() >= 5 * 86_400_000;
}

export function proposalNudgeCopy(input: {
  firstName: string;
  jobTitle: string;
  company: string;
  days: number;
  opened: boolean;
}): { subject: string; body: string } {
  if (input.opened) {
    return {
      subject: `${input.jobTitle} — you opened the proposal`,
      body: `Hi ${input.firstName},

You opened the ${input.jobTitle} proposal${input.days > 0 ? ` ${input.days} days ago` : ""} and it is still unsigned. The price and schedule stay the ones in that link. Reply with a line to change and I will send a revised proposal.

${input.company}`,
    };
  }
  return {
    subject: `${input.jobTitle} — proposal not opened yet`,
    body: `Hi ${input.firstName},

I sent the ${input.jobTitle} proposal${input.days > 0 ? ` ${input.days} days ago` : ""} and it has not been opened. The price and schedule stay the ones in that link. If you want a change, reply and I will send a revision.

${input.company}`,
  };
}

export function staleLeadCopy(input: {
  firstName: string;
  jobTitle: string;
  company: string;
}): { subject: string; body: string } {
  return {
    subject: `Checking in on ${input.jobTitle}`,
    body: `Hi ${input.firstName},

I have not heard back on ${input.jobTitle}. If the project is still on, I can hold a site visit this week. If you went another direction, a one-line reply is plenty and I will close the file.

${input.company}`,
  };
}

export function unsignedProposalTaskTitle(jobTitle: string): string {
  return `Call about unsigned proposal: ${jobTitle}`;
}
