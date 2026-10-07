import { submitWarrantyAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { formatDate, formatWarrantyDay } from "@/lib/format";
import type { PortalWarranty } from "@/lib/services/punch";

function photoSrc(id: string, token: string) {
  return `/api/files/${id}?portal=${encodeURIComponent(token)}`;
}

export function PortalWarrantySection({ token, home, startedAt }: { token: string; home: PortalWarranty; startedAt: number }) {
  return (
    <>
      {home.punch.length > 0 ? (
        <section aria-label="Punch">
          <h2>Punch</h2>
          <ul className="home-stack">
            {home.punch.map((item) => (
              <li key={item.id} className="home-card">
                <p className="home-copy">{item.title}</p>
                <p className="home-sub">{[item.location, item.statusLabel].filter(Boolean).join(" · ")}</p>
                {item.beforeDocumentId ? <img src={photoSrc(item.beforeDocumentId, token)} alt="" className="mt-2 max-h-40 rounded-lg" /> : null}
                {item.afterDocumentId ? <img src={photoSrc(item.afterDocumentId, token)} alt="" className="mt-2 max-h-40 rounded-lg" /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    <section id="warranty" aria-label="Warranty" data-warranty={home.open ? "open" : "closed"} hidden={!home.closed}>
      <h2>Warranty</h2>
      {home.endsOn ? (
        <p className="home-sub">
          Ends <span data-warranty-end={home.endsOn}>{formatWarrantyDay(home.endsOn)}</span>
        </p>
      ) : null}
      {home.requests.length > 0 ? (
        <ul className="home-stack">
          {home.requests.map((request) => (
            <li key={request.id} className="home-card">
              <p className="home-copy">{request.title}</p>
              <p className="home-sub">
                {request.statusLabel}
                {request.visitDate ? ` · ${formatDate(request.visitDate)}` : ""}
              </p>
              {request.description ? <p className="home-copy">{request.description}</p> : null}
              {request.clientNote ? <p className="home-copy">{request.clientNote}</p> : null}
              {request.photos.map((id) => (
                <img key={id} src={photoSrc(id, token)} alt="" className="mt-2 max-h-40 rounded-lg" />
              ))}
            </li>
          ))}
        </ul>
      ) : null}
      {home.open ? (
        <ActionForm action={submitWarrantyAction.bind(null, token)} className="home-form">
          <input type="hidden" name="startedAt" value={String(startedAt)} />
          <div className="absolute left-[-9999px] h-0 overflow-hidden" aria-hidden="true">
            <input name="hp_field" tabIndex={-1} autoComplete="off" defaultValue="" />
          </div>
          <label className="text-sm">
            Title
            <input name="title" required className="home-input" />
          </label>
          <label className="text-sm">
            Description
            <textarea name="description" rows={3} className="home-input" />
          </label>
          <label className="text-sm">
            Urgency
            <select name="urgency" className="home-input" defaultValue="normal">
              <option value="normal">Normal</option>
              <option value="soon">Soon</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label className="home-sub">
            Photo
            <input className="home-file" type="file" name="photo" accept="image/jpeg,image/png,image/webp" multiple />
          </label>
          <button type="submit" className="home-btn">
            Send request
          </button>
        </ActionForm>
      ) : null}
    </section>
    </>
  );
}
