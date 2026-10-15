import Link from "next/link";
import { saveOfficeCertificateAction } from "@/app/actions";
import { saveVendorTaxAction } from "@/app/(office)/reports/nec/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { MissingRecord } from "@/components/missing-record";
import { VendorLink } from "@/components/vendor-link";
import { requireSession } from "@/lib/auth/session";
import { formatCalendarDay, formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { canSeeMoney } from "@/lib/permissions";
import { CERT_TYPES } from "@/lib/vendor/compliance";
import { TAX_CLASSES } from "@/lib/tax/nec";
import { vendorTaxForm } from "@/lib/services/nec1099";
import { contactDetail } from "@/lib/services/read";
import { sourceName } from "@/lib/services/lead-sources";
import { vendorOffice } from "@/lib/services/vendor-portal";
import { outstandingWaivers } from "@/lib/services/waivers";
import { clientAgreements } from "@/lib/services/agreements";
import { clientOpenCredit } from "@/lib/services/client-credits";
import { openCreditBalance } from "@/lib/services/vendor-credits";
import { RecordFields } from "@/components/field-record";
import { fieldRows } from "@/lib/services/custom-fields";

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fields?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const session = await requireSession();
  const detail = contactDetail(session.orgId, id);
  if (!detail) return <MissingRecord orgName={session.orgName} kind="contact" />;
  const vendor = vendorOffice(session, id);
  const tax = vendor ? vendorTaxForm(session, id) : null;
  const waivers = canSeeMoney(session.role) ? outstandingWaivers(session, id) : [];
  const credits = canSeeMoney(session.role) ? openCreditBalance(session.orgId, id) : { cents: 0, count: 0 };
  const ownerCredits = canSeeMoney(session.role) && detail.contact.type === "client" ? clientOpenCredit(session.orgId, id) : { cents: 0, count: 0 };
  const agreements = detail.contact.type === "client" ? clientAgreements(session.orgId, id) : [];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
          <span>{detail.contact.type}</span>
          {sourceName(session.orgId, detail.contact.sourceId) ? <span className="fl-pill normal-case">{sourceName(session.orgId, detail.contact.sourceId)}</span> : null}
        </p>
        <h1 className="font-heading text-3xl">{detail.contact.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[detail.contact.company, detail.contact.email, detail.contact.phone, detail.contact.address, detail.contact.city].filter(Boolean).join(" · ")}
        </p>
        {detail.contact.notes ? <p className="mt-2 text-sm">{detail.contact.notes}</p> : null}
        <RecordFields
          rows={fieldRows(session, detail.contact.type === "client" ? "client" : "vendor", detail.contact.id, query.fields === "1" ? "edit" : "read")}
          recordType={detail.contact.type === "client" ? "client" : "vendor"}
          recordId={detail.contact.id}
          orgId={session.orgId}
          editing={query.fields === "1"}
          editHref={`/contacts/${detail.contact.id}?fields=1`}
          cancelHref={`/contacts/${detail.contact.id}`}
        />
        {vendor ? (
          <p className="mt-2">
            <span className="fl-pill" data-compliance={vendor.rollup.state}>
              {vendor.rollup.label}
            </span>
          </p>
        ) : null}
      </div>
      {agreements.length ? (
        <section aria-label="Agreements">
          <h2 className="mac-t13 font-semibold">Agreements</h2>
          <ul className="flex flex-col gap-1">
            {agreements.map((row) => (
              <li key={row.id} className="mac-t13">
                <Link href={`/agreements/${row.id}`}>{row.name}</Link>
                <span className="fl-pill ml-2">{row.statusLabel}</span>
                {row.nextOn ? <span className="num"> · {formatDate(row.nextOn)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {ownerCredits.count ? (
        <section aria-label="Credit memos">
          <h2 className="mac-t13 font-semibold">Credit memos</h2>
          <p className="mac-t13">
            <Link href={`/credit-memos?client=${id}`}>{ownerCredits.count} open</Link>
            <span className="num"> · {formatMoney(ownerCredits.cents)}</span>
          </p>
        </section>
      ) : null}
      {credits.count ? (
        <section aria-label="Credits">
          <h2 className="mac-t13 font-semibold">Credits</h2>
          <p className="mac-t13">
            <Link href={`/vendor-credits?vendor=${id}`}>{credits.count} open</Link>
            <span className="num"> · {formatMoney(credits.cents)}</span>
          </p>
        </section>
      ) : null}
      {vendor ? (
        <section className="flex flex-col gap-3" aria-label="Certificates">
          {vendor.canEdit ? <VendorLink contactId={vendor.contactId} hasPortal={vendor.hasPortal} /> : null}
          {tax ? (
            <div className="flex flex-col gap-2">
              <h2 className="mac-t13 font-semibold">Tax</h2>
              <p className="mac-t13">
                {tax.legalName || "—"}
                {tax.tinMask ? <span className="num"> · {tax.tinMask}</span> : null}
                {tax.exempt ? <span className="fl-pill ml-2">Exempt</span> : null}
              </p>
              {tax.canEdit ? (
                <ActionForm action={saveVendorTaxAction.bind(null, id)} className="flex flex-wrap items-end gap-2">
                  <label className="text-sm">
                    Legal name
                    <input name="legalName" aria-label="Legal name" defaultValue={tax.legalName} className="field mt-1" />
                  </label>
                  <label className="text-sm">
                    Class
                    <select name="taxClass" aria-label="Tax classification" className="field mt-1" defaultValue={tax.taxClass}>
                      <option value=""> </option>
                      {TAX_CLASSES.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    TIN
                    <input name="tin" aria-label="TIN" placeholder={tax.tinMask || "••-•••••••"} className="field mt-1 w-32" />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input name="exempt" type="checkbox" aria-label="Exempt from 1099" defaultChecked={tax.exempt} />
                    Exempt
                  </label>
                  <button type="submit" className="ctl">
                    Save
                  </button>
                </ActionForm>
              ) : null}
            </div>
          ) : null}
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
      {waivers.length > 0 ? (
        <section aria-label="Outstanding waivers">
          <h2 className="mac-t13 font-semibold">Waivers</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {waivers.map((row) => (
              <li key={row.id}>
                <Link href={`/bills/${row.billId}`} className="font-medium">
                  {row.billNumber}
                </Link>
                {" · "}
                {row.typeLabel}
                {row.pending ? <span className="fl-pill ml-2">{row.statusLabel}</span> : ` · ${row.statusLabel}`}
                <span className="num"> · {formatMoney(row.amountCents)} · {formatCalendarDay(row.throughDate)}</span>
              </li>
            ))}
          </ul>
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
