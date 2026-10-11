"use client";

import { useState } from "react";

export function TileOrder({
  dashboardId,
  tiles,
  orderAction,
}: {
  dashboardId: string;
  tiles: { id: string; title: string; kind: string }[];
  orderAction: (formData: FormData) => void;
}) {
  const [order, setOrder] = useState(tiles.map((tile) => tile.id));
  const [drag, setDrag] = useState("");
  const byId = new Map(tiles.map((tile) => [tile.id, tile]));

  async function dropOn(targetId: string) {
    if (!drag || drag === targetId) return;
    const next = order.filter((item) => item !== drag);
    next.splice(next.indexOf(targetId), 0, drag);
    setOrder(next);
    setDrag("");
    const data = new FormData();
    data.set("dashboardId", dashboardId);
    for (const item of next) data.append("ids", item);
    await orderAction(data);
  }

  return (
    <ul className="flex flex-col gap-1" data-tile-order={dashboardId}>
      {order.map((id) => {
        const tile = byId.get(id);
        if (!tile) return null;
        return (
          <li
            key={tile.id}
            className="flex items-center gap-2 rounded-md bg-[var(--mac-under)] px-2 py-1"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void dropOn(tile.id);
            }}
          >
            <button type="button" draggable aria-label={`Reorder ${tile.title}`} data-tile-drag={tile.title} className="cursor-grab text-[var(--mac-tertiary)]" onDragStart={() => setDrag(tile.id)}>
              ⋮⋮
            </button>
            <span className="mac-t13">{tile.title}</span>
            <span className="fl-pill fl-pill-sm">{tile.kind}</span>
          </li>
        );
      })}
    </ul>
  );
}
