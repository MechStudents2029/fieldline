import Link from "next/link";
import { renameTemplateAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm, canSeeMoney } from "@/lib/permissions";
import { templateDetail } from "@/lib/services/templates";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  let detail: ReturnType<typeof templateDetail> | null = null;
  try {
    detail = templateDetail(session, id);
  } catch {
    detail = null;
  }
  if (!detail) {
    return (
      <div className="px-4 py-6">
        <p>That template is not in your company.</p>
      </div>
    );
  }
  const money = canSeeMoney(session.role);
  const office = canEditCrm(session.role);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <Link href="/templates" className="text-sm text-[var(--fl-accent)]">
        ‹ Templates
      </Link>
      <h1 className="fl-title">{detail.name}</h1>
      <p className="mac-t13 text-[var(--mac-secondary)]">
        {detail.jobType} · v{detail.version}
      </p>
      <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
        <div>
          <dt className="text-[var(--mac-secondary)]">Schedule</dt>
          <dd className="num">{detail.counts.schedule}</dd>
        </div>
        {money ? (
          <div>
            <dt className="text-[var(--mac-secondary)]">Estimate</dt>
            <dd className="num">{detail.counts.estimate}</dd>
          </div>
        ) : null}
        {money ? (
          <div>
            <dt className="text-[var(--mac-secondary)]">Draws</dt>
            <dd className="num">{detail.counts.draws}</dd>
          </div>
        ) : null}
        {money ? (
          <div>
            <dt className="text-[var(--mac-secondary)]">Selections</dt>
            <dd className="num">{detail.counts.selections}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-[var(--mac-secondary)]">Punch</dt>
          <dd className="num">{detail.counts.punch}</dd>
        </div>
        <div>
          <dt className="text-[var(--mac-secondary)]">To-dos</dt>
          <dd className="num">{detail.counts.todos}</dd>
        </div>
      </dl>
      {detail.todos.length ? (
        <ul className="fl-group">
          {detail.todos.map((todo) => (
            <li key={todo.title} className="fl-cell">
              <span className="flex-1">{todo.title}</span>
              <span className="num">{todo.checks.length}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="fl-group">
        {detail.tasks.map((task) => (
          <li key={task.key} className="fl-cell">
            <span className="min-w-0 flex-1">
              <span className="fl-body block">{task.title}</span>
              <span className="fl-footnote text-[var(--mac-secondary)]">
                Day {task.startOffset} · {task.durationWorkdays}d{task.trade ? ` · ${task.trade}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {office ? (
        <ActionForm action={renameTemplateAction} className="flex flex-col gap-2">
          <input type="hidden" name="templateId" value={detail.id} />
          <label className="text-sm">
            Name
            <input name="name" aria-label="Name" defaultValue={detail.name} required className="field mt-1" />
          </label>
          <label className="text-sm">
            Type
            <input name="jobType" aria-label="Type" defaultValue={detail.jobType} required className="field mt-1" />
          </label>
          <button type="submit" className="mac-primary w-fit">
            Save
          </button>
        </ActionForm>
      ) : null}
      {office ? (
        <Link href={`/templates?new=1`} className="text-sm text-[var(--fl-accent)]">
          New job
        </Link>
      ) : null}
    </div>
  );
}
