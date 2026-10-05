import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="text-sm font-medium text-copper">Fieldline</p>
      <h1 className="font-heading mt-2 text-4xl">That page is not in this job file.</h1>
      <p className="mt-3 text-muted-foreground">The link may have expired, or it belongs to another company.</p>
      <Link href="/" className="mt-6 text-sm font-medium underline">
        Back to today
      </Link>
    </main>
  );
}
