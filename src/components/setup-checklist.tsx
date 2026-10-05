import Link from "next/link";
import { dismissSetupAction } from "@/app/actions";
import type { ChecklistStep } from "@/lib/onboarding/checklist";
import { requiredChecklistRemaining } from "@/lib/onboarding/checklist";

export function SetupChecklist({ steps, canDismiss }: { steps: ChecklistStep[]; canDismiss: boolean }) {
  const remaining = requiredChecklistRemaining(steps);
  const required = steps.filter((step) => !step.optional).length;
  return (
    <section aria-labelledby="setup-heading" className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="setup-heading" className="font-heading text-xl">
          Setup
        </h2>
        <p className="text-xs text-muted-foreground">
          {required - remaining} of {required} done
        </p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        This follows what is already in the company. Hide it when you do not need it. Settings and More can bring it back.
      </p>
      <ol className="mt-3 divide-y divide-border">
        {steps.map((step) => (
          <li key={step.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
            <span>
              <span className="font-medium">{step.label}</span>
              {step.optional ? <span className="ml-2 text-xs uppercase text-muted-foreground">Optional</span> : null}
              <span className="mt-1 block text-xs text-muted-foreground">{step.detail}</span>
            </span>
            {step.done ? (
              <span className="text-pine">Done</span>
            ) : (
              <Link href={step.href} className="text-pine underline">
                {step.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
      {canDismiss ? (
        <form action={dismissSetupAction} className="mt-2">
          <button type="submit" className="text-xs text-muted-foreground underline">
            Hide setup checklist
          </button>
        </form>
      ) : null}
    </section>
  );
}
