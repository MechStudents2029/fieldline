import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
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
      <h1 className="font-heading text-3xl">Contacts</h1>
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
          why="Clients, subs, and vendors show up here. A contact is created when you add a lead. This company has none yet."
          href="/leads/new"
          action="Add a lead"
        />
      ) : null}
      <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10">
        {rows.map((contact) => (
          <li key={contact.id}>
            <Link href={`/contacts/${contact.id}`} className="flex items-center justify-between px-4 py-3">
              <span>
                <span className="font-medium">{contact.name}</span>
                <span className="block text-xs text-muted-foreground">{contact.company || contact.email || contact.city}</span>
              </span>
              <span className="text-xs uppercase text-muted-foreground">{contact.type}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
