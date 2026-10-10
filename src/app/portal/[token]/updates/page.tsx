import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { formatCalendarDay } from "@/lib/format";
import { portalClientUpdates } from "@/lib/services/client-updates";
import { splitUpdateBody, UPDATE_SECTION_KEYS, sectionTitle } from "@/lib/updates/draft";

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
        <p className="home-back">
          <Link href={`/portal/${token}`}>‹ Job</Link>
        </p>
        <p className="home-company">{data.orgName}</p>
        <h1 className="home-title">Updates</h1>
        <p className="home-sub">{data.projectName}</p>
      </header>
      {data.updates.length === 0 ? <p className="home-sub">No updates yet</p> : null}
      <div className="home-stack">
        {data.updates.map((update) => {
          const sections = splitUpdateBody(update.body);
          const captions = new Map(update.photos.map((photo) => [photo.id, photo.caption || "Photo"]));
          return (
            <article key={update.id} className="home-card update-portal">
              <p className="home-sub">
                {formatCalendarDay(update.rangeStart)} – {formatCalendarDay(update.rangeEnd)}
              </p>
              {UPDATE_SECTION_KEYS.filter((key) => key !== "photos").map((key) => (
                <section key={key}>
                  <h2>{sectionTitle(key)}</h2>
                  <p>{sections[key] || "Nothing to report."}</p>
                </section>
              ))}
              {update.photos.length > 0 ? (
                <section>
                  <h2>Photos</h2>
                  {update.photos.map((photo) => (
                    <figure key={photo.id} className="home-update-photo">
                      <img src={photoSrc(photo.id, token)} alt="" />
                      <figcaption>{captions.get(photo.id)}</figcaption>
                    </figure>
                  ))}
                </section>
              ) : null}
            </article>
          );
        })}
      </div>
    </main>
  );
}
