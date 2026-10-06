import Link from "next/link";
import { dismissSetupAction } from "@/app/actions";
import { requiredChecklistRemaining, type ChecklistStep, type ProposalStep } from "@/lib/onboarding/checklist";

export function FirstProposal({ steps }: { steps: ProposalStep[] }) {
  const done = steps.filter((step) => step.done).length;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="fl-section">First proposal</h2>
        <span className="fl-body tabular-nums text-[var(--fl-secondary)]">{done} of 4</span>
      </div>
      <ul className="fl-group">
        {steps.map((step) =>
          step.done ? (
            <li key={step.id} className="fl-cell" data-done="true">
              <span className="fl-body">{step.label}</span>
            </li>
          ) : (
            <li key={step.id} data-done="false">
              <Link href={step.href} className="fl-cell fl-press">
                <span className="fl-body min-w-0 flex-1">{step.label}</span>
                <span className="text-[var(--fl-tertiary)]" aria-hidden>
                  ›
                </span>
              </Link>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

export function SetupRow({ steps }: { steps: ChecklistStep[] }) {
  const required = steps.filter((step) => !step.optional);
  const done = required.filter((step) => step.done).length;
  const remaining = requiredChecklistRemaining(steps);
  if (remaining === 0) return null;
  return (
    <Link href="/setup" className="fl-cell fl-press fl-group">
      <ProgressRing done={done} total={required.length} />
      <span className="min-w-0 flex-1">
        <span className="fl-body block">Finish setup</span>
      </span>
      <span className="fl-body tabular-nums text-[var(--fl-secondary)]">
        {done} of {required.length}
      </span>
      <span className="text-[var(--fl-tertiary)]" aria-hidden>
        ›
      </span>
    </Link>
  );
}

export function SetupScreen({ steps, canDismiss }: { steps: ChecklistStep[]; canDismiss: boolean }) {
  const required = steps.filter((step) => !step.optional);
  const optional = steps.filter((step) => step.optional);
  const done = required.filter((step) => step.done).length;
  return (
    <div className="flex flex-col gap-7">
      <div className="fl-safe-top">
        <Link href="/" className="fl-body text-[var(--fl-accent)]">
          ‹ Today
        </Link>
        <h1 className="fl-large-title mt-2">Setup</h1>
        <p className="fl-secondary-text text-[var(--fl-secondary)]">
          {done} of {required.length} done
        </p>
      </div>
      <ul className="fl-group">
        {required.map((step) => (
          <SetupItem key={step.id} step={step} />
        ))}
      </ul>
      {optional.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="fl-section">Optional</h2>
          <ul className="fl-group">
            {optional.map((step) => (
              <SetupItem key={step.id} step={step} />
            ))}
          </ul>
        </section>
      ) : null}
      {canDismiss ? (
        <form action={dismissSetupAction} className="text-center">
          <button type="submit" className="fl-body min-h-11 text-[var(--fl-accent)]">
            Hide setup
          </button>
        </form>
      ) : null}
    </div>
  );
}

function SetupItem({ step }: { step: ChecklistStep }) {
  const mark = step.done ? <FilledCheck /> : <EmptyCircle />;
  const body = (
    <>
      {mark}
      <span className="fl-body min-w-0 flex-1">{step.label}</span>
      {step.done ? null : (
        <span className="text-[var(--fl-tertiary)]" aria-hidden>
          ›
        </span>
      )}
    </>
  );
  if (step.done) {
    return (
      <li className="fl-cell" data-done="true">
        {body}
      </li>
    );
  }
  return (
    <li data-done="false">
      <Link href={step.href} className="fl-cell fl-press">
        {body}
      </Link>
    </li>
  );
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const offset = c - (total === 0 ? 0 : (done / total) * c);
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0">
      <circle cx="11" cy="11" r={r} fill="none" stroke="var(--fl-tertiary)" strokeWidth="2" />
      <circle
        cx="11"
        cy="11"
        r={r}
        fill="none"
        stroke="var(--fl-label)"
        strokeWidth="2"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 11 11)"
      />
    </svg>
  );
}

function FilledCheck() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0">
      <circle cx="11" cy="11" r="10" fill="var(--fl-label)" />
      <path d="M6.5 11.2 9.4 14.2 15.5 8" fill="none" stroke="var(--fl-elevated)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function EmptyCircle() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0">
      <circle cx="11" cy="11" r="9" fill="none" stroke="var(--fl-tertiary)" strokeWidth="1.6" />
    </svg>
  );
}
