import Link from "next/link";

export function EmptyState({
  title,
  why,
  href,
  action,
  children,
}: {
  title: string;
  why?: string;
  href?: string;
  action?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <h2 className="fl-headline">{title}</h2>
      {why ? <p className="fl-secondary-text mt-1 max-w-[18rem] text-[var(--fl-secondary)]">{why}</p> : null}
      {href && action ? (
        <Link href={href} className="fl-primary fl-press mt-5 w-auto px-5">
          {action}
        </Link>
      ) : null}
      {children ? <div className="mt-4 w-full max-w-sm text-left">{children}</div> : null}
    </div>
  );
}
