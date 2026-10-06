import { EmptyState } from "@/components/empty-state";
import { LargeTitle, PlusLink } from "@/components/ios";
import { JobsBrowser, type JobItem } from "@/components/jobs-browser";
import { requireSession } from "@/lib/auth/session";
import { formatPercent, formatWhole } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { listProjects, pipelineBoard } from "@/lib/services/read";

function city(address: string | null | undefined) {
  if (!address) return "";
  const parts = address.split(",").map((part) => part.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? "";
}

function place(address: string | null | undefined, money: string) {
  const where = city(address) || address?.split(",")[0]?.trim() || "";
  const street = address?.split(",")[0]?.trim() || "";
  const bits = [where && where !== street ? `${street}, ${where}` : street || where, money].filter(Boolean);
  return bits.join(" · ");
}

export default async function ProjectsPage() {
  const session = await requireSession();
  const rows = listProjects(session.orgId);
  const money = canSeeMoney(session.role);
  const leads = pipelineBoard(session.orgId).cards.filter((card) => card.stage.kind === "open");
  const job = (row: (typeof rows)[number]): JobItem => ({
    href: `/projects/${row.project.id}`,
    title: row.project.name,
    subtitle: place(row.project.address, money ? formatWhole(row.project.contractValueCents) : ""),
    trailing: money && row.marginBps != null ? formatPercent(row.marginBps) : "",
    tone: row.alert ? "late" : undefined,
  });
  const leadItem = (card: (typeof leads)[number], pill: string): JobItem => ({
    href: `/leads/${card.lead.id}`,
    title: card.lead.title,
    subtitle: money && card.lead.valueEstCents ? formatWhole(card.lead.valueEstCents) : card.contact.name,
    trailing: "",
    pill,
  });
  const inProgress = rows.filter((row) => row.project.status === "active").map(job);
  const completed = rows.filter((row) => row.project.status === "complete").map(job);
  const upNext = leads.filter((card) => card.stage.name === "Estimate sent" || card.stage.name === "Negotiation").map((card) => leadItem(card, "Sent"));
  const estimating = leads
    .filter((card) => card.stage.name !== "Estimate sent" && card.stage.name !== "Negotiation")
    .map((card) => leadItem(card, "Draft"));
  const empty = inProgress.length === 0 && completed.length === 0 && upNext.length === 0 && estimating.length === 0;
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-7">
      <LargeTitle title="Jobs" action={<PlusLink href="/leads/new" label="Add a lead" />} />
      {empty ? (
        <EmptyState title="No jobs yet" why="Signed proposals become jobs." href="/leads/new" action="Add a lead" />
      ) : (
        <JobsBrowser inProgress={inProgress} upNext={upNext} estimating={estimating} completed={completed} />
      )}
    </div>
  );
}
