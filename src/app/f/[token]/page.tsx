import { PublicLeadForm } from "@/components/public-lead-form";
import { publicLeadForm } from "@/lib/services/lead-form";

export const dynamic = "force-dynamic";

function formStarted() {
  return Date.now();
}

export default async function LeadFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ source?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const form = publicLeadForm(token);
  if (form.state !== "open") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-16">
        <div className="mb-6 h-1 w-10 bg-[var(--fl-accent)]" />
        {form.state === "disabled" ? <h1 className="font-heading text-2xl">{form.orgName}</h1> : <h1 className="font-heading text-2xl">Request</h1>}
        <p className="mt-3 text-base">Not taking requests.</p>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-10">
      <div className="h-1 w-10 bg-[var(--fl-accent)]" />
      <h1 className="mt-6 font-heading text-2xl">{form.orgName}</h1>
      {form.intro ? <p className="mt-2 text-sm text-[var(--mac-secondary)]">{form.intro}</p> : null}
      <PublicLeadForm
        token={form.token}
        thanks={form.thanks}
        fields={form.fields}
        projectTypes={form.projectTypes}
        startedAt={formStarted()}
        source={query.source ?? ""}
        utmSource={query.utm_source ?? ""}
        utmMedium={query.utm_medium ?? ""}
        utmCampaign={query.utm_campaign ?? ""}
      />
    </main>
  );
}
