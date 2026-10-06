import Link from "next/link";
import { changeRoleAction, inviteTeammateAction, removeMemberAction, restoreSetupAction, revokeInviteAction, settingsAction } from "@/app/actions";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { supabaseAuthConfigured } from "@/lib/supabase/env";
import { canManageSettings, canSeeMoney, roleLabel } from "@/lib/permissions";
import { companyChecklist } from "@/lib/services/onboarding";
import { getOrg, integrations, staff } from "@/lib/services/read";
import { teamBoard } from "@/lib/services/team";
import { WEEKDAY_NAMES } from "@/lib/time/calendar";
import { defaultHourlyCost } from "@/lib/services/time";

function timeZones(current: string): string[] {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["America/New_York"];
  return zones.includes(current) ? zones : [current, ...zones];
}

function stripeConnection<T extends { provider: string; status: string; label: string | null }>(connection: T): T {
  if (connection.provider !== "stripe") return connection;
  const secret = process.env.STRIPE_SECRET_KEY || "";
  if (!secret) return connection;
  if (secret.startsWith("sk_live") || secret.startsWith("rk_live")) {
    return { ...connection, status: "refused", label: "Live Stripe keys are refused. Use an sk_test_ key. Connect is not wired." };
  }
  return {
    ...connection,
    status: "test",
    label: "Test-mode PaymentIntents. Connect is not wired, so funds land on the Stripe account that owns the key.",
  };
}

