export function CashChart({ points }: { points: { label: string; cents: number; low: boolean }[] }) {
  if (points.length === 0) return null;
  const values = points.map((point) => point.cents);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = Math.max(max - min, 1);
  const width = 640;
  const height = 56;
  const step = points.length === 1 ? 0 : width / (points.length - 1);
  const y = (cents: number) => height - 8 - ((cents - min) / span) * (height - 16);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(1)},${y(point.cents).toFixed(1)}`).join(" ");
  return (
    <svg data-chart="cash" viewBox={`0 0 ${width} ${height}`} className="h-14 w-full" role="img" aria-label="Running balance">
      <path d={path} fill="none" stroke="var(--mac-accent)" strokeWidth="1.5" />
      {points.map((point, index) =>
        point.low ? <circle key={`${point.label}-${index}`} cx={index * step} cy={y(point.cents)} r="2.5" fill="var(--mac-danger)" /> : null,
      )}
    </svg>
  );
}
