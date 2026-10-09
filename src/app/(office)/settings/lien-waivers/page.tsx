import Link from "next/link";
import { saveLienSettingsAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { canManageSettings, canSeeMoney } from "@/lib/permissions";
import { lienSettings } from "@/lib/services/waivers";

export default async function LienWaiverSettingsPage() {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) return <h1 className="fl-large-title">Lien waivers</h1>;
  const settings = lienSettings(session);
  if (!settings) return <h1 className="fl-large-title">Lien waivers</h1>;
  const office = canManageSettings(session.role);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link href="/settings" className="text-sm text-[var(--mac-accent)]">
        Settings
      </Link>
      <h1 className="font-heading text-3xl">Lien waivers</h1>
      <p className="text-sm text-muted-foreground">{settings.note}</p>
      <ActionForm action={saveLienSettingsAction} className="flex flex-col gap-3">
        <label className="text-sm">
          Pay gate
          <select name="mode" aria-label="Pay gate" className="field mt-1" defaultValue={settings.mode} disabled={!office}>
            <option value="off">Off</option>
            <option value="warn">Warn</option>
            <option value="block">Block</option>
          </select>
        </label>
        {settings.templates.map((row) => (
          <label key={row.type} className="text-sm">
            {row.label}
            <textarea name={row.type} aria-label={row.label} defaultValue={row.body} rows={3} className="field mt-1" readOnly={!office} />
          </label>
        ))}
        {office ? (
          <Button type="submit" className="h-11 w-fit">
            Save
          </Button>
        ) : null}
      </ActionForm>
    </div>
  );
}
