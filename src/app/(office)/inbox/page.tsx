import Link from "next/link";
import { markAllReadAction, saveNotifyModeAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { InboxList } from "@/components/inbox-list";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { inboxUnread, listInbox, notifyPreference } from "@/lib/services/comments";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const session = await requireSession();
  const query = await searchParams;
  const filter = query.filter === "mentions" || query.filter === "all" ? query.filter : "unread";
  const items = listInbox(session, filter);
  const unread = inboxUnread(session);
  const mode = notifyPreference(session);
  const tab = (href: string, label: string, current: boolean) => (
    <Link href={href} aria-current={current ? "page" : undefined} className={current ? "font-semibold" : "text-[var(--mac-secondary)]"}>
      {label}
    </Link>
  );
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar
          title="Inbox"
          subtitle={`${unread} unread`}
          search={false}
          trailing={
            <ActionForm action={markAllReadAction}>
              <button type="submit" className="mac-glass-btn">
                Mark all read
              </button>
            </ActionForm>
          }
        />
      </div>
      <div className="flex flex-col gap-3 px-4 py-4 md:px-0 md:py-0">
        <div className="flex items-center justify-between md:hidden">
          <h1 className="fl-large-title">Inbox</h1>
          <ActionForm action={markAllReadAction}>
            <button type="submit" className="text-sm text-[var(--fl-accent)]">
              Mark all read
            </button>
          </ActionForm>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 mac-t13">
          {tab("/inbox", "Unread", filter === "unread")}
          {tab("/inbox?filter=mentions", "Mentions", filter === "mentions")}
          {tab("/inbox?filter=all", "All", filter === "all")}
        </div>
        <InboxList items={items} />
        <ActionForm action={saveNotifyModeAction} className="flex items-center gap-2 px-4 pb-4">
          <label className="mac-t13 text-[var(--mac-secondary)]">
            Notify
            <select name="mode" aria-label="Notify" defaultValue={mode} className="field ml-2">
              <option value="mentions">Mentions</option>
              <option value="all">My jobs</option>
            </select>
          </label>
          <button type="submit" className="mac-glass-btn">
            Save
          </button>
        </ActionForm>
      </div>
    </div>
  );
}
