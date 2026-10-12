export type StockBalance = {
  onHandMilli: number;
  allocatedMilli: number;
  valueCents: number;
};

function whole(value: number, label: string) {
  if (!Number.isInteger(value)) throw new Error(`${label} must be a whole number.`);
}

export function availableMilli(onHandMilli: number, allocatedMilli: number) {
  whole(onHandMilli, "On hand");
  whole(allocatedMilli, "Allocated");
  if (onHandMilli < 0 || allocatedMilli < 0) throw new Error("Quantity cannot be negative.");
  if (allocatedMilli > onHandMilli) throw new Error("Allocated is past on hand.");
  return onHandMilli - allocatedMilli;
}

/** Extended cost for a quantity. Quantity is milli-units; unit cost is cents. */
export function extendCost(qtyMilli: number, unitCostCents: number) {
  whole(qtyMilli, "Quantity");
  whole(unitCostCents, "Unit cost");
  if (qtyMilli < 0 || unitCostCents < 0) throw new Error("Cost cannot be negative.");
  return Math.round((qtyMilli * unitCostCents) / 1000);
}

/** Moving-average unit cost. An empty location falls back to the catalog cost. */
export function averageUnitCost(onHandMilli: number, valueCents: number, fallbackUnitCents: number) {
  whole(onHandMilli, "On hand");
  whole(valueCents, "Value");
  whole(fallbackUnitCents, "Unit cost");
  if (onHandMilli <= 0 || valueCents < 0) return Math.max(0, fallbackUnitCents);
  return Math.round((valueCents * 1000) / onHandMilli);
}

/** Proportional share of location value. The last units take the remaining cents. */
export function takeValue(onHandMilli: number, valueCents: number, qtyMilli: number) {
  whole(onHandMilli, "On hand");
  whole(valueCents, "Value");
  whole(qtyMilli, "Quantity");
  if (qtyMilli < 0 || onHandMilli < 0 || valueCents < 0) throw new Error("Quantity cannot be negative.");
  if (qtyMilli === 0) return 0;
  if (qtyMilli > onHandMilli) throw new Error("That is more than on hand.");
  if (qtyMilli === onHandMilli) return valueCents;
  return Math.round((valueCents * qtyMilli) / onHandMilli);
}

export function receiveBalance(balance: StockBalance, qtyMilli: number, unitCostCents: number): StockBalance {
  if (qtyMilli < 1) throw new Error("Enter a quantity.");
  const cost = extendCost(qtyMilli, unitCostCents);
  return {
    onHandMilli: balance.onHandMilli + qtyMilli,
    allocatedMilli: balance.allocatedMilli,
    valueCents: balance.valueCents + cost,
  };
}

export function removeBalance(balance: StockBalance, qtyMilli: number): { balance: StockBalance; costCents: number } {
  if (qtyMilli < 1) throw new Error("Enter a quantity.");
  if (qtyMilli > availableMilli(balance.onHandMilli, balance.allocatedMilli)) throw new Error("That is more than available.");
  const costCents = takeValue(balance.onHandMilli, balance.valueCents, qtyMilli);
  return {
    costCents,
    balance: {
      onHandMilli: balance.onHandMilli - qtyMilli,
      allocatedMilli: balance.allocatedMilli,
      valueCents: balance.valueCents - costCents,
    },
  };
}

export function addBalance(balance: StockBalance, qtyMilli: number, costCents: number): StockBalance {
  whole(costCents, "Cost");
  if (qtyMilli < 1 || costCents < 0) throw new Error("Enter a quantity.");
  return {
    onHandMilli: balance.onHandMilli + qtyMilli,
    allocatedMilli: balance.allocatedMilli,
    valueCents: balance.valueCents + costCents,
  };
}

/** Good receipts add stock. Short, damaged, and backordered receipts do not. */
export function stockableQtyMilli(lines: { condition: string; qtyMilli: number }[]) {
  return lines.reduce((sum, line) => sum + (line.condition === "ok" && line.qtyMilli > 0 ? line.qtyMilli : 0), 0);
}

export function isLowStock(available: number, reorderPointMilli: number) {
  return reorderPointMilli >= 0 && available <= reorderPointMilli;
}

/** Buy enough to reach the reorder point, and at least one unit when already there. */
export function reorderQtyMilli(available: number, reorderPointMilli: number) {
  if (!isLowStock(available, reorderPointMilli)) return 0;
  return Math.max(reorderPointMilli - available, 1000);
}
