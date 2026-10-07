import Link from "next/link";
import type { RfiListItem } from "@/lib/services/rfis";

export function LinkedRfis({ rows }: { rows: RfiListItem[] }) {
  if (rows.length === 0) return null;
  return (
    <ul aria-label="Linked RFIs" className="mb-3 flex flex-col gap-1">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-2 text-sm">
          <Link href={row.href}>
            {row.label} · {row.title}
          </Link>
          <span className="fl-pill">{row.statusLabel}</span>
        </li>
      ))}
    </ul>
  );
}
