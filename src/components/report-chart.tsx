export function ReportChart({ kind, points }: { kind: "bar" | "line"; points: { label: string; value: number }[] }) {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((point) => Math.abs(point.value)), 1);
  if (kind === "line") {
    const width = 320;
    const height = 112;
    const step = points.length === 1 ? 0 : width / (points.length - 1);
    const path = points
      .map((point, index) => {
        const x = index * step;
        const y = height - 16 - (Math.abs(point.value) / max) * (height - 24);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return (
      <svg data-chart="line" viewBox={`0 0 ${width} ${height}`} className="h-32 w-full" role="img">
        <path d={path} fill="none" stroke="var(--mac-accent)" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <div data-chart="bar" className="flex h-32 items-end gap-2">
      {points.map((point) => (
        <div key={point.label} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
          <div className="w-full rounded-sm bg-[var(--mac-accent)]" style={{ height: `${Math.max(8, (Math.abs(point.value) / max) * 88)}%` }} />
          <span className="truncate text-center mac-t11 text-[var(--mac-secondary)]">{point.label}</span>
        </div>
      ))}
    </div>
  );
}
