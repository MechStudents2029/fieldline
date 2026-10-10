import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PhotoLightbox } from "@/components/portal/photo-lightbox";
import { formatCalendarDay } from "@/lib/format";
import { portalClientUpdates } from "@/lib/services/client-updates";

export const dynamic = "force-dynamic";

function photoSrc(id: string, token: string) {
  return `/api/files/${id}?portal=${encodeURIComponent(token)}`;
}

export default async function PortalUpdatesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const data = portalClientUpdates(token, ip);
  if (!data) notFound();
  return (
    <main className="home mx-auto min-h-screen w-full max-w-3xl px-4 py-8">
      <header>
        <p className="home-company">{data.orgName}</p>
        <h1 className="home-title">Updates</h1>
        <p className="home-sub">{data.projectName}</p>
        <p className="home-sub">
          <Link className="home-link" href={`/portal/${token}`}>
            Job
          </Link>
        </p>
      </header>
      {data.updates.length === 0 ? <p className="home-sub">No updates yet</p> : null}
      <div className="home-stack">
        {data.updates.map((update) => (
          <article key={update.id} className="home-card">
            <p className="home-sub">
              {formatCalendarDay(update.rangeStart)} – {formatCalendarDay(update.rangeEnd)}
            </p>
            <p className="home-copy">{update.body}</p>
            {update.photos.length > 0 ? (
              <PhotoLightbox
                photos={update.photos.map((photo) => ({
                  id: photo.id,
                  src: photoSrc(photo.id, token),
                  alt: photo.caption || "Photo",
                }))}
              />
            ) : null}
          </article>
        ))}
      </div>
    </main>
  );
}
