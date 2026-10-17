import { delayPackageByToken } from "@/lib/services/delays";

export const dynamic = "force-dynamic";

export default async function PublicDelayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pack = delayPackageByToken(token);
  if (!pack) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-16">
        <h1 className="font-heading text-2xl">Delay</h1>
        <p className="mt-3 text-base">That package is not here.</p>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-10">
      <div className="h-1 w-10 bg-[var(--fl-accent)]" />
      <h1 className="mt-6 font-heading text-2xl">{pack.title}</h1>
      <p className="mt-2 text-sm">
        {pack.orgName} · {pack.job} · {pack.number}
      </p>
      <p className="mt-3 text-sm">
        {pack.causeLabel} · {pack.impactLabel} · {pack.scheduleDays}d
      </p>
      <p className="mt-1 text-sm">
        {pack.startedAt} – {pack.endedAt}
      </p>
      {pack.weatherNote ? <p className="mt-3 text-sm">{pack.weatherNote}</p> : null}
      <p className="mt-3 text-sm num">
        {pack.lostHours}h lost · {pack.idleHours}h idle
      </p>
      <ul className="mt-3 text-sm">
        {pack.labor.map((row) => (
          <li key={`${row.label}-${row.hours}`}>
            {row.label} · {row.hours}h
          </li>
        ))}
      </ul>
      {pack.photos.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {pack.photos.map((photo) => (
            <li key={photo.id}>
              <a href={photo.href} className="text-[var(--fl-accent)]">
                {photo.filename}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
