"use client";

import { useRouter } from "next/navigation";

export function Toolbar({
  title,
  subtitle,
  leading,
  center,
  primary,
  primaryHref,
  onPrimary,
  trailing,
  search = true,
}: {
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  center?: React.ReactNode;
  primary?: React.ReactNode;
  primaryHref?: string;
  onPrimary?: () => void;
  trailing?: React.ReactNode;
  search?: boolean;
}) {
  const router = useRouter();
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2.5 px-4">
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" className="mac-glass-btn hidden w-8 justify-center px-0 max-[1023px]:inline-flex" aria-label="Show sidebar" onClick={() => window.dispatchEvent(new Event("fieldline-sidebar"))}>
          ▤
        </button>
        {leading}
        <div className="min-w-0">
          <h1 className="truncate mac-t15">{title}</h1>
          {subtitle ? <p className="truncate mac-t11 text-[var(--mac-secondary)]">{subtitle}</p> : null}
        </div>
      </div>
      <div className="flex flex-1 justify-center">{center}</div>
      <div className="flex items-center gap-2">
        {search ? (
          <input
            data-mac-search
            className="mac-search"
            aria-label="Search"
            placeholder="Search"
            onChange={(event) => {
              const query = event.target.value.trim().toLowerCase();
              document.querySelectorAll<HTMLElement>("[data-mac-row]").forEach((row) => {
                const text = (row.dataset.macRow || "").toLowerCase();
                row.style.display = !query || text.includes(query) ? "" : "none";
              });
            }}
          />
        ) : null}
        {primaryHref && !primary ? (
          <a href={primaryHref} data-mac-new className="mac-glass-btn" aria-label="New">
            +
          </a>
        ) : null}
        {primary ? (
          <button type="button" data-mac-primary data-mac-new className="mac-primary" onClick={() => (onPrimary ? onPrimary() : primaryHref ? router.push(primaryHref) : undefined)}>
            {primary}
          </button>
        ) : null}
        {trailing}
      </div>
    </div>
  );
}

export function Segmented({ items }: { items: { href: string; label: string; current?: boolean }[] }) {
  return (
    <div className="mac-seg" role="tablist">
      {items.map((item) => (
        <a key={item.label} href={item.href} aria-current={item.current ? "page" : undefined}>
          {item.label}
        </a>
      ))}
    </div>
  );
}
