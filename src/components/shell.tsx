"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Briefcase, Clock, Ellipsis, Sun, Users } from "lucide-react";
import { CommandMenu } from "@/components/mac/command-menu";
import { Hotkeys } from "@/components/mac/hotkeys";
import { Sidebar } from "@/components/mac/sidebar";
import { OfflineBanner } from "@/components/offline-banner";
import type { OfficeChrome } from "@/lib/services/read";

const officeTabs = [
  { href: "/", label: "Today", icon: Sun },
  { href: "/projects", label: "Jobs", icon: Briefcase },
  { href: "/pipeline", label: "Leads", icon: Users },
  { href: "/time", label: "Time", icon: Clock },
  { href: "/more", label: "More", icon: Ellipsis },
];

const fieldTabs = [
  { href: "/", label: "My day", icon: Sun },
  { href: "/projects", label: "Jobs", icon: Briefcase },
  { href: "/time", label: "Time", icon: Clock },
  { href: "/more", label: "More", icon: Ellipsis },
];

const fieldHidden = new Set(["/invoices", "/bills", "/purchase-orders", "/price-book", "/follow-ups", "/copilot"]);

export function Shell({
  orgName,
  userName,
  role,
  orgId,
  userId,
  chrome,
  inboxUnread = 0,
  children,
}: {
  orgName: string;
  userName: string;
  role: string;
  orgId: string;
  userId: string;
  chrome: OfficeChrome;
  inboxUnread?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const tabs = role === "field" ? fieldTabs : officeTabs;
  const current = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/pipeline") return pathname.startsWith("/pipeline") || pathname.startsWith("/leads");
    return pathname === href || pathname.startsWith(`${href}/`);
  };
  useEffect(() => {
    const collapsed = () => document.cookie.split("; ").find((row) => row.startsWith("fl-sidebar="))?.split("=")[1] === "0";
    const apply = () => setOpen(window.innerWidth >= 1024 && !collapsed());
    apply();
    const toggle = () => {
      setOpen((value) => {
        const next = !value;
        document.cookie = `fl-sidebar=${next ? "1" : "0"}; path=/; max-age=31536000`;
        return next;
      });
    };
    window.addEventListener("resize", apply);
    window.addEventListener("fieldline-sidebar", toggle);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("fieldline-sidebar", toggle);
    };
  }, []);
  return (
    <div id="fieldline-office-shell" className="min-h-screen md:flex md:h-dvh md:min-h-0 md:overflow-hidden">
      <a href="#main" className="absolute left-4 top-4 z-50 -translate-y-24 rounded-lg bg-card px-3 py-2 text-sm shadow ring-1 ring-border focus:translate-y-0">
        Skip to the job file
      </a>
      {/* Desktop source list: Sidebar renders nav aria-label="Office" */}
      <Sidebar orgName={orgName} userName={userName} role={role} orgId={orgId} userId={userId} chrome={chrome} open={open} inboxUnread={inboxUnread} />
      <div className="flex min-w-0 flex-1 flex-col md:m-2 md:overflow-hidden md:rounded-[14px] md:bg-[var(--mac-window)]">
        <OfflineBanner />
        <main id="main" className="px-4 pt-2 pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-auto md:px-0 md:pt-0 md:pb-0">
          {children}
        </main>
      </div>
      <nav aria-label="Primary" className="fl-tabbar fixed inset-x-0 bottom-0 z-20 md:hidden" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href} aria-current={current(link.href) ? "page" : undefined} className="fl-tab fl-press fl-caption">
              <Icon className="size-[22px]" strokeWidth={2} aria-hidden />
              {link.label}
            </Link>
          );
        })}
      </nav>
      <CommandMenu chrome={chrome} role={role} />
      <Hotkeys />
      <span hidden>{fieldHidden.size}</span>
    </div>
  );
}
