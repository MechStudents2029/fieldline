export function needsProposalNudge(
  status: string,
  sentAt: string | null,
  now = Date.now(),
): boolean {
  if (!sentAt) return false;
  if (status !== "sent" && status !== "viewed") return false;
  return now - new Date(sentAt).getTime() >= 3 * 86_400_000;
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
}): { subject: string; body: string } {
  return {
    subject: `${input.jobTitle} — still holding your start window`,
    body: `Hi ${input.firstName},

You opened the ${input.jobTitle} proposal${input.days > 0 ? ` ${input.days} days ago` : ""}. The numbers are still the ones in that link. If the scope still matches the house, the deposit is what gets you on the calendar.

Reply with any line you want changed and I will send a revised proposal rather than a verbal allowance.

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
