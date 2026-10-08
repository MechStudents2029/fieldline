import { clientReviewSubmittalAction, vendorCreateSubmittalAction, vendorSubmitSubmittalAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { formatCalendarDay } from "@/lib/format";
import type { PortalSubmittal } from "@/lib/services/submittals";

const DECISIONS = [
  { value: "approved", label: "Approved" },
  { value: "noted", label: "Approved as noted" },
  { value: "revise", label: "Revise and resubmit" },
  { value: "rejected", label: "Rejected" },
];

export function SubmittalPortal({
  token,
  items,
  jobs,
  side,
}: {
  token: string;
  items: PortalSubmittal[];
  jobs: { id: string; name: string }[];
  side: "vendor" | "client";
}) {
  const fileQuery = side === "vendor" ? "vendor" : "portal";
  return (
    <section aria-label="Submittals">
      <h2>Submittals</h2>
      {items.length === 0 ? <p className="home-sub">None</p> : null}
      <ul className="home-stack">
        {items.map((item) => (
          <li key={item.id} className="home-card" data-submittal={item.title}>
            <div className="home-row">
              <div>
                <p className="home-copy">
                  {item.label} · {item.title}
                </p>
                <p className="home-sub">
                  {[item.job, item.division, item.dueOn ? formatCalendarDay(item.dueOn) : "", `Rev ${item.revision}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className="home-pill">{item.statusLabel}</span>
            </div>
            <p className="home-copy mt-2">{item.spec}</p>
            {item.revisions.map((revision) => (
              <div key={revision.id} className="mt-2">
                <p className="home-sub">
                  Rev {revision.revision}
                  {revision.note ? ` · ${revision.note}` : ""}
                  {revision.reviewNote ? ` · ${revision.reviewerName}: ${revision.reviewNote}` : ""}
                </p>
                {revision.files.map((file) => (
                  <a key={file.id} className="home-sub block" href={`/api/files/${file.id}?${fileQuery}=${encodeURIComponent(token)}`}>
                    {file.filename}
                  </a>
                ))}
              </div>
            ))}
            {item.canSubmit ? (
              <ActionForm action={vendorSubmitSubmittalAction.bind(null, token, item.id)} className="mt-3 grid gap-2">
                <label className="home-sub">
                  Note
                  <textarea name="note" aria-label={`Note ${item.title}`} rows={2} className="field mt-1" />
                </label>
                <FileButton name="file" label={`File ${item.title}`} accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" multiple empty="File" />
                <button type="submit" className="home-btn">
                  Submit revision
                </button>
              </ActionForm>
            ) : null}
            {item.canReview ? (
              <ActionForm action={clientReviewSubmittalAction.bind(null, token, item.id)} className="mt-3 grid gap-2">
                <label className="home-sub">
                  Review
                  <select name="status" aria-label={`Review ${item.title}`} className="field mt-1" defaultValue="approved">
                    {DECISIONS.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="home-sub">
                  Note
                  <textarea name="note" aria-label={`Review note ${item.title}`} rows={2} className="field mt-1" />
                </label>
                <button type="submit" className="home-btn">
                  Save review
                </button>
              </ActionForm>
            ) : null}
          </li>
        ))}
      </ul>
      {side === "vendor" && jobs.length ? (
        <ActionForm action={vendorCreateSubmittalAction.bind(null, token)} className="mt-3 grid gap-2">
          <h3 className="home-copy">New submittal</h3>
          <label className="home-sub">
            Job
            <select name="projectId" aria-label="Submittal job" className="field mt-1" defaultValue={jobs[0]?.id}>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </label>
          <label className="home-sub">
            Title
            <input name="title" aria-label="Submittal title" className="field mt-1" required />
          </label>
          <label className="home-sub">
            Division
            <input name="division" aria-label="Division" className="field mt-1" />
          </label>
          <label className="home-sub">
            Spec
            <textarea name="spec" aria-label="Spec" rows={2} className="field mt-1" required />
          </label>
          <label className="home-sub">
            Due
            <input name="dueOn" type="date" aria-label="Submittal due" className="field mt-1" required />
          </label>
          <label className="home-sub">
            Note
            <textarea name="note" aria-label="Submit note" rows={2} className="field mt-1" />
          </label>
          <FileButton name="file" label="Submittal file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" multiple empty="File" />
          <button type="submit" className="home-btn">
            Send submittal
          </button>
        </ActionForm>
      ) : null}
    </section>
  );
}
