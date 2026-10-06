import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Toolbar } from "@/components/mac/toolbar";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { listContacts } from "@/lib/services/read";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const session = await requireSession();
  const query = await searchParams;
  const rows = listContacts(session.orgId, query.q, query.type);
  const filtered = Boolean(query.q?.trim() || query.type);
  return (
    <div className="flex flex-col gap-4">
      <div className="hidden md:block">
        <Toolbar title="Clients" search={false} />
      </div>
      <h1 className="font-heading text-3xl md:hidden">Clients</h1>
      <form className="grid gap-2 sm:grid-cols-[1fr_160px_auto]" aria-label="Search contacts">
        <label className="text-sm">
          Search
          <input name="q" defaultValue={query.q} placeholder="Name, company, or email" className="field mt-1" />
        </label>
        <label className="text-sm">
          Type
          <select name="type" defaultValue={query.type || ""} className="field mt-1">
          <option value="">All types</option>
          <option value="client">Clients</option>
          <option value="sub">Subs</option>
          <option value="vendor">Vendors</option>
          </select>
        </label>
        <Button type="submit" variant="outline" className="h-11 self-end">
          Search
        </Button>
      </form>
      {rows.length === 0 && filtered ? <p className="text-sm text-muted-foreground">No contacts match.</p> : null}
      {rows.length === 0 && !filtered ? (
        <EmptyState
          title="No contacts yet"
          why="No contacts yet."
          href="/leads/new"
          action="Add a lead"
        />
      ) : null}
      <div className="overflow-x-auto">
        <table className="mac-table">
          <thead>
            <tr>
              <th className="px-2">Name</th>
              <th className="px-2">Company</th>
              <th className="px-2">Type</th>
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
                <td className="px-2">{contact.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
