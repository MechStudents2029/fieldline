import Link from "next/link";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { formatQty } from "@/lib/receiving/match";
import { listStock, stockPlaces } from "@/lib/services/inventory";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (session.role === "viewer") return <h1 className="fl-large-title">Inventory</h1>;
  const query = await searchParams;
  const location = typeof query.location === "string" ? query.location : "";
  const low = query.low === "1";
  const board = listStock(session, { locationId: location, low });
  const places = stockPlaces(session.orgId);
  const subtitle = `${board.rows.length} ${board.rows.length === 1 ? "item" : "items"}`;
  const csv = `/api/export/inventory?location=${encodeURIComponent(location)}&low=${low ? "1" : ""}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden md:block">
        <Toolbar title="Inventory" subtitle={subtitle} search={false} trailing={<a href={csv}>CSV</a>} />
      </div>
      <div className="flex items-center justify-between gap-3 px-4 pt-3 md:hidden">
        <h1 className="fl-large-title">Inventory</h1>
        <a href={csv} className="ctl">
          CSV
        </a>
      </div>
      <p className="px-4 mac-t13 text-[var(--mac-secondary)] md:hidden">{subtitle}</p>
      <form method="get" action="/inventory" className="flex flex-wrap items-end gap-2 px-4">
        <label className="text-sm">
          Location
          <select name="location" aria-label="Location" className="field mt-1" defaultValue={location}>
            <option value="">All</option>
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="low" value="1" defaultChecked={low} aria-label="Low stock" />
          Low
        </label>
        <button type="submit" className="ctl">
          Show
        </button>
      </form>
      <div className="overflow-x-auto px-4">
        <table className="mac-table" aria-label="Inventory">
          <thead>
            <tr>
              <th>Item</th>
              <th>On hand</th>
              <th>Allocated</th>
              <th>Available</th>
              {board.money ? <th>Value</th> : null}
            </tr>
          </thead>
          <tbody>
            {board.rows.length === 0 ? (
              <tr>
                <td colSpan={board.money ? 5 : 4}>No stock</td>
              </tr>
            ) : (
              board.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/inventory/${row.id}`}>{row.name}</Link>
                    {row.low ? <span className="pill ml-2">Low</span> : null}
                  </td>
                  <td className="num">{formatQty(row.onHandMilli)} {row.unit}</td>
                  <td className="num">{formatQty(row.allocatedMilli)}</td>
                  <td className="num">{formatQty(row.availableMilli)}</td>
                  {board.money ? <td className="num">{formatMoney(row.valueCents ?? 0)}</td> : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
