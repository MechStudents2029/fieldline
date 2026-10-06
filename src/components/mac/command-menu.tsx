"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { OfficeChrome } from "@/lib/services/read";

export function CommandMenu({ chrome, role }: { chrome: OfficeChrome; role: string }) {
  const router = useRouter();
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
  const field = role === "field";
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
            <Command.Item onSelect={() => go("/pipeline")}>Leads</Command.Item>
            <Command.Item onSelect={() => go("/projects")}>Jobs</Command.Item>
            {field ? null : <Command.Item onSelect={() => go("/estimates")}>Estimates</Command.Item>}
            <Command.Item onSelect={() => go("/time")}>Time</Command.Item>
            {field ? null : <Command.Item onSelect={() => go("/invoices")}>Invoices</Command.Item>}
            {field ? null : <Command.Item onSelect={() => go("/bills")}>Bills</Command.Item>}
            <Command.Item onSelect={() => go("/contacts")}>Clients</Command.Item>
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
        </Command.List>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      {help ? (
        <button type="button" className="mac-command-overlay" aria-label="Close shortcuts" onClick={() => setHelp(false)}>
          <span className="mac-command block p-4 text-left" onClick={(event) => event.stopPropagation()}>
            <span className="mac-t15">Shortcuts</span>
            <span className="mt-2 block mac-t13 text-[var(--mac-secondary)]">⌘K command menu · / search · G then T L J E H B C · ⌃⌘S sidebar · ⌥⌘0 inspector · ⌘N new · ⌘↩ primary · ? this list</span>
          </span>
        </button>
      ) : null}
    </>
  );
}
