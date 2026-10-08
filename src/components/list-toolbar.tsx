"use client";

import { useEffect, useState } from "react";
import { deleteViewAction, pinViewAction, renameViewAction, saveViewAction, unpinViewAction } from "@/app/actions";

export type ListOption = { value: string; label: string };
export type ListFilterSpec = { name: string; label: string; value: string; any: string; options: ListOption[] };
export type ListDateSpec = { name: string; label: string; value: string };
export type ListViewSpec = { id: string; name: string; href: string; pinned: boolean; mine: boolean; shared: boolean };
export type ListLinkSpec = { href: string; label: string; current: boolean };

function submitForm(form: HTMLFormElement) {
  for (const element of Array.from(form.elements)) {
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      if (!element.value && element.type !== "submit") element.disabled = true;
    }
  }
  form.requestSubmit();
}

export function ListToolbar({
  path,
  list,
  filters,
  dates = [],
  search = "",
  query,
  preserve = {},
  views,
  activeId,
  canShare,
  clearHref,
  links = [],
  extra,
}: {
  path: string;
  list: string;
  filters: ListFilterSpec[];
  dates?: ListDateSpec[];
  search?: string;
  query: Record<string, string>;
  preserve?: Record<string, string>;
  views: ListViewSpec[];
  activeId?: string;
  canShare: boolean;
  clearHref: string | null;
  links?: ListLinkSpec[];
  extra?: React.ReactNode;
}) {
  const current = views.find((view) => view.id === activeId);
  const hidden = Object.entries(preserve).filter(([, value]) => value);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setOpen(!media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return (
    <details
      className="list-sheet"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next !== open) setOpen(next);
      }}
    >
      <summary className="list-filter-toggle" role="button">Filter</summary>
      <div className="list-row">
        <form method="get" action={path} className="list-bar">
          {hidden.map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <input
            name="q"
            aria-label="Search"
            defaultValue={search}
            placeholder="Search"
            className="list-search"
          />
          {filters.map((filter) => (
            <select
              key={filter.name}
              name={filter.name}
              aria-label={filter.label}
              defaultValue={filter.value}
              className="list-select"
              onChange={(event) => {
                const form = event.currentTarget.form;
                if (form) submitForm(form);
              }}
            >
              <option value="">{filter.label}: {filter.any}</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {filter.label}: {option.label}
                </option>
              ))}
            </select>
          ))}
          {dates.map((date) => (
            <label key={date.name} className="list-date">
              {date.label}
              <input
                type="date"
                name={date.name}
                aria-label={date.label}
                defaultValue={date.value}
                className="list-search"
                onChange={(event) => {
                  const form = event.currentTarget.form;
                  if (form) submitForm(form);
                }}
              />
            </label>
          ))}
          {links.map((link) => (
            <a key={link.href} href={link.href} aria-current={link.current ? "page" : undefined} className={link.current ? "list-link is-current" : "list-link"}>
              {link.label}
            </a>
          ))}
        </form>
        {extra}
        {clearHref ? (
          <a href={clearHref} className="list-clear">
            Clear
          </a>
        ) : null}
        <details className="list-pop">
          <summary aria-label="Saved views" role="button">{current ? current.name : "Views"}</summary>
          <div className="list-menu">
            {views.map((view) => (
              <a key={view.id} href={view.href}>
                {view.name}
                {view.pinned ? " · Pinned" : ""}
                {view.shared ? " · Shared" : ""}
              </a>
            ))}
            <form action={saveViewAction} className="list-view-form">
              <input type="hidden" name="list" value={list} />
              <input type="hidden" name="query" value={JSON.stringify(query)} />
              <input type="hidden" name="sort" value={preserve.sort || ""} />
              <input type="hidden" name="dir" value={preserve.dir || ""} />
              <input name="name" aria-label="View name" required maxLength={40} placeholder="Name" className="list-search" />
              {canShare ? (
                <label className="mac-t13">
                  <input type="checkbox" name="shared" value="1" /> Share
                </label>
              ) : null}
              <button type="submit">Save</button>
            </form>
            {current?.mine ? (
              <>
                <form action={renameViewAction} className="list-view-form">
                  <input type="hidden" name="id" value={current.id} />
                  <input name="name" aria-label="Rename view" defaultValue={current.name} maxLength={40} className="list-search" />
                  <button type="submit">Rename</button>
                </form>
                <form action={current.pinned ? unpinViewAction : pinViewAction}>
                  <input type="hidden" name="id" value={current.id} />
                  <button type="submit">{current.pinned ? "Unpin" : "Pin"}</button>
                </form>
                <form action={deleteViewAction}>
                  <input type="hidden" name="id" value={current.id} />
                  <input type="hidden" name="list" value={list} />
                  <button type="submit">Delete</button>
                </form>
              </>
            ) : current ? (
              <form action={current.pinned ? unpinViewAction : pinViewAction}>
                <input type="hidden" name="id" value={current.id} />
                <button type="submit">{current.pinned ? "Unpin" : "Pin"}</button>
              </form>
            ) : null}
          </div>
        </details>
      </div>
    </details>
  );
}
