"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { OfflineBanner } from "@/components/offline-banner";
import { cn } from "cn";

const links = [
  { href: "/", label: "Today" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/projects", label: "Jobs" },
  { href: "/time", label: "Time" },
  { href: "/invoices", label: "Invoices" },
  { href: "/contacts", label: "Contacts" },
  { href: "/price-book", label: "Price book" },
  { href: "/follow-ups", label: "Follow-ups" },
  { href: "/copilot", label: "Copilot" },
  { href: "/settings", label: "Settings" },
  { href: "/feedback", label: "Feedback" },
];

const mobile = [
  { href: "/", label: "Today" },
  { href: "/projects", label: "Jobs" },
  { href: "/time", label: "Time" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/more", label: "More" },
];

const fieldHidden = new Set(["/invoices", "/price-book", "/follow-ups", "/copilot"]);

export function Shell({
  orgName,
  userName,
  role,
  children,
}: {
  orgName: string;
  userName: string;
  role: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const labelFor = (label: string, href: string) => (role === "field" && href === "/" ? "My day" : label);
  const nav = role === "field" ? links.filter((link) => !fieldHidden.has(link.href)) : links;
  const tabs = role === "field" ? mobile.filter((link) => !fieldHidden.has(link.href)) : mobile;
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="absolute left-4 top-4 z-50 -translate-y-24 rounded-lg bg-card px-3 py-2 text-sm shadow ring-1 ring-border focus:translate-y-0"
      >
        Skip to the job file
      </a>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-border bg-card px-4 py-5 md:flex">
        <Link href="/" className="px-2">
          <p className="font-heading text-2xl tracking-tight text-pine">Fieldline</p>
          <p className="text-xs text-muted-foreground">Job file for remodelers</p>
        </Link>
        <nav aria-label="Office" className="mt-8 flex flex-1 flex-col gap-1">
          {nav.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current(link.href) ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                current(link.href) ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {labelFor(link.label, link.href)}
            </Link>
          ))}
        </nav>
        <form action={logoutAction}>
          <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted">
            Sign out
          </button>
        </form>
      </aside>
      <div className="md:pl-60">
        <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-heading text-lg leading-none md:hidden">Fieldline</p>
              <p className="text-sm font-medium">{orgName}</p>
              <p className="text-xs text-muted-foreground">
                {userName} · {role}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <FeedbackDialog />
              <p className="max-w-48 text-right text-[11px] leading-snug text-muted-foreground">
                Demo mode. Payments, email, SMS, and AI stay local until you add keys.
              </p>
            </div>
          </div>
        </header>
        <OfflineBanner />
        <main id="main" className="px-4 pt-4 pb-24 md:px-8 md:pb-10">{children}</main>
      </div>
      <nav aria-label="Primary" className={`fixed inset-x-0 bottom-0 z-20 grid border-t border-border bg-card md:hidden ${tabs.length === 5 ? "grid-cols-5" : "grid-cols-4"}`}>
        {tabs.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current(link.href) ? "page" : undefined}
            className={cn(
              "px-1 py-3 text-center text-[11px]",
              current(link.href) ? "font-semibold text-pine" : "text-muted-foreground",
            )}
          >
            {labelFor(link.label, link.href)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
