import Link from "next/link";
import { markLienSentAction, saveLienJobAction } from "@/app/(office)/liens/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { formatCalendarDay } from "@/lib/format";
import { LIEN_PILL_LABEL } from "@/lib/liens/deadlines";
import { formatMoney } from "@/lib/money";
import type { LienJobView } from "@/lib/services/liens";

export function LienPanel({ job }: { job: LienJobView }) {
  const prelim = job.deadlines.find((row) => row.kind === "prelim");
  return (
    <section className="mt-6 flex flex-col gap-3">
      <h2 className="fl-section">Liens</h2>
      {job.tracked ? (
        <article data-lien data-status={job.status} data-deadline={prelim?.date || ""} data-open={job.openCents} className="flex flex-col gap-2">
          <p className="num">
            {job.state} · {job.openCents ? formatMoney(job.openCents) : formatMoney(0)}
          </p>
          <ul className="flex flex-col gap-1">
            {job.deadlines.map((row) => (
              <li key={row.kind} data-kind={row.kind} className="flex items-baseline justify-between gap-3">
                <span>
                  {row.label}
                  {row.date ? <span className="num text-[var(--mac-secondary)]"> · {formatCalendarDay(row.date)}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="num">{row.daysLeft ?? "—"}</span>
                  {LIEN_PILL_LABEL[row.status] ? (
                    <span className="fl-pill fl-pill-sm" data-pill={row.status}>
                      {LIEN_PILL_LABEL[row.status]}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="flex gap-3">
            <Link href={`/projects/${job.projectId}/lien/prelim/print`} className="text-[var(--mac-accent)]">
              Preliminary
            </Link>
            <Link href={`/projects/${job.projectId}/lien/intent/print`} className="text-[var(--mac-accent)]">
              Intent
            </Link>
          </p>
          {job.citation ? <p className="mac-t11 text-[var(--mac-secondary)]">{job.citation}</p> : null}
        </article>
      ) : null}
      {job.canEdit ? (
        <ActionForm action={saveLienJobAction.bind(null, job.projectId)} className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            State
            <input name="state" aria-label="Lien state" defaultValue={job.state} maxLength={2} className="field mt-1 uppercase" />
          </label>
          <label className="text-sm">
            Role
            <select name="role" aria-label="Lien role" defaultValue={job.role} className="field mt-1">
              <option value="prime">Prime</option>
              <option value="sub">Sub</option>
              <option value="supplier">Supplier</option>
            </select>
          </label>
          <label className="text-sm">
            First
            <input name="first" aria-label="First furnish" type="date" defaultValue={job.first} className="field mt-1" />
          </label>
          <label className="text-sm">
            Last
            <input name="last" aria-label="Last furnish" type="date" defaultValue={job.last} className="field mt-1" />
          </label>
          <button type="submit" className="ctl h-9 w-fit">
            Save
          </button>
        </ActionForm>
      ) : (
        <p className="num">
          {job.state || "—"} · {job.role} · {job.first || "—"} · {job.last || "—"}
        </p>
      )}
      {job.canEdit && job.tracked
        ? job.deadlines
            .filter((row) => row.kind === "prelim" || row.kind === "intent")
            .map((row) => (
              <ActionForm key={row.kind} action={markLienSentAction.bind(null, job.projectId)} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="kind" value={row.kind} />
                <label className="text-sm">
                  Sent
                  <input name="sentOn" aria-label="Sent" type="date" defaultValue={row.date && row.date < job.today ? row.date : job.today} className="field mt-1" />
                </label>
                <label className="text-sm">
                  Method
                  <select name="method" aria-label="Method" defaultValue="certified" className="field mt-1">
                    <option value="certified">Certified mail</option>
                    <option value="hand">Hand delivery</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <FileButton name="photo" label="Proof" accept="image/*,.pdf" />
                <button type="submit" className="ctl h-9">
                  Mark sent
                </button>
              </ActionForm>
            ))
        : null}
    </section>
  );
}
