"use client";

import { Command } from "cmdk";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { canEditCrm, type Role } from "@/lib/permissions";
import type { OfficeChrome } from "@/lib/services/read";

export function CommandMenu({ chrome, role }: { chrome: OfficeChrome; role: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const onMenu = () => setOpen(true);
    const onHelp = () => setHelp(true);
    window.addEventListener("fieldline-command", onMenu);
    window.addEventListener("fieldline-help", onHelp);
    return () => {
      window.removeEventListener("fieldline-command", onMenu);
      window.removeEventListener("fieldline-help", onHelp);
    };
  }, []);
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const timeCommand = (action: string) => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("fieldline-time", { detail: action }));
  };
  const scheduleCommand = (action: string) => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("fieldline-schedule", { detail: action }));
  };
  const field = role === "field";
  const onTime = pathname === "/time";
  const onSchedule = pathname === "/schedule";
  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="mac-command-overlay" />
          <DialogPrimitive.Content className="mac-command" aria-describedby={undefined}>
            <DialogPrimitive.Title className="sr-only">Commands</DialogPrimitive.Title>
            <Command label="Command search">
        <Command.Input placeholder="Search Fieldline" />
        <Command.List>
          <Command.Empty>No matches</Command.Empty>
          <Command.Group heading="Go to">
            <Command.Item onSelect={() => go("/")}>Today</Command.Item>
            <Command.Item onSelect={() => go("/inbox")}>Inbox</Command.Item>
            <Command.Item onSelect={() => go("/pipeline")}>Leads</Command.Item>
            <Command.Item onSelect={() => go("/projects")}>Jobs</Command.Item>
            <Command.Item onSelect={() => go("/todos")}>To-dos</Command.Item>
            <Command.Item onSelect={() => go("/templates")}>Templates</Command.Item>
            {field ? null : <Command.Item onSelect={() => go("/estimates")}>Estimates</Command.Item>}
            <Command.Item onSelect={() => go("/schedule")}>Schedule</Command.Item>
            <Command.Item onSelect={() => go("/rfis")}>RFIs</Command.Item>
            {canEditCrm(role as Role) ? <Command.Item onSelect={() => go("/submittals")}>Submittals</Command.Item> : null}
            <Command.Item onSelect={() => go("/time")}>Time</Command.Item>
            <Command.Item onSelect={() => go("/equipment")}>Equipment</Command.Item>
            {field ? null : <Command.Item onSelect={() => go("/invoices")}>Invoices</Command.Item>}
            {field ? null : <Command.Item onSelect={() => go("/bills")}>Bills</Command.Item>}
            {canEditCrm(role as Role) ? <Command.Item onSelect={() => go("/reports/wip")}>WIP</Command.Item> : null}
            <Command.Item onSelect={() => go("/contacts")}>Clients</Command.Item>
            {role === "owner" || role === "admin" ? <Command.Item onSelect={() => go("/import")}>Import</Command.Item> : null}
            <Command.Item onSelect={() => go("/settings")}>Settings</Command.Item>
            <Command.Item onSelect={() => go("/purchase-orders")}>Purchase orders</Command.Item>
            <Command.Item onSelect={() => go("/price-book")}>Price book</Command.Item>
            <Command.Item onSelect={() => go("/follow-ups")}>Follow-ups</Command.Item>
            <Command.Item onSelect={() => go("/copilot")}>Copilot</Command.Item>
            <Command.Item onSelect={() => go("/settings")}>Send feedback</Command.Item>
          </Command.Group>
          <Command.Group heading="Jobs">
            {chrome.jobs.map((job) => (
              <Command.Item key={job.id} onSelect={() => go(`/projects/${job.id}`)}>
                {job.name}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Clients">
            {chrome.clients.map((client) => (
              <Command.Item key={client.id} onSelect={() => go(`/contacts/${client.id}`)}>
                {client.name}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Estimates">
            {chrome.estimates.map((estimate) => (
              <Command.Item key={estimate.id} onSelect={() => go(`/estimates/${estimate.id}`)}>
                {estimate.title}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Create">
            <Command.Item onSelect={() => go("/leads/new")}>New lead</Command.Item>
            {field ? null : <Command.Item onSelect={() => go("/bills/new")}>New bill</Command.Item>}
          </Command.Group>
          {onTime && !field ? (
            <Command.Group heading="Time">
              <Command.Item onSelect={() => timeCommand("approve")}>Approve submitted</Command.Item>
              <Command.Item onSelect={() => timeCommand("prev")}>Previous week</Command.Item>
              <Command.Item onSelect={() => timeCommand("next")}>Next week</Command.Item>
              <Command.Item onSelect={() => timeCommand("day")}>Day</Command.Item>
              <Command.Item onSelect={() => timeCommand("week")}>Week</Command.Item>
              <Command.Item onSelect={() => timeCommand("period")}>Pay period</Command.Item>
              <Command.Item onSelect={() => timeCommand("clockout")}>Clock out on site</Command.Item>
            </Command.Group>
          ) : null}
          {onSchedule ? (
            <Command.Group heading="Schedule">
              <Command.Item onSelect={() => scheduleCommand("prev")}>Previous week</Command.Item>
              <Command.Item onSelect={() => scheduleCommand("next")}>Next week</Command.Item>
              <Command.Item onSelect={() => scheduleCommand("today")}>Today</Command.Item>
              <Command.Item onSelect={() => scheduleCommand("week")}>Week</Command.Item>
              <Command.Item onSelect={() => scheduleCommand("two")}>2 weeks</Command.Item>
            </Command.Group>
          ) : null}
        </Command.List>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      {help ? (
        <button type="button" className="mac-command-overlay" aria-label="Close shortcuts" onClick={() => setHelp(false)}>
          <span className="mac-command block p-4 text-left" onClick={(event) => event.stopPropagation()}>
            <span className="mac-t15">Shortcuts</span>
            <span className="mt-2 block mac-t13 text-[var(--mac-secondary)]">⌘K command menu · / search · G then T L J E H S B C I · ⌃⌘S sidebar · ⌥⌘0 inspector · ⌘N new · ⌘↩ primary · ? this list</span>
          </span>
        </button>
      ) : null}
    </>
  );
}
