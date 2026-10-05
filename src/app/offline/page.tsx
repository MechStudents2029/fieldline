import { OfflineBanner } from "@/components/offline-banner";
import { OfflineClock } from "@/components/offline-clock";

export const dynamic = "force-static";

export const metadata = {
  title: "Time",
};

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-4 px-4 py-6">
      <span id="fieldline-offline-shell" hidden />
      <p className="font-heading text-2xl tracking-tight text-pine">Fieldline</p>
      <h1 className="font-heading text-3xl">Time</h1>
      <p className="text-sm text-muted-foreground">
        Clock in, breaks, job switches, clock out, and daily log notes save on this phone and sync later. Photos, approvals, and manual time stay online.
      </p>
      <OfflineBanner />
      <OfflineClock />
    </main>
  );
}
