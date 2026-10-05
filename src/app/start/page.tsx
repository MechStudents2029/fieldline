import Link from "next/link";
import { redirect } from "next/navigation";
import { signupAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { STARTER_TRADE_LABELS, STARTER_TRADES, US_STATES } from "@/lib/security";
import { supabaseAuthConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function StartPage() {
  const session = await getSession();
  if (session) redirect("/");
  const supabase = supabaseAuthConfigured();
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 py-10">
      <div>
        <p className="text-sm font-medium text-copper">Fieldline</p>
        <h1 className="font-heading mt-2 text-4xl">Start a new company</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This opens an empty office for you. It does not copy the Rivera demo or any other company. You can sign in to the demo separately.
        </p>
        {supabase ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Sign-up uses your Supabase project. If that project asks you to confirm the email, this page will say so. Fieldline does not send its own confirmation.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">You will be signed in on this browser. No confirmation email is sent.</p>
        )}
      </div>
      <ActionForm action={signupAction} className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
        <label className="text-sm">
          Owner name
          <input name="ownerName" required autoComplete="name" className="field mt-1" />
        </label>
        <label className="text-sm">
          Work email
          <input name="email" type="email" required autoComplete="email" className="field mt-1" />
        </label>
        <label className="text-sm">
          New password
          <input name="password" type="password" required autoComplete="new-password" minLength={8} className="field mt-1" />
        </label>
        <label className="text-sm">
          Company name
          <input name="companyName" required className="field mt-1" />
        </label>
        <label className="text-sm">
          Trade
          <select name="trade" defaultValue="remodel" className="field mt-1">
            {STARTER_TRADES.map((trade) => (
              <option key={trade} value={trade}>
                {STARTER_TRADE_LABELS[trade]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          State
          <select name="state" defaultValue="CA" className="field mt-1">
            {US_STATES.map((state) => (
              <option key={state.code} value={state.code}>
                {state.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="starter" defaultChecked className="mt-1" />
          <span>Include a starter price book. These are sample costs. Edit your prices.</span>
        </label>
        <Button type="submit" className="h-11">
          Create company
        </Button>
      </ActionForm>
      <p className="text-sm">
        <Link href="/login" className="underline">
          Sign in to the demo instead
        </Link>
      </p>
    </main>
  );
}
