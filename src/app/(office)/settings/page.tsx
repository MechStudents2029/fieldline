import { settingsAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { canManageSettings } from "@/lib/permissions";
import { getOrg, integrations, staff } from "@/lib/services/read";

export default async function SettingsPage() {
  const session = (await getSession())!;
  const org = getOrg(session.orgId);
  const connections = integrations(session.orgId);
  const people = staff(session.orgId);
  if (!org) return null;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="font-heading text-3xl">Settings</h1>
        <p className="text-sm text-muted-foreground">
          {org.name} · {org.city}, {org.state} · {org.licenseNumber}
        </p>
        <p className="mt-2 text-sm">Contract language is a template, not a state-approved home-improvement form. Have counsel review it before a real customer signs.</p>
      </div>
      {canManageSettings(session.role) ? (
        <ActionForm action={settingsAction} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <label className="text-sm">
            Margin alert (%)
            <input name="margin" defaultValue={(org.marginAlertBps / 100).toFixed(0)} className="field mt-1" />
          </label>
          <label className="text-sm">
            Default markup (%)
            <input name="markup" defaultValue={(org.defaultMarkupBps / 100).toFixed(0)} className="field mt-1" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="cards" defaultChecked={org.cardEnabled === 1} />
            Allow card payments (ACH stays the default)
          </label>
          <Button type="submit" className="h-11">
            Save
          </Button>
        </ActionForm>
      ) : (
        <p className="text-sm text-muted-foreground">Only an owner or admin can change these.</p>
      )}
      <section>
        <h2 className="font-medium">People</h2>
        <ul className="mt-2 text-sm">
          {people.map((person) => (
            <li key={person.id}>
              {person.name} · {person.role}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-medium">Connections</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {connections.map((connection) => (
            <li key={connection.id} className="rounded-lg bg-card p-3 ring-1 ring-foreground/10">
              <p className="font-medium">
                {connection.provider} · {connection.status}
              </p>
              <p className="text-xs text-muted-foreground">{connection.label}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm">
          <a className="underline" href="/api/export/invoices">
            Invoice CSV
          </a>
          {" · "}
          <a className="underline" href="/api/export/contacts">
            Contact CSV
          </a>
        </p>
      </section>
    </div>
  );
}
