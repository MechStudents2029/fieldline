export type ChecklistFacts = {
  licenseNumber: string | null;
  priceBookCount: number;
  leadCount: number;
  estimateCount: number;
  sentProposalCount: number;
  stripeTestKey: boolean;
  teamInvited: boolean;
  firstLeadId: string | null;
  firstEstimateId: string | null;
  dismissed: boolean;
};

export type ChecklistStep = {
  id: "license" | "book" | "lead" | "estimate" | "proposal" | "team" | "stripe";
  label: string;
  done: boolean;
  href: string;
  optional: boolean;
};

export function setupChecklist(facts: ChecklistFacts): ChecklistStep[] {
  const leadHref = facts.firstLeadId ? `/leads/${facts.firstLeadId}` : "/leads/new";
  const estimateHref = facts.firstEstimateId ? `/estimates/${facts.firstEstimateId}` : leadHref;
  return [
    {
      id: "license",
      label: "Company license",
      done: Boolean(facts.licenseNumber?.trim()),
      href: "/settings",
      optional: false,
    },
    {
      id: "book",
      label: "Price book",
      done: facts.priceBookCount > 0,
      href: "/price-book",
      optional: false,
    },
    {
      id: "lead",
      label: "First lead",
      done: facts.leadCount > 0,
      href: facts.leadCount > 0 ? leadHref : "/leads/new",
      optional: false,
    },
    {
      id: "estimate",
      label: "First estimate",
      done: facts.estimateCount > 0,
      href: estimateHref,
      optional: false,
    },
    {
      id: "proposal",
      label: "Test proposal",
      done: facts.sentProposalCount > 0,
      href: estimateHref,
      optional: false,
    },
    {
      id: "team",
      label: "Invite your team",
      done: facts.teamInvited,
      href: "/settings",
      optional: true,
    },
    {
      id: "stripe",
      label: "Stripe test keys",
      done: facts.stripeTestKey,
      href: "/settings",
      optional: true,
    },
  ];
}

export function requiredChecklistRemaining(steps: ChecklistStep[]): number {
  return steps.filter((step) => !step.optional && !step.done).length;
}
