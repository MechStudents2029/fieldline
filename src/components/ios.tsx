"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";

export function LargeTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = sentinel.current;
    const inline = bar.current;
    if (!target || !inline) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const collapsed = !entry.isIntersecting;
        inline.classList.toggle("is-collapsed", collapsed);
        inline.setAttribute("aria-hidden", collapsed ? "false" : "true");
      },
      { threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="fl-safe-top md:hidden">
      <div ref={bar} className="fl-inline-title md:hidden" aria-hidden="true">
        {title}
      </div>
      <div ref={sentinel} className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="fl-large-title">{title}</h1>
          {subtitle ? <p className="fl-secondary-text mt-1 text-[var(--fl-secondary)]">{subtitle}</p> : null}
        </div>
        {action}
      </div>
    </div>
  );
}

export function GroupedList({ label, children, meta }: { label: string; children: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between pr-4">
        <h2 className="fl-section">{label}</h2>
        {meta ? <span className="fl-footnote tabular-nums text-[var(--fl-secondary)]">{meta}</span> : null}
      </div>
      <ul className="fl-group">{children}</ul>
    </section>
  );
}

export function GroupedRow({
  href,
  title,
  subtitle,
  trailing,
  chevron = true,
  titleClassName,
}: {
  href?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  chevron?: boolean;
  titleClassName?: string;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className={cn("fl-body block truncate text-[var(--fl-label)]", titleClassName)}>{title}</span>
        {subtitle ? <span className="fl-secondary-text mt-0.5 block truncate text-[var(--fl-secondary)]">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="fl-body shrink-0 tabular-nums">{trailing}</span> : null}
      {chevron ? <ChevronRight className="size-4 shrink-0 text-[var(--fl-tertiary)]" aria-hidden /> : null}
    </>
  );
  if (href) {
    return (
      <li>
        <Link href={href} className="fl-cell fl-press">
          {body}
        </Link>
      </li>
    );
  }
  return <li className="fl-cell">{body}</li>;
}

export function StatusPill({ children }: { children: React.ReactNode }) {
  return <span className="fl-pill">{children}</span>;
}

export function NumberStrip({
  items,
}: {
  items: { label: string; value: string; tone?: "neutral" | "close" | "late" }[];
}) {
  return (
    <div className="fl-strip">
      {items.map((item) => (
        <div key={item.label}>
          <p className={cn("fl-number", item.tone === "late" && "fl-late", item.tone === "close" && "fl-close")}>{item.value}</p>
          <p className="fl-footnote mt-1 text-[var(--fl-secondary)]">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

export function PlusLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} aria-label={label} className="fl-press inline-flex size-11 items-center justify-center text-[var(--fl-accent)]">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <path d="M11 4v14M4 11h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </Link>
  );
}
