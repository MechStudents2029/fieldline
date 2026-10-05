import Link from "next/link";
import { cn } from "cn";

export function JobTabs({ projectId, current }: { projectId: string; current: "job" | "logs" }) {
  const tab = (href: string, key: "job" | "logs", label: string) => (
    <Link
      href={href}
      aria-current={current === key ? "page" : undefined}
      className={cn(
        "inline-flex h-11 items-center rounded-lg px-3 text-sm",
        current === key ? "bg-primary text-primary-foreground" : "bg-muted",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Job sections" className="flex gap-2">
      {tab(`/projects/${projectId}`, "job", "Job")}
      {tab(`/projects/${projectId}/logs`, "logs", "Logs")}
    </nav>
  );
}
