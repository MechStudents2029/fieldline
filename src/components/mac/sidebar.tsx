"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Briefcase, Calendar, ClipboardList, Clock, Copy, FileText, Inbox, ListTodo, MessageSquare, Receipt, Sun, Users, Wallet } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import type { OfficeChrome } from "@/lib/services/read";

function current(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/pipeline") return pathname.startsWith("/pipeline") || pathname.startsWith("/leads");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  orgName,
  userName,
  role,
  orgId,
  userId,
  chrome,
  open,
  inboxUnread = 0,
}: {
  orgName: string;
  userName: string;
  role: string;
  orgId: string;
  userId: string;
  chrome: OfficeChrome;
  open: boolean;
  inboxUnread?: number;
}) {
  const pathname = usePathname();
  const field = role === "field";
  const initials = userName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
  const item = (href: string, label: string, icon: React.ReactNode, count?: number) => (
    <div key={href} className="flex items-center">
      <Link href={href} aria-current={current(pathname, href) ? "page" : undefined} className="mac-sidebar-row min-w-0 flex-1">
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </Link>
      {count ? <span className="num pr-2 text-[var(--mac-secondary)]">{count}</span> : null}
    </div>
  );
  if (!open) {
    return (
      <div className="relative hidden w-9 shrink-0 md:block">
        <button
          type="button"
          aria-label="Show sidebar"
          className="absolute left-1.5 top-3 inline-flex size-7 items-center justify-center rounded-md text-[var(--mac-secondary)]"
          onClick={() => window.dispatchEvent(new Event("fieldline-sidebar"))}
        >
          ▤
        </button>
      </div>
    );
  }
  return (
    <div className="relative hidden w-[252px] shrink-0 md:block">
      <nav aria-label="Office" className="mac-glass absolute inset-y-2 left-2 flex w-[236px] flex-col rounded-[14px] p-2">
        <div className="flex h-11 items-center gap-1.5 px-1">
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--mac-accent)] text-[11px] font-semibold text-[var(--mac-on-accent)]">F</span>
          <span className="min-w-0 flex-1 whitespace-nowrap text-[12px] font-semibold leading-4">{orgName}</span>
          <button type="button" aria-label="Hide sidebar" className="shrink-0 text-[var(--mac-secondary)]" onClick={() => window.dispatchEvent(new Event("fieldline-sidebar"))}>
            ▤
          </button>
        </div>
        <div className="mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {item("/", field ? "My day" : "Today", <Sun size={16} strokeWidth={1.6} />)}
          {item("/inbox", "Inbox", <Inbox size={16} strokeWidth={1.6} />, inboxUnread)}
          {item("/pipeline", "Leads", <Users size={16} strokeWidth={1.6} />, chrome.leadCount)}
          <p className="px-2 pb-1 pt-3 mac-t11 font-semibold text-[var(--mac-secondary)]">Work</p>
          {item("/projects", "Jobs", <Briefcase size={16} strokeWidth={1.6} />, chrome.pins.length)}
          {item("/todos", "To-dos", <ListTodo size={16} strokeWidth={1.6} />)}
          {item("/templates", "Templates", <Copy size={16} strokeWidth={1.6} />)}
          {chrome.pins.map((job) => (
            <Link key={job.id} href={`/projects/${job.id}`} aria-label="Pin" className="mac-sidebar-row pl-7" aria-current={pathname === `/projects/${job.id}` ? "page" : undefined}>
              <span aria-hidden className="size-1 shrink-0 rounded-full bg-[var(--mac-tertiary)]" />
              <span className="truncate" aria-hidden="true">{job.name}</span>
            </Link>
          ))}
          {field ? null : item("/estimates", "Estimates", <FileText size={16} strokeWidth={1.6} />, chrome.estimateCount)}
          {item("/schedule", "Schedule", <Calendar size={16} strokeWidth={1.6} />)}
          {item("/rfis", "RFIs", <MessageSquare size={16} strokeWidth={1.6} />)}
          {role === "owner" || role === "admin" || role === "estimator" ? item("/submittals", "Submittals", <ClipboardList size={16} strokeWidth={1.6} />) : null}
          {item("/time", "Time", <Clock size={16} strokeWidth={1.6} />)}
          {field ? null : (
            <>
              <p className="px-2 pb-1 pt-3 mac-t11 font-semibold text-[var(--mac-secondary)]">Money</p>
              {item("/invoices", "Invoices", <Receipt size={16} strokeWidth={1.6} />, chrome.invoiceCount)}
              {item("/bills", "Bills", <Wallet size={16} strokeWidth={1.6} />, chrome.billCount)}
            </>
          )}
          {role === "owner" || role === "admin" || role === "estimator" ? (
            <>
              <p className="px-2 pb-1 pt-3 mac-t11 font-semibold text-[var(--mac-secondary)]">Reports</p>
              {item("/reports/wip", "WIP", <BarChart3 size={16} strokeWidth={1.6} />)}
              {item("/reports/schedule", "Variance", <Calendar size={16} strokeWidth={1.6} />)}
            </>
          ) : null}
          <p className="px-2 pb-1 pt-3 mac-t11 font-semibold text-[var(--mac-secondary)]">People</p>
          {item("/contacts", "Clients", <Users size={16} strokeWidth={1.6} />, chrome.clientCount)}
        </div>
        <div className="mt-2 flex items-center gap-2 border-t border-[var(--mac-separator)] pt-2">
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-[var(--mac-fill)] mac-t11">{initials}</span>
          <span className="min-w-0 flex-1 truncate mac-t13">{userName}</span>
          <Link href="/settings" aria-label="Settings" className="inline-flex size-7 items-center justify-center text-[var(--mac-secondary)]">
            ⚙
          </Link>
        </div>
        <SignOutButton scope={{ orgId, userId }} className="mt-1 h-7 w-full rounded-md px-2 text-left mac-t13 text-[var(--mac-secondary)]" />
      </nav>
    </div>
  );
}
