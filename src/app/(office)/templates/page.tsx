import Link from "next/link";
import { NewJobSheet } from "@/components/new-job-sheet";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm, canSeeMoney } from "@/lib/permissions";
import { templateChoices } from "@/lib/services/templates";
import { calendarForOrg } from "@/lib/services/time";
import { localDay } from "@/lib/time/calendar";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const session = await requireSession();
  const query = await searchParams;
  const choices = templateChoices(session);
  const money = canSeeMoney(session.role);
  const office = canEditCrm(session.role);
  const today = localDay(Date.now(), calendarForOrg(session.orgId).timeZone);
  const showNew = office && (query.new === "1" || choices.templates.length > 0);
  return (
    <div className="relative md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Templates" search={false} primary={office ? "New job" : undefined} primaryHref={office ? "/templates?new=1" : undefined} />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <div className="flex items-center justify-between md:hidden">
          <h1 className="fl-large-title">Templates</h1>
          {office ? (
            <Link href="/templates?new=1" className="text-sm text-[var(--fl-accent)]">
              New job
            </Link>
          ) : null}
        </div>
        {choices.templates.length === 0 ? <p>No templates</p> : null}
        <div className="overflow-x-auto">
          <table className="mac-table" aria-label="Templates">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Schedule</th>
                {money ? <th>Estimate</th> : null}
                {money ? <th>Draws</th> : null}
                {money ? <th>Selections</th> : null}
                <th>Punch</th>
              </tr>
            </thead>
            <tbody>
              {choices.templates.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/templates/${row.id}`}>{row.name}</Link>
                  </td>
                  <td>{row.jobType}</td>
                  <td className="num">{row.counts.schedule}</td>
                  {money ? <td className="num">{row.counts.estimate}</td> : null}
                  {money ? <td className="num">{row.counts.draws}</td> : null}
                  {money ? <td className="num">{row.counts.selections}</td> : null}
                  <td className="num">{row.counts.punch}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showNew && query.new === "1" ? (
        <NewJobSheet templates={choices.templates} clients={choices.clients} people={choices.people} vendors={choices.vendors} startDate={today} actorId={session.userId} />
      ) : null}
    </div>
  );
}
