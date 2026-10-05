import Link from "next/link";
import { notFound } from "next/navigation";
import { approveCoAction, portalMessageAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { CONSENT_TEXT } from "@/lib/product";
import { formatCalendarDay } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { portalByToken } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (process.env.FIELDLINE_E2E === "1" && token === "e2e-crash") throw new Error("E2E portal crash check");
  const data = portalByToken(token);
  if (!data?.org || !data.contact) notFound();
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{data.org.name}</p>
      <h1 className="font-heading text-4xl">{data.project.name}</h1>
      <p className="text-sm text-muted-foreground">{data.project.address}</p>
      <p className="mt-2 text-sm">Hello {data.contact.name.split(" ")[0]}. This page is your copy of the job. No account needed.</p>
      {data.proposal ? (
        <p className="mt-4 text-sm">
          <Link className="underline" href={`/p/${data.proposal.publicToken}`}>
            View the signed proposal
          </Link>
        </p>
      ) : null}
      <section className="mt-6">
        <h2 className="font-medium">Invoices</h2>
        <ul className="mt-2 divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10">
          {data.invoices.length === 0 ? <li className="px-4 py-3 text-sm text-muted-foreground">No invoices yet.</li> : null}
          {data.invoices.map((invoice) => (
            <li key={invoice.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>
                {invoice.number} · {invoice.type}
                <span className="block text-xs text-muted-foreground">{invoice.status}</span>
              </span>
              {invoice.status === "open" ? (
                <Link href={`/pay/${invoice.payToken}`} className="underline">
                  Pay {formatMoney(invoice.totalCents)}
                </Link>
              ) : (
                <span>{formatMoney(invoice.totalCents)}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-6">
        <h2 className="font-medium">Change orders</h2>
        {data.orders.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">None yet.</p> : null}
        {data.orders.map((order) => (
          <article key={order.id} className="mt-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <p className="text-xs text-muted-foreground">CO {order.number} · {order.status}</p>
            <h3 className="font-medium">{order.title}</h3>
            <p className="text-sm">{order.description}</p>
            <p className="mt-1 text-sm">{formatMoney(order.priceDeltaCents)}</p>
            {order.status === "sent" ? (
              <ActionForm action={approveCoAction.bind(null, order.publicToken)} className="mt-3 flex flex-col gap-2">
                <input name="typedName" className="field font-heading text-xl" placeholder="Type your name" />
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" name="consent" className="mt-1" />
                  <span>{CONSENT_TEXT}</span>
                </label>
                <Button type="submit" className="h-11">
                  Approve change order
                </Button>
              </ActionForm>
            ) : null}
          </article>
        ))}
      </section>
      <section className="mt-6" aria-label="Daily log">
        <h2 className="font-medium">Daily log</h2>
        {data.logs.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No shared log yet.</p> : null}
        {data.logs.map((log) => (
          <article key={log.id} className="mt-3 rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
            <p className="text-xs text-muted-foreground">{formatCalendarDay(log.logDate)}</p>
            <p className="mt-1 whitespace-pre-wrap">{log.notes}</p>
            {log.plannedNext ? <p className="mt-2">Next: {log.plannedNext}</p> : null}
            {log.weatherSky || log.weatherHighF != null || log.weatherLowF != null ? (
              <p className="mt-2 text-muted-foreground">
                {log.weatherSky}
                {log.weatherHighF != null ? ` · high ${log.weatherHighF}°F` : ""}
                {log.weatherLowF != null ? ` · low ${log.weatherLowF}°F` : ""}
                {log.weatherLostMinutes ? ` · ${log.weatherLostMinutes} minutes lost to weather` : ""}
              </p>
            ) : null}
            {log.weatherImpact ? <p className="mt-1">{log.weatherImpact}</p> : null}
            {log.deliveries ? <p className="mt-2">Deliveries: {log.deliveries}</p> : null}
            {log.visitors ? <p className="mt-2">Visitors: {log.visitors}</p> : null}
            {log.photos.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {log.photos.map((photo) => (
                  <li key={photo.id}>
                    <a className="underline" href={`/api/files/${photo.id}?portal=${token}`}>
                      {photo.caption || "Photo"}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </section>
      <section className="mt-6">
        <h2 className="font-medium">Photos</h2>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {data.photos.map((photo) => (
            <img key={photo.id} src={photo.storagePath.startsWith("/") ? photo.storagePath : `/api/files/${photo.id}?portal=${token}`} alt={photo.filename} className="aspect-square rounded-lg object-cover" />
          ))}
        </div>
      </section>
      <section className="mt-6">
        <h2 className="font-medium">Messages</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {data.messages.map((message) => (
            <li key={message.id} className="rounded-lg bg-muted px-3 py-2 whitespace-pre-wrap">
              <span className="text-xs text-muted-foreground">{message.direction === "in" ? "You" : data.org?.name}</span>
              <p>{message.body}</p>
            </li>
          ))}
        </ul>
        <ActionForm action={portalMessageAction.bind(null, token)} className="mt-3 flex flex-col gap-2">
          <textarea name="body" rows={3} className="w-full rounded-lg border border-input bg-card p-3" placeholder="Reply to your contractor" />
          <Button type="submit" variant="outline">
            Send
          </Button>
        </ActionForm>
      </section>
    </main>
  );
}
