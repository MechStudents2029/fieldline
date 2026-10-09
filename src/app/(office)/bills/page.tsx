import Link from "next/link";
import { redirect } from "next/navigation";
import { BillsBoard } from "@/components/bills-board";
import { ListToolbar } from "@/components/list-toolbar";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { one, pinnedTarget, readQuery } from "@/lib/lists/query";
import { canEditCrm, canManageMoney, canSeeMoney } from "@/lib/permissions";
import { listBills, vendorBillSummaries } from "@/lib/services/bills";
import { payNotes } from "@/lib/services/pay-ready";
import { listContacts, listProjects } from "@/lib/services/read";
import { LIST_FILTERS, listSavedViews, viewHref } from "@/lib/services/saved-views";
import { waiverBadges } from "@/lib/services/waivers";

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return <h1 className="fl-large-title">Bills</h1>;
  }
  const query = await searchParams;
  const keys = LIST_FILTERS.bills ?? [];
  const views = listSavedViews(session, "bills");
  const target = pinnedTarget("/bills", query, views.find((view) => view.pinned) ?? null, keys);
  if (target) redirect(target);
  const filters = readQuery(query, keys);
  const rows = listBills(session.orgId, session.role, {
    projectId: filters.job || undefined,
    vendorContactId: filters.vendor || undefined,
    status: filters.status || undefined,
  }).filter((bill) => {
    const needle = (filters.q || "").toLowerCase();
    return !needle || `${bill.billNumber} ${bill.vendorName} ${bill.projectName}`.toLowerCase().includes(needle);
  });
  const badges = new Map(waiverBadges(session).map((row) => [row.billId, row]));
  const notes = payNotes(session.orgId);
  const waiver = filters.waiver || "";
  const readyOn = filters.ready === "1";
  const listed = rows.filter((bill) => {
    if (waiver && badges.get(bill.id)?.state !== waiver) return false;
    if (readyOn && bill.status !== "approved") return false;
    return true;
  });
  const readyRows = listed.filter((bill) => notes.get(bill.id)?.ready);
  const summaries = vendorBillSummaries(session.orgId, session.role).filter((row) => !filters.vendor || row.contactId === filters.vendor);
  const office = canManageMoney(session.role);
  const jobs = listProjects(session.orgId);
  const vendors = listContacts(session.orgId).filter((contact) => contact.type === "sub" || contact.type === "vendor");
  return (
    <div className="flex flex-col gap-5">
      <div className="hidden md:block">
        <Toolbar
          title="Bills"
          primary={office ? "New bill" : undefined}
          primaryHref={office ? "/bills/new" : undefined}
          search={false}
          trailing={<a href="/api/export/bills">CSV</a>}
        />
      </div>
      <h1 className="fl-large-title md:hidden">Bills</h1>
      {office ? (
        <span className="flex items-center gap-3 md:hidden">
          <Link href="/bills/new" className="mac-primary w-fit">
            New bill
          </Link>
          <a href="/api/export/bills">CSV</a>
        </span>
      ) : (
        <a href="/api/export/bills" className="md:hidden">
          CSV
        </a>
      )}
      <ListToolbar
        path="/bills"
        list="bills"
        search={filters.q || ""}
        query={filters}
        activeId={views.some((view) => view.id === one(query.view)) ? one(query.view) : ""}
        canShare={canEditCrm(session.role)}
        clearHref={Object.keys(filters).length ? "/bills?view=none" : null}
        views={views.map((view) => ({ id: view.id, name: view.name, href: viewHref(view), pinned: view.pinned, mine: view.mine, shared: view.shared }))}
        links={[
          { href: "/bills", label: "All", current: !readyOn },
          { href: "/bills?ready=1", label: "Ready to pay", current: readyOn },
        ]}
        preserve={{ ready: filters.ready || "" }}
        filters={[
          { name: "job", label: "Job", value: filters.job || "", any: "Any", options: jobs.map((row) => ({ value: row.project.id, label: row.project.name })) },
          { name: "vendor", label: "Vendor", value: filters.vendor || "", any: "Any", options: vendors.map((contact) => ({ value: contact.id, label: contact.company || contact.name })) },
          { name: "status", label: "Status", value: filters.status || "", any: "Any", options: [{ value: "draft", label: "Draft" }, { value: "approved", label: "Approved" }, { value: "paid", label: "Paid" }, { value: "void", label: "Void" }, { value: "overdue", label: "Overdue" }, { value: "upcoming", label: "Due soon" }] },
          { name: "waiver", label: "Waiver", value: filters.waiver || "", any: "Any", options: [{ value: "missing", label: "Missing" }, { value: "requested", label: "Requested" }, { value: "signed", label: "Signed" }] },
        ]}
      />
      <nav aria-label="Bill views" className="flex gap-3 px-4 text-sm md:hidden">
        <Link href="/bills" aria-current={readyOn ? undefined : "page"}>
          All
        </Link>
        <Link href="/bills?ready=1" aria-current={readyOn ? "page" : undefined}>
          Ready to pay
        </Link>
      </nav>
      <BillsBoard
        office={office}
        pay={readyOn}
        readyCount={readyRows.length}
        readyCents={readyRows.reduce((sum, bill) => sum + bill.netCents, 0)}
        rows={listed.map((bill) => {
          const badge = badges.get(bill.id);
          const note = notes.get(bill.id);
          return {
            id: bill.id,
            billNumber: bill.billNumber,
            vendorName: bill.vendorName,
            projectName: bill.projectName,
            status: bill.status,
            amountCents: bill.amountCents,
            netCents: bill.netCents,
            timing: bill.timing,
            waiverLabel: badge?.label ?? "Missing",
            waiverRequested: badge?.state === "requested",
            ready: note?.ready ?? false,
            reason: bill.status === "approved" ? (note?.reason ?? null) : null,
          };
        })}
        summaries={summaries}
      />
    </div>
  );
}
