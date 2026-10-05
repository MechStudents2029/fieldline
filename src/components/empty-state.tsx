import Link from "next/link";
import { Button } from "@/components/ui/button";

export function EmptyState({
  title,
  why,
  href,
  action,
  children,
}: {
  title: string;
  why: string;
  href?: string;
  action?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <h2 className="font-heading text-xl">{title}</h2>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">{why}</p>
      {href && action ? (
        <Button asChild className="mt-4 h-11">
          <Link href={href}>{action}</Link>
        </Button>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
