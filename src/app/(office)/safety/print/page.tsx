import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay } from "@/lib/format";
import { listSafety } from "@/lib/services/safety";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

export default async function SafetyPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const rows = listSafety(session, { type: one(query.type), status: one(query.status), job: one(query.job) });
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="mac-t15">Safety</h1>
        <span className="flex items-center gap-2">
          <PrintButton />
          <Link href="/safety" className="ctl">
            Back
          </Link>
        </span>
      </div>
      <table className="mac-table w-full" aria-label="Safety">
        <thead>
          <tr>
            <th>Type</th>
            <th>Name</th>
            <th>Status</th>
            <th>Job</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.type}-${row.id}`}>
              <td>{row.typeLabel}</td>
              <td>{row.title}</td>
              <td>{row.statusLabel}</td>
              <td>{row.projectName}</td>
              <td className="num">{formatCalendarDay(row.when)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
