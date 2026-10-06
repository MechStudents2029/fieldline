import { seedStarterAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { canManageSettings, canSeeMoney } from "@/lib/permissions";
import { starterMarkVisible } from "@/lib/services/onboarding";
import { listPriceBook } from "@/lib/services/read";
import { STARTER_TRADE_LABELS, STARTER_TRADES } from "@/lib/security";

export default async function PriceBookPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) {
    return (
      <div>
        <h1 className="fl-large-title">Price book</h1>
      </div>
    );
  }
  const query = await searchParams;
  const rows = listPriceBook(session.orgId, query.q);
  const unfiltered = query.q?.trim() ? listPriceBook(session.orgId) : rows;
  const money = canSeeMoney(session.role);
  const starter = rows.some((item) => starterMarkVisible(item.vendor));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-3xl">Price book</h1>
        {canManageSettings(session.role) ? (
          <a href="/import?kind=price_book" className="mac-t13 text-[var(--mac-accent)]">
            Import
          </a>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">Estimates use these unit costs. Markup is applied on the estimate, not stored as the sell price.</p>
      {starter ? (
        <p className="text-sm text-copper">Starter rows are sample costs. Edit your prices before you send a proposal.</p>
      ) : null}
      <form>
        <input name="q" defaultValue={query.q} placeholder="Search code, name, or trade" className="field" aria-label="Search the price book" />
      </form>
      {unfiltered.length === 0 ? (
        <EmptyState
          title="No prices yet"
          why="No prices yet."
        >
          {canManageSettings(session.role) ? (
            <ActionForm action={seedStarterAction} className="flex flex-col gap-3">
              <label className="text-sm">
                Starter trade
                <select name="trade" defaultValue="remodel" className="field mt-1">
                  {STARTER_TRADES.map((trade) => (
                    <option key={trade} value={trade}>
                      {STARTER_TRADE_LABELS[trade]}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" className="h-11">
                Add starter price book
              </Button>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted-foreground">An owner or admin can add a starter book.</p>
          )}
        </EmptyState>
      ) : null}
      {unfiltered.length > 0 && rows.length === 0 ? <p className="text-sm text-muted-foreground">No price book items match.</p> : null}
      {rows.length > 0 ? (
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
      ) : null}
    </div>
  );
}
