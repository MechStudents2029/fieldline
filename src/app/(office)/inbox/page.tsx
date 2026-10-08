import { redirect } from "next/navigation";
import { markAllReadAction, saveNotifyModeAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { InboxList } from "@/components/inbox-list";
import { ListToolbar } from "@/components/list-toolbar";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { one, pinnedTarget, readQuery } from "@/lib/lists/query";
import { canEditCrm } from "@/lib/permissions";
import { LIST_FILTERS, listSavedViews, viewHref } from "@/lib/services/saved-views";
import { inboxUnread, listInbox, notifyPreference } from "@/lib/services/comments";

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const keys = LIST_FILTERS.inbox ?? [];
  const views = listSavedViews(session, "inbox");
  const target = pinnedTarget("/inbox", query, views.find((view) => view.pinned) ?? null, keys);
  if (target) redirect(target);
  const filters = readQuery(query, keys);
  const filter = filters.filter === "mentions" || filters.filter === "all" ? filters.filter : "unread";
  const items = listInbox(session, filter);
  const unread = inboxUnread(session);
  const mode = notifyPreference(session);
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
        <ListToolbar
          path="/inbox"
          list="inbox"
          search=""
          query={filter === "unread" ? {} : { filter }}
          activeId={views.some((view) => view.id === one(query.view)) ? one(query.view) : ""}
          canShare={canEditCrm(session.role)}
          clearHref={filter === "unread" ? null : "/inbox?view=none"}
          views={views.map((view) => ({ id: view.id, name: view.name, href: viewHref(view), pinned: view.pinned, mine: view.mine, shared: view.shared }))}
          filters={[]}
          links={[
            { href: "/inbox?view=none", label: "Unread", current: filter === "unread" },
            { href: "/inbox?filter=mentions", label: "Mentions", current: filter === "mentions" },
            { href: "/inbox?filter=all", label: "All", current: filter === "all" },
          ]}
        />
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
