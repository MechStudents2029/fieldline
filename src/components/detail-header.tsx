export function recordStatus(status: string) {
  if (!status) return "";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function DetailHeader({
  title,
  status,
  meta,
  actions,
}: {
  title: string;
  status: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header data-detail="header" className="detail-head">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="mac-t15 truncate">{title}</h1>
        <span className="fl-pill fl-pill-sm" data-status={status.toLowerCase()}>
          {recordStatus(status)}
        </span>
        {meta ? <p className="min-w-0 truncate mac-t13 text-[var(--mac-secondary)]">{meta}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </header>
  );
}

export function DetailFacts({ label, rows }: { label: string; rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="mac-kv detail-kv" aria-label={label} data-detail="facts">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
