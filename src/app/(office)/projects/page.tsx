import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { LargeTitle, PlusLink } from "@/components/ios";
import { JobsBrowser, type JobItem } from "@/components/jobs-browser";
import { ListToolbar } from "@/components/list-toolbar";
import { DataTable, type TableRow } from "@/components/mac/data-table";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { one, pinnedTarget, readQuery } from "@/lib/lists/query";
import { formatPercent, formatWhole } from "@/lib/money";
import { canEditCrm, canSeeMoney } from "@/lib/permissions";
import { LIST_FILTERS, listSavedViews, viewHref } from "@/lib/services/saved-views";
import { billingForProjects } from "@/lib/services/draws";
import { listContacts, listProjects, pipelineBoard } from "@/lib/services/read";
import { timeBoard } from "@/lib/services/time";

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

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const session = await requireSession();
  const keys = LIST_FILTERS.jobs ?? [];
  const views = listSavedViews(session, "jobs");
  const target = pinnedTarget("/projects", query, views.find((view) => view.pinned) ?? null, keys);
  if (target) redirect(target);
  const filters = readQuery(query, keys);
  const rows = listProjects(session.orgId);
  const money = canSeeMoney(session.role);
  const billed = money ? billingForProjects(session.orgId) : new Map<string, { billedBps: number }>();
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
  const needle = (filters.q || "").toLowerCase();
  const match = (items: JobItem[]) => items.filter((item) => !needle || item.title.toLowerCase().includes(needle));
  const group = filters.group || "";
  const show = (key: string, items: JobItem[]) => (!group || group === key ? match(items) : []);
  const progressRows = show("active", inProgress);
  const nextRows = show("next", upNext);
  const estimateRows = show("estimating", estimating);
  const doneRows = show("complete", completed);
  const empty = progressRows.length === 0 && doneRows.length === 0 && nextRows.length === 0 && estimateRows.length === 0;
  const jobsToolbar = (
    <ListToolbar
      path="/projects"
      list="jobs"
      search={filters.q || ""}
      query={filters}
      activeId={views.some((view) => view.id === one(query.view)) ? one(query.view) : ""}
      canShare={canEditCrm(session.role)}
      clearHref={filters.q || filters.group ? "/projects?view=none" : null}
      views={views.map((view) => ({ id: view.id, name: view.name, href: viewHref(view), pinned: view.pinned, mine: view.mine, shared: view.shared }))}
      filters={[{ name: "group", label: "Group", value: group, any: "All", options: [{ value: "active", label: "In progress" }, { value: "next", label: "Up next" }, { value: "estimating", label: "Estimating" }, { value: "complete", label: "Completed" }] }]}
    />
  );
  const names = new Map(listContacts(session.orgId).map((contact) => [contact.id, contact.name]));
  const onSite = new Map<string, string[]>();
  for (const person of timeBoard(session).office?.clockedIn ?? []) {
    const list = onSite.get(person.projectName) ?? [];
    list.push(person.name);
    onSite.set(person.projectName, list);
  }
  const cell = (text: string, sort?: string | number, tone?: "late" | "pill"): TableRow["cells"][string] => ({ text, sort: sort ?? text, tone });
  const projectRow = (row: (typeof rows)[number], status: string): TableRow => ({
    id: row.project.id,
    href: `/projects/${row.project.id}`,
    hint: row.project.address?.split(",")[0]?.trim(),
    cells: {
      job: cell(row.project.name),
      client: cell(names.get(row.project.contactId) || ""),
      city: cell(city(row.project.address)),
      status: cell(status),
      contract: cell(money ? formatWhole(row.project.contractValueCents) : "—", row.project.contractValueCents),
      spent: cell(money ? formatWhole(row.actualCents) : "—", row.actualCents),
      margin: cell(money && row.marginBps != null ? formatPercent(row.marginBps) : "—", row.marginBps ?? -1, row.alert ? "late" : undefined),
      billed: cell(money ? formatPercent(billed.get(row.project.id)?.billedBps ?? 0) : "—", billed.get(row.project.id)?.billedBps ?? -1),
      start: cell(formatCalendarDay(row.project.startDate), row.project.startDate || ""),
      crew: cell(onSite.get(row.project.name)?.join(", ") || "—"),
    },
  });
  const leadRow = (card: (typeof leads)[number], status: string, tone?: "pill"): TableRow => ({
    id: card.lead.id,
    href: `/leads/${card.lead.id}`,
    cells: {
      job: cell(card.lead.title),
      client: cell(card.contact.name),
      city: cell(city(card.contact.city ? card.contact.city : null)),
      status: cell(status, status, tone),
      contract: cell(money && card.lead.valueEstCents ? formatWhole(card.lead.valueEstCents) : "—", card.lead.valueEstCents ?? 0),
      spent: cell("—", 0),
      margin: cell("—", -1),
      billed: cell("—", -1),
      start: cell("—", ""),
      crew: cell("—"),
    },
  });
  const columns = [
    { key: "job", header: "Job", clip: true },
    { key: "client", header: "Client" },
    { key: "city", header: "City" },
    { key: "status", header: "Status" },
    { key: "contract", header: "Contract", align: "right" as const },
    { key: "spent", header: "Spent", align: "right" as const },
    { key: "margin", header: "Margin", align: "right" as const },
    { key: "billed", header: "Billed", align: "right" as const },
    { key: "start", header: "Start", fit: true },
    { key: "crew", header: "Crew" },
  ];
  const contractTotal = rows.reduce((sum, row) => sum + row.project.contractValueCents, 0);
  const spentTotal = rows.reduce((sum, row) => sum + row.actualCents, 0);
  return (
    <>
    <div className="mx-auto flex max-w-lg flex-col gap-7 md:hidden">
      <LargeTitle title="Jobs" action={<PlusLink href="/leads/new" label="Add a lead" />} />
      {jobsToolbar}
      {empty ? (
        <EmptyState title="No jobs yet" why="Signed proposals become jobs." href="/leads/new" action="Add a lead" />
      ) : (
        <JobsBrowser inProgress={progressRows} upNext={nextRows} estimating={estimateRows} completed={doneRows} />
      )}
    </div>
    <div className="hidden min-h-0 flex-1 flex-col md:flex">
      <Toolbar title="Jobs" subtitle={`${rows.filter((row) => row.project.status === "active").length} active`} primary="New lead" primaryHref="/leads/new" />
      {jobsToolbar}
      {empty ? (
        <EmptyState title="No jobs yet" why="Signed proposals become jobs." href="/leads/new" action="Add a lead" />
      ) : (
        <DataTable
          columns={columns}
          groups={[
            { label: "In progress", rows: (!group || group === "active" ? rows.filter((row) => row.project.status === "active" && (!needle || row.project.name.toLowerCase().includes(needle))) : []).map((row) => projectRow(row, "Active")) },
            { label: "Up next", rows: (!group || group === "next" ? leads.filter((card) => (card.stage.name === "Estimate sent" || card.stage.name === "Negotiation") && (!needle || card.lead.title.toLowerCase().includes(needle))) : []).map((card) => leadRow(card, card.stage.name === "Negotiation" ? "Deposit due" : "Sent", "pill")) },
            { label: "Estimating", rows: (!group || group === "estimating" ? leads.filter((card) => card.stage.name !== "Estimate sent" && card.stage.name !== "Negotiation" && (!needle || card.lead.title.toLowerCase().includes(needle))) : []).map((card) => leadRow(card, "Draft", "pill")) },
            { label: "Completed", rows: (!group || group === "complete" ? rows.filter((row) => row.project.status === "complete" && (!needle || row.project.name.toLowerCase().includes(needle))) : []).map((row) => projectRow(row, "Paid")) },
          ]}
          status={`${rows.length + leads.length} jobs · Contract ${money ? formatWhole(contractTotal) : ""} · Spent ${money ? formatWhole(spentTotal) : ""}`}
        />
      )}
    </div>
    </>
  );
}
