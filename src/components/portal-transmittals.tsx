import type { PortalTransmittal } from "@/lib/services/transmittals";

export function PortalTransmittalSection({ rows }: { rows: PortalTransmittal[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Transmittals">
      <h2>Transmittals</h2>
      <ul className="home-stack">
        {rows.map((row) => (
          <li key={row.id} className="home-card">
            <p className="home-copy">
              <a href={row.href}>{row.subject}</a>
            </p>
            <p className="home-sub">
              {row.number} · {row.statusLabel}
              {row.dueOn ? ` · ${row.dueOn}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
