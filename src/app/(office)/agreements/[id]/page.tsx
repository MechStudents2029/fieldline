import { Fragment } from "react";
import Link from "next/link";
import {
  acceptAgreementAction,
  addVisitsAction,
  assignVisitAction,
  cancelAgreementAction,
  completeVisitAction,
  linkVisitAction,
  moveVisitAction,
  renewAgreementAction,
  skipVisitAction,
} from "@/app/(office)/agreements/actions";
import { ActionForm } from "@/components/action-form";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { formatMoney, formatQty } from "@/lib/money";
import { canAddFieldNotes, canEditSchedule, canManageMoney, canSeeMoney } from "@/lib/permissions";
import { agreementDetail } from "@/lib/services/agreements";
import { ServiceError } from "@/lib/services/errors";

function visitLabel(status: string) {
  if (status === "completed") return "Completed";
  if (status === "skipped") return "Skipped";
  return "Scheduled";
}

export default async function AgreementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  let detail: ReturnType<typeof agreementDetail>;
  try {
    detail = agreementDetail(session, id);
  } catch (error) {
    if (error instanceof ServiceError) return <MissingRecord orgName={session.orgName} kind="agreement" />;
    throw error;
  }
  const money = canSeeMoney(session.role);
  const office = canManageMoney(session.role);
  const schedule = canEditSchedule(session.role);
  const field = canAddFieldNotes(session.role);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link href="/agreements">Agreements</Link>
            {detail.parentId ? (
              <>
                {" · "}
                <Link href={`/agreements/${detail.parentId}`}>{detail.parentName}</Link>
              </>
            ) : null}
          </p>
          <h1 className="font-heading text-3xl">{detail.name}</h1>
        </div>
        <span className="fl-pill">{detail.statusLabel}</span>
      </div>
      <p className="text-sm">
        <Link href={`/contacts/${detail.contactId}`}>{detail.client}</Link>
        {detail.projectId ? (
          <>
            {" · "}
            <Link href={`/projects/${detail.projectId}`}>{detail.job}</Link>
          </>
        ) : null}
        {` · ${formatDate(detail.startOn)}`}
        {detail.endOn ? ` – ${formatDate(detail.endOn)}` : ""}
        {money ? ` · ${formatMoney(detail.monthlyCents)} / mo` : ""}
      </p>
      {detail.notes ? <p className="text-sm">{detail.notes}</p> : null}
      {detail.acceptedName ? <p className="text-sm">{detail.acceptedName}</p> : null}
      <div className="flex flex-wrap gap-2">
        {office && detail.storedStatus === "draft" ? (
          <ActionForm action={acceptAgreementAction.bind(null, detail.id)}>
            <button type="submit" className="ctl">
              Accept
            </button>
          </ActionForm>
        ) : null}
        {office && (detail.storedStatus === "active" || detail.storedStatus === "pending_renewal") ? (
          <ActionForm action={renewAgreementAction.bind(null, detail.id)}>
            <button type="submit" className="ctl">
              Renew
            </button>
          </ActionForm>
        ) : null}
        {office && detail.storedStatus !== "cancelled" && detail.storedStatus !== "renewed" ? (
          <ActionForm action={cancelAgreementAction.bind(null, detail.id)}>
            <button type="submit" className="ctl">
              Cancel
            </button>
          </ActionForm>
        ) : null}
        {detail.childId ? <Link href={`/agreements/${detail.childId}`}>Renewal</Link> : null}
      </div>
      <table className="mac-table" aria-label="Included services">
        <thead>
          <tr>
            <th>Code</th>
            <th>Service</th>
            <th className="text-right">Qty</th>
            {money ? <th className="text-right">Amount</th> : null}
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((line) => (
            <tr key={line.id}>
              <td className="num">{line.code}</td>
              <td>{line.name}</td>
              <td className="num text-right">{formatQty(line.qtyMilli)}</td>
              {money ? <td className="num text-right">{formatMoney(line.amountCents)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      {detail.cadence === "as_needed" && schedule && (detail.storedStatus === "active" || detail.storedStatus === "pending_renewal") ? (
        <ActionForm action={addVisitsAction.bind(null, detail.id)} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            First date
            <input name="startOn" aria-label="First date" type="date" required className="field mt-1" />
          </label>
          <label className="text-sm">
            Count
            <input name="count" aria-label="Count" type="number" min={1} max={60} defaultValue={4} className="field mt-1" />
          </label>
          <label className="text-sm">
            Gap
            <input name="gapDays" aria-label="Gap" type="number" min={1} defaultValue={1} className="field mt-1" />
          </label>
          <button type="submit" className="ctl">
            Add visits
          </button>
        </ActionForm>
      ) : null}
      <div className="overflow-x-auto">
        <table className="mac-table" aria-label="Visits">
          <thead>
            <tr>
              <th>Due</th>
              <th>Status</th>
              <th>Crew</th>
              {money ? <th>Invoice</th> : null}
            </tr>
          </thead>
          <tbody>
            {detail.visits.length === 0 ? (
              <tr>
                <td colSpan={money ? 4 : 3}>No visits</td>
              </tr>
            ) : null}
            {detail.visits.map((visit) => (
              <Fragment key={visit.id}>
                <tr>
                  <td className="num">{formatDate(visit.dueOn)}</td>
                  <td>
                    <span className="fl-pill">{visitLabel(visit.status)}</span>
                    {visit.skipReason ? <span className="ml-2 text-sm">{visit.skipReason}</span> : null}
                  </td>
                  <td>{visit.assignee || "—"}</td>
                  {money ? <td className="num">{visit.invoiceNumber ? `Draft ${visit.invoiceNumber}` : "—"}</td> : null}
                </tr>
                {visit.status === "scheduled" ? (
                  <tr>
                    <td colSpan={money ? 4 : 3}>
                      <div className="flex flex-col gap-3 py-2">
                        {field ? (
                          <ActionForm action={completeVisitAction.bind(null, detail.id, visit.id)} className="flex flex-col gap-2">
                            {visit.checks.map((check) => (
                              <label key={check.id} className="flex items-center gap-2 text-sm">
                                <input type="checkbox" name="check" value={check.id} defaultChecked={check.done} />
                                {check.label}
                              </label>
                            ))}
                            <button type="submit" className="ctl w-full sm:w-auto">
                              Complete
                            </button>
                          </ActionForm>
                        ) : null}
                        {field ? (
                          <ActionForm action={skipVisitAction.bind(null, detail.id, visit.id)} className="flex flex-wrap items-end gap-2">
                            <label className="text-sm">
                              Reason
                              <input name="reason" aria-label="Reason" className="field mt-1" />
                            </label>
                            <button type="submit" className="ctl">
                              Skip
                            </button>
                          </ActionForm>
                        ) : null}
                        {schedule ? (
                          <ActionForm action={moveVisitAction.bind(null, detail.id, visit.id)} className="flex flex-wrap items-end gap-2">
                            <label className="text-sm">
                              Move
                              <input name="dueOn" aria-label="Move" type="date" required className="field mt-1" defaultValue={visit.dueOn} />
                            </label>
                            <button type="submit" className="ctl">
                              Move
                            </button>
                          </ActionForm>
                        ) : null}
                        {schedule ? (
                          <ActionForm action={assignVisitAction.bind(null, detail.id, visit.id)} className="flex flex-wrap items-end gap-2">
                            <label className="text-sm">
                              Assign
                              <select name="userId" aria-label="Assign" className="field mt-1" defaultValue={visit.assigneeUserId ?? ""}>
                                <option value="">Unassigned</option>
                                {detail.people.map((person) => (
                                  <option key={person.userId} value={person.userId}>
                                    {person.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button type="submit" className="ctl">
                              Assign
                            </button>
                          </ActionForm>
                        ) : null}
                        {office ? (
                          <ActionForm action={linkVisitAction.bind(null, detail.id, visit.id)} className="flex flex-wrap items-end gap-2">
                            <label className="text-sm">
                              Job
                              <select name="projectId" aria-label="Link job" className="field mt-1" defaultValue={visit.projectId ?? ""}>
                                <option value="">Job</option>
                                {detail.jobs.map((job) => (
                                  <option key={job.id} value={job.id}>
                                    {job.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button type="submit" className="ctl">
                              Link
                            </button>
                          </ActionForm>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
