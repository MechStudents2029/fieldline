"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { moveLeadAction } from "@/app/actions";
import { formatMoney } from "@/lib/money";

type Card = {
  id: string;
  title: string;
  stageId: string;
  source: string;
  valueEstCents: number | null;
  contactName: string;
  updatedAt: string;
};

export function PipelineBoard({
  stages,
  cards,
  showMoney,
}: {
  stages: { id: string; name: string }[];
  cards: Card[];
  showMoney: boolean;
}) {
  const router = useRouter();
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function drop(stageId: string) {
    if (!dragging) return;
    try {
      await moveLeadAction(dragging, stageId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move that deal.");
    } finally {
      setDragging(null);
    }
  }

  return (
    <div>
      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const column = cards.filter((card) => card.stageId === stage.id);
          return (
            <section
              key={stage.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => drop(stage.id)}
              className="w-72 shrink-0 rounded-xl bg-muted/70 p-2"
            >
              <header className="flex items-center justify-between px-2 py-2">
                <h2 className="text-sm font-medium">{stage.name}</h2>
                <span className="text-xs text-muted-foreground">{column.length}</span>
              </header>
              <div className="flex flex-col gap-2">
                {column.length === 0 ? <p className="px-2 py-6 text-xs text-muted-foreground">Nothing in this stage.</p> : null}
                {column.map((card) => (
                  <article
                    key={card.id}
                    draggable
                    onDragStart={() => setDragging(card.id)}
                    className="cursor-grab rounded-lg bg-card p-3 ring-1 ring-foreground/10"
                  >
                    <Link href={`/leads/${card.id}`} className="font-medium">
                      {card.title}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">{card.contactName}</p>
                    <p className="mt-2 text-xs">
                      {card.source}
                      {showMoney && card.valueEstCents != null ? ` · ${formatMoney(card.valueEstCents)}` : ""}
                    </p>
                    <label className="mt-2 block text-[11px] text-muted-foreground">
                      Move
                      <select
                        className="field mt-1 h-9 text-sm"
                        value={card.stageId}
                        onChange={async (event) => {
                          await moveLeadAction(card.id, event.target.value);
                          router.refresh();
                        }}
                      >
                        {stages.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
