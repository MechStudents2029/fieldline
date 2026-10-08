import Link from "next/link";
import { restoreSetupAction } from "@/app/actions";
import { SignOutButton } from "@/components/sign-out-button";
import { requireSession } from "@/lib/auth/session";
import { canEditCrm, canManageSettings } from "@/lib/permissions";
import { companyChecklist } from "@/lib/services/onboarding";

const links = [
  ["/inbox", "Inbox"],
  ["/setup", "Setup"],
  ["/pipeline", "Leads"],
  ["/time", "Time"],
  ["/rfis", "RFIs"],
  ["/submittals", "Submittals"],
  ["/todos", "To-dos"],
  ["/templates", "Templates"],
  ["/follow-ups", "Follow-ups"],
  ["/contacts", "Clients"],
  ["/invoices", "Invoices"],
  ["/bills", "Bills"],
  ["/reports/wip", "WIP"],
  ["/purchase-orders", "Purchase orders"],
  ["/price-book", "Price book"],
  ["/copilot", "Copilot"],
  ["/settings", "Settings"],
  ["/feedback", "Feedback"],
  ["/leads/new", "New lead"],
];

const fieldHidden = new Set(["/invoices", "/bills", "/purchase-orders", "/price-book", "/copilot", "/follow-ups"]);

export default async function MorePage() {
  const session = await requireSession();
  const dismissed = companyChecklist(session.orgId)?.facts.dismissed ?? false;
  const shown = links.filter(([href]) => {
    if ((href === "/reports/wip" || href === "/submittals") && !canEditCrm(session.role)) return false;
    if (session.role === "field" && fieldHidden.has(href)) return false;
    return true;
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="fl-large-title">More</h1>
        <span className="fl-pill">Demo</span>
      </div>
      <ul className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {shown.map(([href, label]) => (
          <li key={href} className="border-b border-border last:border-0">
            <Link href={href} className="block px-4 py-3">
              {label}
            </Link>
          </li>
        ))}
      </ul>
      {canManageSettings(session.role) ? (
        dismissed ? (
          <form action={restoreSetupAction}>
            <button type="submit" className="text-sm underline">
              Show setup checklist
            </button>
          </form>
        ) : (
          <p className="fl-footnote text-[var(--fl-secondary)]">Setup is on Today.</p>
        )
      ) : null}
      <SignOutButton scope={{ orgId: session.orgId, userId: session.userId }} className="text-sm text-muted-foreground underline" />
    </div>
  );
}
