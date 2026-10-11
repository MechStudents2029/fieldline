import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { ListToolbar } from "@/components/list-toolbar";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { one, pinnedTarget, readQuery } from "@/lib/lists/query";
import { canEditCrm, canManageSettings } from "@/lib/permissions";
import { listContacts } from "@/lib/services/read";
import { LIST_FILTERS, listSavedViews, viewHref } from "@/lib/services/saved-views";
import { fieldList } from "@/lib/lists/fields";
import { customFilters } from "@/lib/services/custom-fields";
import { complianceByContact } from "@/lib/services/vendor-portal";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const keys = [...(LIST_FILTERS.contacts ?? []), ...customFilters(session, "client").map((spec) => spec.name), ...customFilters(session, "vendor").map((spec) => spec.name), "cols"];
  const views = listSavedViews(session, "contacts");
  const target = pinnedTarget("/contacts", query, views.find((view) => view.pinned) ?? null, keys);
  if (target) redirect(target);
  const filters = readQuery(query, keys);
  const clients = fieldList(session, "client", "/contacts", filters);
  const vendors = fieldList(session, "vendor", "/contacts", filters);
  const fieldFilters = filters.type === "vendor" || filters.type === "sub" ? vendors.filters : filters.type === "client" ? clients.filters : [...clients.filters, ...vendors.filters];
  const visible = [...clients.visible, ...vendors.visible.filter((column) => !clients.visible.some((item) => item.key === column.key))];
  const rows = listContacts(session.orgId, filters.q, filters.type).filter((contact) => (contact.type === "client" ? clients : vendors).match(contact.id));
  const compliance = complianceByContact(session.orgId);
  const filtered = Boolean(filters.q || filters.type);
  return (
    <div className="flex flex-col gap-4">
      <div className="hidden md:block">
        <Toolbar
          title="Clients"
          search={false}
          trailing={
            canManageSettings(session.role) ? (
              <a href="/import?kind=contacts" className="mac-glass-btn">
                Import
              </a>
            ) : null
          }
        />
      </div>
      <h1 className="font-heading text-3xl md:hidden">Clients</h1>
      {canManageSettings(session.role) ? (
        <a href="/import?kind=contacts" className="mac-t13 text-[var(--mac-accent)] md:hidden">
          Import
        </a>
      ) : null}
      <ListToolbar
        path="/contacts"
        list="contacts"
        search={filters.q || ""}
        query={filters}
        activeId={views.some((view) => view.id === one(query.view)) ? one(query.view) : ""}
        canShare={canEditCrm(session.role)}
        clearHref={filtered ? "/contacts?view=none" : null}
        views={views.map((view) => ({ id: view.id, name: view.name, href: viewHref(view), pinned: view.pinned, mine: view.mine, shared: view.shared }))}
        filters={[{ name: "type", label: "Type", value: filters.type || "", any: "Any", options: [{ value: "client", label: "Clients" }, { value: "sub", label: "Subs" }, { value: "vendor", label: "Vendors" }] }, ...fieldFilters]}
        columns={[...clients.columns, ...vendors.columns.filter((column) => !clients.columns.some((item) => item.id === column.id))]}
        extra={<a className="list-link" href={`/api/export/lists?list=contacts&${new URLSearchParams(filters).toString()}`}>CSV</a>}
      />
      {rows.length === 0 && filtered ? <p className="text-sm text-muted-foreground">No contacts match.</p> : null}
      {rows.length === 0 && !filtered ? (
        <EmptyState
          title="No contacts yet"
          why="No contacts yet."
          href="/leads/new"
          action="Add a lead"
        />
      ) : null}
      <div className="overflow-x-auto md:px-4">
        <table className="mac-table">
          <thead>
            <tr>
              <th className="px-2">Name</th>
              <th className="px-2">Company</th>
              <th className="px-2">Type</th>
              <th className="px-2">Compliance</th>
              {visible.map((column) => (
                <th key={column.key} className="px-2">{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((contact) => (
              <tr key={contact.id}>
                <td className="px-2">
                  <Link href={`/contacts/${contact.id}`} className="font-medium">
                    {contact.name}
                  </Link>
                </td>
                <td className="px-2">{contact.company || contact.email || contact.city}</td>
                <td className="fit px-2" data-fit="status">{contact.type}</td>
                <td className="fit px-2" data-fit="status">
                  {compliance[contact.id] ? (
                    <span className="fl-pill" data-compliance={compliance[contact.id].state}>
                      {compliance[contact.id].label}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                {visible.map((column) => (
                  <td key={column.key} className="px-2">{(contact.type === "client" ? clients : vendors).cell(contact.id, column.key).text}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
