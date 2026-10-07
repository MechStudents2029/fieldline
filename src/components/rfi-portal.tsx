import { answerClientRfiAction, answerVendorRfiAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { formatCalendarDay } from "@/lib/format";
import type { PortalRfi } from "@/lib/services/rfis";

export function RfiPortal({ token, items, side }: { token: string; items: PortalRfi[]; side: "vendor" | "client" }) {
  if (items.length === 0) return null;
  const action = side === "vendor" ? answerVendorRfiAction : answerClientRfiAction;
  const fileQuery = side === "vendor" ? "vendor" : "portal";
  return (
    <section aria-label="RFIs">
      <h2>RFIs</h2>
      <ul className="home-stack">
        {items.map((item) => (
          <li key={item.id} className="home-card" data-rfi={item.title}>
            <div className="home-row">
              <div>
                <p className="home-copy">
                  {item.label} · {item.title}
                </p>
                <p className="home-sub">
                  {item.job}
                  {item.dueOn ? ` · ${formatCalendarDay(item.dueOn)}` : ""}
                </p>
              </div>
              <span className="home-pill">{item.statusLabel}</span>
            </div>
            <p className="home-copy mt-2">{item.question}</p>
            {item.messages.map((message) => (
              <p key={message.id} className="home-sub mt-2">
                {message.authorName}: {message.body}
              </p>
            ))}
            {item.canAnswer ? (
              <ActionForm action={action.bind(null, token, item.id)} className="mt-3 grid gap-2">
                <label className="home-sub">
                  Answer
                  <textarea name="body" aria-label={`Answer ${item.title}`} rows={2} className="field mt-1" required />
                </label>
                <label className="home-sub">
                  Photo
                  <input className="home-file" type="file" name="photo" accept="image/jpeg,image/png,image/webp" aria-label={`Photo ${item.title}`} />
                </label>
                <button type="submit" className="home-btn">
                  Send answer
                </button>
              </ActionForm>
            ) : null}
            {item.files.map((file) => (
              <a key={file.id} className="home-sub mt-2 block" href={`/api/files/${file.id}?${fileQuery}=${encodeURIComponent(token)}`}>
                {file.filename}
              </a>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
