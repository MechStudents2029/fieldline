import Link from "next/link";
import { saveOfficeCertificateAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { MissingRecord } from "@/components/missing-record";
import { VendorLink } from "@/components/vendor-link";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { CERT_TYPES } from "@/lib/vendor/compliance";
import { contactDetail } from "@/lib/services/read";
import { vendorOffice } from "@/lib/services/vendor-portal";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const detail = contactDetail(session.orgId, id);
  if (!detail) return <MissingRecord orgName={session.orgName} kind="contact" />;
  const vendor = vendorOffice(session, id);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs uppercase text-muted-foreground">{detail.contact.type}</p>
        <h1 className="font-heading text-3xl">{detail.contact.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[detail.contact.company, detail.contact.email, detail.contact.phone, detail.contact.address, detail.contact.city].filter(Boolean).join(" · ")}
        </p>
        {detail.contact.notes ? <p className="mt-2 text-sm">{detail.contact.notes}</p> : null}
        {vendor ? (
          <p className="mt-2">
            <span className="fl-pill" data-compliance={vendor.rollup.state}>
              {vendor.rollup.label}
            </span>
          </p>
        ) : null}
      </div>
      {vendor ? (
        <section className="flex flex-col gap-3" aria-label="Certificates">
          {vendor.canEdit ? <VendorLink contactId={vendor.contactId} hasPortal={vendor.hasPortal} /> : null}
          <h2 className="mac-t13 font-semibold">Certificates</h2>
          <ul className="flex flex-col gap-2">
            {vendor.certificates.map((row) => (
              <li key={row.type} className="flex items-center justify-between gap-3" data-cert={row.type}>
                <span className="text-sm">{row.label}</span>
                <span className="fl-pill">{row.statusLabel}</span>
              </li>
            ))}
          </ul>
          {vendor.canEdit ? (
            <ActionForm action={saveOfficeCertificateAction.bind(null, vendor.contactId)} className="flex flex-col gap-2">
              <label className="text-sm">
                Type
                <select name="type" aria-label="Certificate type" className="field mt-1" defaultValue="workers_comp">
                  {CERT_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Expires
                <input name="expiresOn" type="date" required aria-label="Expires" className="field mt-1" />
              </label>
              <FileButton name="file" label="Certificate file" accept="image/jpeg,image/png,image/webp" empty="Certificate" />
              <button type="submit" className="mac-primary w-fit">
                Save certificate
              </button>
            </ActionForm>
          ) : null}
        </section>
      ) : null}
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