export default async function SettingsPage() {
  const session = await requireSession();
  const org = getOrg(session.orgId);
  const connections = integrations(session.orgId);
  const people = staff(session.orgId);
  const board = canManageSettings(session.role) ? teamBoard(session.orgId) : null;
  const laborDefault = canManageSettings(session.role) ? defaultHourlyCost(session.orgId) : null;
  if (!org) return null;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 md:max-w-none md:px-6">
      <div>
        <h2 className="fl-section">More</h2>
        <ul className="mt-2 flex flex-col">
          {[
            ["/purchase-orders", "Purchase orders"],
            ["/price-book", "Price book"],
            ["/follow-ups", "Follow-ups"],
            ["/copilot", "Copilot"],
          ].map(([href, label]) => (
            <li key={href}>
              <Link href={href} className="block py-2 mac-t13 text-[var(--mac-accent)]">
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-2">
          <FeedbackDialog />
        </div>
      </div>
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
            License number
            <input name="license" defaultValue={org.licenseNumber ?? ""} className="field mt-1" />
          </label>
          <label className="text-sm">
            Margin alert (%)
            <input name="margin" defaultValue={(org.marginAlertBps / 100).toFixed(0)} className="field mt-1" />
          </label>
          <label className="text-sm">
            Default markup (%)
            <input name="markup" defaultValue={(org.defaultMarkupBps / 100).toFixed(0)} className="field mt-1" />
          </label>
          <label className="text-sm">
            Default hourly cost
            <input
              name="labor"
              inputMode="decimal"
              defaultValue={laborDefault == null ? "" : (laborDefault / 100).toFixed(2)}
              className="field mt-1"
            />
          </label>
          <label className="text-sm">
            Time zone
            <select name="timeZone" defaultValue={org.timeZone} className="field mt-1">
              {timeZones(org.timeZone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Week starts
            <select name="weekStartsOn" defaultValue={String(org.weekStartsOn)} className="field mt-1">
              {WEEKDAY_NAMES.map((name, index) => (
                <option key={name} value={index}>
                  {name} — seven days from {name} morning
                </option>
              ))}
            </select>
          </label>
          <p className="fl-footnote text-[var(--fl-secondary)]">The week starts {WEEKDAY_NAMES[org.weekStartsOn]}</p>
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
      {canManageSettings(session.role) ? (
        <section className="text-sm">
          <h2 className="font-medium">Setup checklist</h2>
          {companyChecklist(session.orgId)?.facts.dismissed ? (
            <form action={restoreSetupAction} className="mt-2">
              <button type="submit" className="underline">
                Show setup checklist
              </button>
            </form>
          ) : (
            <p className="mt-2 text-[var(--fl-secondary)]">Setup is on Today.</p>
          )}
        </section>
      ) : null}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-medium">Team</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {canManageSettings(session.role)
              ? "Invite an admin, an office person, or a field lead. Fieldline does not email the link. Copy it into a text."
              : "Names and roles for this company. An owner or admin invites teammates."}
          </p>
        </div>
        {canManageSettings(session.role) ? (
          <ActionForm action={inviteTeammateAction} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <label className="text-sm">
              Teammate email
              <input name="email" type="email" required autoComplete="off" className="field mt-1" />
            </label>
            <label className="text-sm">
              Role
              <select name="role" defaultValue="field" className="field mt-1">
                <option value="field">Field</option>
                <option value="estimator">Office</option>
                {session.role === "owner" ? <option value="admin">Admin</option> : null}
              </select>
            </label>
            <Button type="submit" className="h-11">
              Create invite link
            </Button>
          </ActionForm>
        ) : null}
        {canManageSettings(session.role) && board ? (
          <>
            <div>
              <h3 className="text-sm font-medium">Pending invites</h3>
              {board.pending.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">No open invites.</p> : null}
              <ul className="mt-2 space-y-2">
                {board.pending.map((invite) => (
                  <li key={invite.id} className="flex flex-col gap-2 rounded-lg bg-card p-3 text-sm ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      {invite.email} · {roleLabel(invite.role)}
                      <span className="block text-xs text-muted-foreground">Expires {formatDateTime(invite.expiresAt)}</span>
                    </span>
                    <ActionForm action={revokeInviteAction.bind(null, invite.id)}>
                      <Button type="submit" variant="outline" size="sm" className="h-9">
                        Revoke
                      </Button>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-medium">Members</h3>
              <ul className="mt-2 space-y-3">
                {board.members.map((member) => {
                  const editable = session.role === "owner" || (member.role !== "owner" && member.role !== "admin");
                  return (
                    <li key={member.userId} className="rounded-lg bg-card p-3 text-sm ring-1 ring-foreground/10">
                      <p className="font-medium">
                        {member.name} · {roleLabel(member.role)}
                      </p>
                      <p className="text-xs text-muted-foreground">{member.email}</p>
                      {editable ? (
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                          <ActionForm action={changeRoleAction.bind(null, member.userId)} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
                            <label className="text-xs">
                              New role
                              <select name="role" defaultValue={member.role} aria-label={`Change role for ${member.name}`} className="field mt-1">
                                {session.role === "owner" ? (
                                  <>
                                    <option value="owner">Owner</option>
                                    <option value="admin">Admin</option>
                                  </>
                                ) : null}
                                <option value="estimator">Office</option>
                                <option value="field">Field</option>
                                <option value="viewer">Viewer</option>
                              </select>
                            </label>
                            <Button type="submit" variant="outline" size="sm" className="h-11">
                              Update role
                            </Button>
                          </ActionForm>
                          <ActionForm action={removeMemberAction.bind(null, member.userId)}>
                            <Button type="submit" variant="outline" size="sm" className="h-11">
                              Remove
                            </Button>
                          </ActionForm>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">Only an owner can change an owner or admin.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-medium">Team activity</h3>
              {board.activity.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">No team changes yet.</p> : null}
              <ul className="mt-2 space-y-2 text-sm">
                {board.activity.map((item) => (
                  <li key={item.id}>
                    <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
                    <p>{item.summary}</p>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <ul className="text-sm">
            {people.map((person) => (
              <li key={person.id}>
                {person.name} · {roleLabel(person.role)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="font-medium">Connections</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {connections.map((connection) => {
            const shown = stripeConnection(connection);
            return (
              <li key={connection.id} className="rounded-lg bg-card p-3 ring-1 ring-foreground/10">
                <p className="font-medium">
                  {shown.provider} · {shown.status}
                </p>
                <p className="text-xs text-muted-foreground">{shown.label}</p>
              </li>
            );
          })}
        </ul>
        {supabaseAuthConfigured() ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Supabase Auth is on. The office session still follows this company membership.
          </p>
        ) : null}
        <div className="mt-3 text-sm">
          <p>QuickBooks Online Import Data. Import customers first, then invoices, so Customer matches DisplayName. This is a file, not a live connection.</p>
          <p className="mt-2">
            <a className="underline" href="/api/export/contacts">
              Customers CSV
            </a>
            {canSeeMoney(session.role) ? (
              <>
                {" · "}
                <a className="underline" href="/api/export/invoices">
                  Invoices CSV
                </a>
              </>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Customers are clients only. About 100 invoices and 1,000 rows per file. Negative amounts are left out.
          </p>
        </div>
      </section>
    </div>
  );
}
