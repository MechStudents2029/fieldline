import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { contactDetail } from "@/lib/services/read";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await getSession())!;
  const detail = contactDetail(session.orgId, id);
  if (!detail) notFound();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs uppercase text-muted-foreground">{detail.contact.type}</p>
        <h1 className="font-heading text-3xl">{detail.contact.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[detail.contact.company, detail.contact.email, detail.contact.phone, detail.contact.address, detail.contact.city].filter(Boolean).join(" · ")}
        </p>
        {detail.contact.notes ? <p className="mt-2 text-sm">{detail.contact.notes}</p> : null}
      </div>
      <section>
        <h2 className="font-medium">Deals and jobs</h2>
        <ul className="mt-2 text-sm">
          {detail.leads.map((lead) => (
            <li key={lead.id}>
              <Link href={`/leads/${lead.id}`} className="underline">
                {lead.title}
              </Link>{" "}
              · {lead.status}
            </li>
          ))}
          {detail.projects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`} className="underline">
                {project.name}
              </Link>{" "}
              · {project.status}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-medium">Messages</h2>
        {detail.messages.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No messages yet.</p> : null}
        <ul className="mt-2 space-y-3 text-sm">
          {detail.messages.map((message) => (
            <li key={message.id}>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(message.createdAt)} · {message.direction} · {message.channel} · {message.status}
              </span>
              <p className="whitespace-pre-wrap">{message.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
