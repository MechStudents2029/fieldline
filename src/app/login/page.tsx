import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { listLoginChoices } from "@/lib/services/read";
import { DEMO_PASSWORD, PRODUCT_TAGLINE } from "@/lib/product";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/");
  const people = listLoginChoices();
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-4 py-10 md:flex-row md:items-center md:px-8">
      <section className="flex-1">
        <p className="text-sm font-medium text-copper">Fieldline</p>
        <h1 className="font-heading mt-2 max-w-md text-4xl leading-tight md:text-5xl">The job file, from the first call to the last draw.</h1>
        <p className="mt-4 max-w-md text-muted-foreground">{PRODUCT_TAGLINE} This demo is Rivera Remodeling & Trade, with a second company so you can check tenancy.</p>
      </section>
      <section className="w-full max-w-md rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
        <h2 className="font-heading text-2xl">Sign in</h2>
        <p className="mt-1 text-sm text-muted-foreground">Password for every demo user is {DEMO_PASSWORD}.</p>
        <ActionForm action={loginAction} className="mt-4 flex flex-col gap-3">
          <label className="text-sm">
            Email
            <input name="email" type="email" required defaultValue="maya@rivera.demo" className="field mt-1" />
          </label>
          <label className="text-sm">
            Password
            <input name="password" type="password" required defaultValue={DEMO_PASSWORD} className="field mt-1" />
          </label>
          <Button type="submit" className="h-11">
            Enter the office
          </Button>
        </ActionForm>
        <ul className="mt-5 space-y-2 text-sm">
          {people.map((person) => (
            <li key={person.email} className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
              <span>
                <span className="font-medium">{person.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {person.orgName} · {person.role}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">{person.email}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
