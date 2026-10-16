import type { PortalHandover } from "@/lib/services/handover";

function photoSrc(id: string, token: string) {
  return `/api/files/${id}?portal=${encodeURIComponent(token)}`;
}

export function PortalHandoverSection({ token, pack }: { token: string; pack: PortalHandover }) {
  const care = pack.sections.flatMap((section) => section.items.filter((item) => item.nextDueOn).map((item) => ({ ...item, section: section.title })));
  return (
    <section aria-label="Handover">
      <h2>Handover</h2>
      {pack.warrantyEndsOn ? <p className="home-sub">{pack.warrantyEndsOn}</p> : null}
      {pack.sections.map((section) => (
        <div key={section.id} className="mt-4">
          <h3 className="home-strong">{section.title}</h3>
          <ul className="home-stack">
            {section.items.map((item) => (
              <li key={item.id} className="home-card" data-item={item.title}>
                <p className="home-copy">{item.title}</p>
                <p className="home-sub">{[item.manufacturer, item.model, item.serial, item.finish, item.vendorName, item.trade, item.phone].filter(Boolean).join(" · ")}</p>
                {item.warrantyEndsOn ? <p className="home-sub">{item.warrantyEndsOn}</p> : null}
                {item.nextDueOn ? <p className="home-sub">{item.intervalLabel || "Care"} · {item.nextDueOn}</p> : null}
                {item.documentId ? (
                  <a href={photoSrc(item.documentId, token)} className="home-sub">
                    {item.documentName || "Document"}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {care.length > 0 ? (
        <div className="mt-4">
          <h3 className="home-strong">Care</h3>
          <ul className="home-stack">
            {care.map((item) => (
              <li key={item.id} className="home-card">
                <p className="home-copy">{item.title}</p>
                <p className="home-sub">{item.nextDueOn}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
