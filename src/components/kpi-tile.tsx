import Link from "next/link";

const tileClass = "flex h-28 w-44 shrink-0 flex-col items-start gap-1 overflow-hidden rounded-xl bg-[var(--mac-under)] px-3 py-2 text-left";

export function KpiTile({
  label,
  value,
  href,
  tile,
  children,
}: {
  label: string;
  value?: string;
  href?: string;
  tile?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="mac-t11 text-[var(--mac-secondary)]">{label}</span>
      {value != null ? <span className="mac-t22 num">{value}</span> : children}
    </>
  );
  if (href) {
    return (
      <Link href={href} data-tile={tile ?? label} className={tileClass}>
        {body}
      </Link>
    );
  }
  return (
    <div data-kpi={label} className={tileClass}>
      {body}
    </div>
  );
}
