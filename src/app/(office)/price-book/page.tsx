import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { listPriceBook } from "@/lib/services/read";

export default async function PriceBookPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  const query = await searchParams;
  const rows = listPriceBook(session.orgId, query.q);
  const money = canSeeMoney(session.role);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-3xl">Price book</h1>
      <p className="text-sm text-muted-foreground">Estimates use these unit costs. Markup is applied on the estimate, not stored as the sell price.</p>
      <form>
        <input name="q" defaultValue={query.q} placeholder="Search code, name, or trade" className="field" />
      </form>
      <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10">
        {rows.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span>
              <span className="font-medium">{item.name}</span>
              <span className="block text-xs text-muted-foreground">
                {item.code} · {item.category} · per {item.unit}
                {item.vendor ? ` · ${item.vendor}` : ""}
              </span>
            </span>
            <span>{money ? formatMoney(item.unitCostCents) : "Hidden"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
