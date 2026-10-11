import { notFound } from "next/navigation";
import { CashTable } from "@/components/cash-table";
import { requireSession } from "@/lib/auth/session";
import { formatWhole } from "@/lib/money";
import { canSeeCash } from "@/lib/permissions";
import { cashForecast } from "@/lib/services/cash";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

export default async function CashPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!canSeeCash(session.role)) notFound();
  const params = await searchParams;
  const board = cashForecast(session, {
    projected: one(params.projected) === "1",
    jobId: one(params.job),
    customerId: one(params.customer),
  });
  const ending = board.forecast.rows.find((item) => item.id === "balance")?.cells.at(-1)?.cents ?? board.openingCents;
  return (
    <main className="mx-auto max-w-[1100px] p-6">
      <h1 className="mac-t15">Cash</h1>
      <p className="num mac-t13">{formatWhole(ending)}</p>
      <CashTable forecast={board.forecast} />
    </main>
  );
}
