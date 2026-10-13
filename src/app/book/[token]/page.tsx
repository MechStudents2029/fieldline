import { notFound } from "next/navigation";
import { bookAction } from "@/app/book/actions";
import { ActionForm } from "@/components/action-form";
import { publicBooking } from "@/lib/services/booking";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || "";
}

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const data = publicBooking(token, { service: one(query.service), day: one(query.day) });
  if (!data) notFound();
  const booked = one(query.booked) === "1";
  const chosen = data.days.find((day) => day.day === data.day);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-10">
      <div className="h-1 w-10 bg-[var(--fl-accent)]" />
      <h1 className="mt-6 font-heading text-2xl">{data.orgName}</h1>
      {data.state === "closed" ? <p className="mt-3 text-base">Not taking bookings.</p> : null}
      {booked ? (
        <p className="mt-6 text-base" data-testid="booking-done">
          Booked {one(query.day)} {one(query.at)} · {one(query.who)}
        </p>
      ) : null}
      {data.state === "open" && !booked ? (
        <>
          <nav className="mt-6 flex flex-wrap gap-2" aria-label="Services" data-testid="booking-services">
            {data.services.map((service) => (
              <a key={service.id} href={`/book/${token}?service=${service.id}`} className={service.id === data.serviceId ? "mac-primary" : "mac-glass-btn"} aria-current={service.id === data.serviceId ? "page" : undefined}>
                {service.name} · {service.duration}
                {service.price ? ` · ${service.price}` : ""}
              </a>
            ))}
          </nav>
          {data.serviceId ? (
            <nav className="mt-4 flex flex-wrap gap-2" aria-label="Days" data-testid="booking-days">
              {data.days.map((day) => (
                <a key={day.day} href={`/book/${token}?service=${data.serviceId}&day=${day.day}`} className={day.day === data.day ? "mac-primary" : "mac-glass-btn"} aria-current={day.day === data.day ? "page" : undefined}>
                  {day.label}
                </a>
              ))}
            </nav>
          ) : null}
          {chosen ? (
            <div className="mt-4 flex flex-wrap gap-2" data-testid="booking-slots">
              {chosen.slots.map((slot) => (
                <a key={slot.startMin} href={`/book/${token}?service=${data.serviceId}&day=${chosen.day}&at=${slot.startMin}`} className={String(slot.startMin) === one(query.at) ? "mac-primary" : "mac-glass-btn"} data-start={slot.startMin}>
                  {slot.label}
                </a>
              ))}
            </div>
          ) : null}
          {chosen && one(query.at) ? (
            <ActionForm action={bookAction.bind(null, token)} className="mt-6 grid max-w-md gap-3">
              <input type="hidden" name="itemId" value={data.serviceId} />
              <input type="hidden" name="day" value={chosen.day} />
              <input type="hidden" name="startMin" value={one(query.at)} />
              <label className="text-[13px]">
                Name
                <input name="name" required aria-label="Name" className="field mt-1" />
              </label>
              <label className="text-[13px]">
                Phone
                <input name="phone" required aria-label="Phone" className="field mt-1" />
              </label>
              <label className="text-[13px]">
                Email
                <input name="email" type="email" required aria-label="Email" className="field mt-1" />
              </label>
              {data.questions.map((question) => (
                <label key={question.id} className="text-[13px]">
                  {question.label}
                  <input name={`a_${question.id}`} aria-label={question.label} className="field mt-1" />
                </label>
              ))}
              <button type="submit" className="mac-primary w-fit">Book</button>
            </ActionForm>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
