import { requireSession } from "@/lib/auth/session";
import { observationPrintRows } from "@/lib/services/observations";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ObservationsPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const rows = observationPrintRows(session, {
    type: one(query.type) ?? "",
    status: one(query.filter) ?? "",
    priority: one(query.priority) ?? "",
    vendorContactId: one(query.vendor) ?? "",
    projectId: one(query.project) ?? "",
  });
  return (
    <main className="mx-auto max-w-5xl px-6 py-8 text-sm">
      <h1 className="text-2xl">Observations</h1>
      <p className="mt-1 tabular-nums">{rows.length}</p>
      <table aria-label="Observations" className="mt-6 w-full text-left">
        <thead>
          <tr>
            <th className="py-1 pr-2 font-medium">No.</th>
            <th className="py-1 pr-2 font-medium">Job</th>
            <th className="py-1 pr-2 font-medium">Title</th>
            <th className="py-1 pr-2 font-medium">Type</th>
            <th className="py-1 pr-2 font-medium">Priority</th>
            <th className="py-1 pr-2 font-medium">Status</th>
            <th className="py-1 pr-2 font-medium">Vendor</th>
            <th className="py-1 font-medium">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="py-1 pr-2 tabular-nums">{row.number}</td>
              <td className="py-1 pr-2">{row.job}</td>
              <td className="py-1 pr-2">{row.title}</td>
              <td className="py-1 pr-2">{row.typeLabel}</td>
              <td className="py-1 pr-2">{row.priorityLabel}</td>
              <td className="py-1 pr-2">{row.statusLabel}</td>
              <td className="py-1 pr-2">{row.vendor}</td>
              <td className="py-1 tabular-nums">{row.dueDate ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
