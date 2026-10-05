import Link from "next/link";
import { logoutAction, restoreSetupAction } from "@/app/actions";
import { requireSession } from "@/lib/auth/session";
import { canManageSettings } from "@/lib/permissions";
import { companyChecklist } from "@/lib/services/onboarding";

const links = [
  ["/contacts", "Contacts"],
  ["/invoices", "Invoices"],
  ["/price-book", "Price book"],
  ["/copilot", "Copilot"],
  ["/settings", "Settings"],
  ["/feedback", "Feedback"],
  ["/leads/new", "New lead"],
];

export default async function MorePage() {
  const session = await requireSession();
  const dismissed = companyChecklist(session.orgId)?.facts.dismissed ?? false;
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-heading text-3xl">More</h1>
      <ul className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {links.map(([href, label]) => (
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
          <p className="text-sm text-muted-foreground">The setup checklist is on Today.</p>
        )
      ) : null}
      <form action={logoutAction}>
        <button className="text-sm text-muted-foreground underline">Sign out</button>
      </form>
    </div>
  );
}
