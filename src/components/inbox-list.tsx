"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type InboxRow = { id: string; kind: string; who: string; record: string; snippet: string; age: string; unread: boolean };

export function InboxList({ items }: { items: InboxRow[] }) {
  const router = useRouter();
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (event.key === "j") {
        event.preventDefault();
        setCursor((value) => Math.min(items.length - 1, value + 1));
      } else if (event.key === "k") {
        event.preventDefault();
        setCursor((value) => Math.max(0, value - 1));
      } else if (event.key === "Enter" && items[cursor]) {
        event.preventDefault();
        router.push(`/inbox/${items[cursor].id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor, items, router]);
  if (items.length === 0) return <p className="px-4 py-6 mac-t13 text-[var(--mac-secondary)]">All caught up</p>;
  return (
    <ul aria-label="Inbox" className="flex flex-col">
      {items.map((item, index) => (
        <li key={item.id} aria-current={index === cursor ? "true" : undefined}>
          <Link href={`/inbox/${item.id}`} className={`flex items-start gap-3 border-b border-[var(--mac-separator)] px-4 py-2 ${index === cursor ? "bg-[var(--mac-fill)]" : ""}`}>
            <span className="min-w-0 flex-1">
              <span className={`block truncate mac-t13 ${item.unread ? "font-semibold" : ""}`}>
                {item.who} · {item.record}
              </span>
              <span className="block truncate mac-t11 text-[var(--mac-secondary)]">{item.snippet}</span>
            </span>
            <span className="num mac-t11 text-[var(--mac-secondary)]">{item.age}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
