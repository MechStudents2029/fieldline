import type { Metadata } from "next";
import { headers } from "next/headers";
import { acceptInviteAction, logoutAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { previewInvite } from "@/lib/services/team";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join a company · Fieldline",
  referrer: "no-referrer",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const result = previewInvite(token, { ip });
  if (!result.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
        <p className="text-sm font-medium text-copper">Fieldline</p>
        <h1 className="font-heading mt-2 text-3xl">Invite link</h1>
        <p role="alert" className="mt-4 text-sm">
          {result.error}
        </p>
      </main>
    );
  }
  const preview = result.preview;
  const session = await getSession();
  const matches = session?.email.toLowerCase() === preview.email;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-4 py-10">
      <div>
        <p className="text-sm font-medium text-copper">Fieldline</p>
        <h1 className="font-heading mt-2 text-3xl">Join {preview.companyName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {preview.inviterName} invited {preview.email} as {preview.roleLabel}.
        </p>
        <p className="mt-2 text-sm">Expires {formatDateTime(preview.expiresAt)}.</p>
      </div>
      {matches && session ? (
        <ActionForm action={acceptInviteAction.bind(null, token)} className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
          <p className="text-sm">Signed in as {session.email}.</p>
          <input type="hidden" name="mode" value="session" />
          <Button type="submit" className="h-11">
            Join this company
          </Button>
        </ActionForm>
      ) : null}
      {session && !matches ? (
        <div className="rounded-2xl bg-card p-5 text-sm ring-1 ring-foreground/10">
          <p>You are signed in as {session.email}. This invite is for {preview.email}.</p>
          <form action={logoutAction} className="mt-3">
            <Button type="submit" variant="outline" className="h-11">
              Sign out
            </Button>
          </form>
        </div>
      ) : null}
      {!session && preview.accountExists ? (
        <ActionForm action={acceptInviteAction.bind(null, token)} className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
          <h2 className="font-heading text-2xl">Sign in</h2>
          <p className="text-sm text-muted-foreground">Use the password for {preview.email}.</p>
          <input type="hidden" name="mode" value="signin" />
          <label className="text-sm">
            Password
            <input name="password" type="password" required autoComplete="current-password" className="field mt-1" />
          </label>
          <Button type="submit" className="h-11">
            Sign in and join
          </Button>
        </ActionForm>
      ) : null}
      {!session && !preview.accountExists ? (
        <ActionForm action={acceptInviteAction.bind(null, token)} className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
          <h2 className="font-heading text-2xl">Create your login</h2>
          <p className="text-sm text-muted-foreground">The login email is {preview.email}. It is not a field you can change.</p>
          <input type="hidden" name="mode" value="create" />
          <label className="text-sm">
            Your name
            <input name="name" required autoComplete="name" className="field mt-1" />
          </label>
          <label className="text-sm">
            New password
            <input name="password" type="password" required autoComplete="new-password" className="field mt-1" />
          </label>
          <Button type="submit" className="h-11">
            Create account and join
          </Button>
        </ActionForm>
      ) : null}
    </main>
  );
}
