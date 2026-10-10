import Link from "next/link";
import { redirect } from "next/navigation";
import { AutomationSheet } from "@/components/automation-sheet";
import { Toolbar } from "@/components/mac/toolbar";
import { toggleAutomationAction } from "@/app/(office)/settings/automations/actions";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { canManageSettings } from "@/lib/permissions";
import { formOptions, listRules, previewChoices, previewRule, ruleView, runsFor } from "@/lib/services/automations";
import { calendarForOrg } from "@/lib/services/time";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!canManageSettings(session.role)) redirect("/settings");
  const query = await searchParams;
  const ruleId = one(query.rule);
  const logId = one(query.log);
  const previewId = one(query.preview);
  const zone = calendarForOrg(session.orgId).timeZone;
  if (logId) {
    const log = runsFor(session, logId);
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Toolbar title={log.name} subtitle="Runs" search={false} trailing={<Link href="/settings/automations" className="ctl">Rules</Link>} />
        <div className="min-h-0 flex-1 overflow-auto px-4">
          {log.runs.length === 0 ? <p className="mac-t13 text-[var(--mac-secondary)]">No runs</p> : null}
          <table className="mac-table w-full" aria-label="Runs">
            <thead>
              <tr>
                <th>Time</th>
                <th>Record</th>
                <th>Actions</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {log.runs.map((run) => (
                <tr key={run.id} data-mac-row={run.record}>
                  <td className="num">{formatDateTime(run.at, zone)}</td>
                  <td>{run.record}</td>
                  <td className="wrap">{run.actions.join(", ")}</td>
                  <td>
                    <span className="fl-pill">{run.result}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  const rules = listRules(session);
  const editing = ruleId && ruleId !== "new" ? ruleView(session, ruleId) : null;
  const draft = ruleId === "new" ? null : editing;
  const options = formOptions(session.orgId);
  const targets = draft ? previewChoices(session.orgId, draft.trigger) : [];
  const preview = draft && previewId ? previewRule(session, draft.id, previewId).lines : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="Automations"
        subtitle={`${rules.length}`}
        search={false}
        primary={ruleId ? undefined : "New"}
        primaryHref={ruleId ? undefined : "/settings/automations?rule=new"}
        trailing={ruleId ? <Link href="/settings/automations" className="ctl">Rules</Link> : null}
      />
      {ruleId ? (
        <AutomationSheet rule={draft} options={options} targets={targets} preview={preview} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4">
          {rules.length === 0 ? <p className="mac-t13 text-[var(--mac-secondary)]">No rules</p> : null}
          <table className="mac-table w-full" aria-label="Automations">
            <thead>
              <tr>
                <th>Name</th>
                <th>Trigger</th>
                <th>Last run</th>
                <th>Runs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} data-mac-row={rule.name}>
                  <td>
                    <Link href={`/settings/automations?rule=${rule.id}`}>{rule.name}</Link>
                  </td>
                  <td>{rule.trigger}</td>
                  <td className="num">{rule.lastRunAt ? formatDateTime(rule.lastRunAt, zone) : ""}</td>
                  <td className="num">{rule.runCount}</td>
                  <td>
                    <span className="flex items-center gap-2">
                      <form action={toggleAutomationAction}>
                        <input type="hidden" name="id" value={rule.id} />
                        <input type="hidden" name="enabled" value={rule.enabled ? "0" : "1"} />
                        <button type="submit" className="ctl">
                          {rule.enabled ? "On" : "Off"}
                        </button>
                      </form>
                      <Link href={`/settings/automations?log=${rule.id}`} className="ctl">
                        Log
                      </Link>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
