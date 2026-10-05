export type ChecklistFacts = {
  licenseNumber: string | null;
  priceBookCount: number;
  leadCount: number;
  estimateCount: number;
  sentProposalCount: number;
  stripeTestKey: boolean;
  firstLeadId: string | null;
  firstEstimateId: string | null;
  dismissed: boolean;
};

export type ChecklistStep = {
  id: "license" | "book" | "lead" | "estimate" | "proposal" | "stripe";
  label: string;
  detail: string;
  done: boolean;
  href: string;
  cta: string;
  optional: boolean;
};

export function setupChecklist(facts: ChecklistFacts): ChecklistStep[] {
  const leadHref = facts.firstLeadId ? `/leads/${facts.firstLeadId}` : "/leads/new";
  const estimateHref = facts.firstEstimateId ? `/estimates/${facts.firstEstimateId}` : leadHref;
  return [
    {
      id: "license",
      label: "Company license",
      detail: "Add the license number clients should see. Trade and state are already saved.",
      done: Boolean(facts.licenseNumber?.trim()),
      href: "/settings",
      cta: "Add your license",
      optional: false,
    },
    {
      id: "book",
      label: "Review the price book",
      detail: "Estimates use these unit costs. Starter rows are samples until you edit them.",
      done: facts.priceBookCount > 0,
      href: "/price-book",
      cta: "Open the price book",
      optional: false,
    },
    {
      id: "lead",
      label: "Add your first lead",
      detail: "A lead is the first call or pasted scope. The pipeline stays empty until one exists.",
      done: facts.leadCount > 0,
      href: facts.leadCount > 0 ? leadHref : "/leads/new",
      cta: "Add a lead",
      optional: false,
    },
    {
      id: "estimate",
      label: "Draft your first estimate",
      detail: "Draft pulls quantities from the scope and prices from your price book.",
      done: facts.estimateCount > 0,
      href: estimateHref,
      cta: facts.firstEstimateId ? "Open the estimate" : facts.firstLeadId ? "Draft an estimate" : "Add a lead",
      optional: false,
    },
    {
      id: "proposal",
      label: "Send a test proposal to yourself",
      detail: "Send proposal is a button on the estimate. Nothing sends on its own.",
      done: facts.sentProposalCount > 0,
      href: estimateHref,
      cta: facts.firstEstimateId ? "Open the estimate" : facts.firstLeadId ? "Draft an estimate" : "Add a lead",
      optional: false,
    },
    {
      id: "stripe",
      label: "Stripe test keys",
      detail: "Optional. An sk_test_ key turns on test charges. Live keys are refused. This note does not charge anyone.",
      done: facts.stripeTestKey,
      href: "/settings",
      cta: "Review connections",
      optional: true,
    },
  ];
}

export function requiredChecklistRemaining(steps: ChecklistStep[]): number {
  return steps.filter((step) => !step.optional && !step.done).length;
}
