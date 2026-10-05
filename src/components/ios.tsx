"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";

export function LargeTitle({ title, subtitle }: { title: string; subtitle?: string }) {
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
    <div className="fl-safe-top">
      <div ref={bar} className="fl-inline-title md:hidden" aria-hidden="true">
        {title}
      </div>
      <div ref={sentinel}>
        <h1 className="fl-large-title">{title}</h1>
        {subtitle ? <p className="fl-subhead mt-1 text-[var(--fl-secondary)]">{subtitle}</p> : null}
      </div>
    </div>
  );
}

export function GroupedList({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="fl-section">{label}</h2>
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
}: {
  href?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  chevron?: boolean;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="fl-headline block">{title}</span>
        {subtitle ? <span className="fl-footnote mt-0.5 block text-[var(--fl-secondary)]">{subtitle}</span> : null}
      </span>
      {trailing}
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

const pillTone = {
  success: "fl-pill-success",
  warning: "fl-pill-warning",
  danger: "fl-pill-danger",
  accent: "fl-pill-accent",
} as const;

export function StatusPill({ tone, children }: { tone: keyof typeof pillTone; children: React.ReactNode }) {
  return <span className={cn("fl-pill", pillTone[tone])}>{children}</span>;
}
