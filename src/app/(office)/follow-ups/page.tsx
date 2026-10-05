import { approveDraftAction, dismissDraftAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { listDrafts } from "@/lib/services/read";
import { scanFollowUps } from "@/lib/services/write";

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  const session = await requireSession();
  if (session.role === "field") {
    return (
      <div>
        <h1 className="font-heading text-3xl">Follow-ups</h1>
        <p className="mt-2 text-sm text-muted-foreground">Follow-ups stay with the office. Your jobs are under Jobs.</p>
      </div>
    );
  }
  scanFollowUps(session.orgId);
  const drafts = listDrafts(session.orgId);
  const pending = drafts.filter((draft) => draft.status === "pending");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-3xl">Follow-ups</h1>
        <p className="text-sm text-muted-foreground">
          Drafts wait here until someone approves them. Nothing sends on its own. SMS stays off until Twilio 10DLC is approved.
        </p>
      </div>
      {sent === "stub" ? (
        <p role="status" className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          Sent to the local outbox. Add a Resend key to deliver it.
        </p>
      ) : null}
      {sent === "1" ? (
        <p role="status" className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          Sent.
        </p>
      ) : null}
      {pending.length === 0 ? (
        <EmptyState
          title="No follow-ups waiting"
          why="Drafts show up here after a proposal sits unopened or a lead goes quiet. A viewed proposal is drafted after 1 day, an unopened one after 3 days, and a quiet lead after 5 days. Nothing sends until you approve it. This company has no drafts yet."
          href="/leads/new"
          action="Add a lead"
        />
      ) : null}
      {pending.map((draft) => (
        <article key={draft.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-xs uppercase text-muted-foreground">{draft.kind.replaceAll("_", " ")}</p>
          <h2 className="font-medium">{draft.subject}</h2>
          <ActionForm action={approveDraftAction.bind(null, draft.id)} className="mt-2 flex flex-col gap-2">
            <textarea name="body" defaultValue={draft.body} rows={8} className="w-full rounded-lg border border-input bg-background p-3 text-sm" />
            <div className="flex gap-2">
              <Button type="submit" className="h-11">
                Approve and send
              </Button>
            </div>
          </ActionForm>
          <ActionForm action={dismissDraftAction.bind(null, draft.id)} className="mt-2">
            <button type="submit" className="text-xs text-muted-foreground underline">
              Dismiss
            </button>
          </ActionForm>
        </article>
      ))}
    </div>
  );
}
