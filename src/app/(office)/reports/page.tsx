import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canManageSettings } from "@/lib/permissions";
import { library } from "@/lib/services/reports";

export default async function ReportsPage() {
  const session = await requireSession();
  const data = library(session);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        title="Reports"
        subtitle={`${data.ready.length + data.saved.length}`}
        search={false}
        trailing={
          <span className="flex items-center gap-2">
            {canManageSettings(session.role) ? (
              <Link href="/reports/dashboards" className="ctl">
                Dashboards
              </Link>
            ) : null}
            <Link href="/reports/new" className="ctl">
              New
            </Link>
          </span>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto" data-mac-list>
        <table className="mac-table">
          <tbody>
            {data.ready.map((report) => (
              <tr key={report.id} data-report={report.name}>
                <td>
                  <Link href={report.href}>{report.name}</Link>
                </td>
                <td>
                  <span className="fl-pill fl-pill-sm">Ready</span>
                </td>
              </tr>
            ))}
            {data.saved.map((report) => (
              <tr key={report.id} data-report={report.name}>
                <td>
                  <Link href={report.href}>{report.name}</Link>
                </td>
                <td>
                  <span className="fl-pill fl-pill-sm">{report.share === "everyone" ? "Everyone" : report.share === "office" ? "Office" : "Private"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
