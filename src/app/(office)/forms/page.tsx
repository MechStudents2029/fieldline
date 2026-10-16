import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { fillableTemplates, formSubmissions, formTemplateList } from "@/lib/services/forms";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FormSubmissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const templateId = one(query.template) ?? "";
  const status = one(query.status) ?? "";
  const rows = formSubmissions(session, { templateId, status });
  const templates = session.role === "field" ? [] : formTemplateList(session);
  const fillable = fillableTemplates(session);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Form submissions" subtitle={String(rows.length)} search={false} />
      </div>
      <div className="flex flex-col gap-4 px-1 py-2 md:px-6 md:py-4">
        <h1 className="fl-large-title md:hidden">Form submissions</h1>
        {fillable.length > 0 ? (
          <ul className="flex flex-wrap gap-3">
            {fillable.map((row) => (
              <li key={row.id}>
                <Link href={`/forms/use/${row.id}`} className="text-[var(--mac-accent)]">
                  {row.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <form method="get" className="flex flex-wrap items-center gap-2">
          {templates.length > 0 ? (
            <select name="template" aria-label="Template" defaultValue={templateId} className="field w-auto">
              <option value="">All</option>
              {templates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                </option>
              ))}
            </select>
          ) : null}
          <select name="status" aria-label="Status" defaultValue={status} className="field w-auto">
            <option value="">All</option>
            <option value="new">New</option>
            <option value="reviewed">Reviewed</option>
          </select>
          <button type="submit" className="ctl h-9">
            Show
          </button>
          <Link href={`/api/export/forms?template=${encodeURIComponent(templateId)}&status=${encodeURIComponent(status)}`} className="text-[var(--mac-accent)]">
            CSV
          </Link>
        </form>
        {rows.length === 0 ? <p className="text-sm text-[var(--mac-secondary)]">No submissions.</p> : null}
        <table aria-label="Form submissions" className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--mac-secondary)]">
              <th className="py-1 font-medium">Form</th>
              <th className="py-1 font-medium">Status</th>
              <th className="py-1 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-submission={row.id} data-status={row.status}>
                <td className="py-1">
                  <Link href={`/forms/${row.id}`}>{row.templateTitle}</Link>
                </td>
                <td className="py-1">{row.status === "reviewed" ? "Reviewed" : "New"}</td>
                <td className="num py-1">{row.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
