import { notFound } from "next/navigation";
import { ReportScreen } from "@/components/report-screen";
import { requireSession } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/errors";
import { openBuiltin, parseQuery } from "@/lib/services/reports";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

export default async function BuiltinReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession();
  const extra = one(query.col)
    ? [parseQuery({ filters: [{ column: one(query.col), op: one(query.op) as "eq", value: one(query.val) }] }).filters[0]].filter((filter) => filter?.column)
    : [];
  const from = one(query.from).slice(0, 10);
  const to = one(query.to).slice(0, 10);
  let view: ReturnType<typeof openBuiltin>;
  try {
    view = openBuiltin(session, id, extra, id === "lead_sources" ? { from, to } : undefined);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  const csv = new URLSearchParams({ id, col: one(query.col), op: one(query.op), val: one(query.val) });
  if (from) csv.set("from", from);
  if (to) csv.set("to", to);
  return <ReportScreen view={view} csvHref={`/api/export/report?${csv.toString()}`} range={id === "lead_sources" ? { from, to } : null} />;
}
