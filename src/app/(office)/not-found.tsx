import Link from "next/link";

export default function OfficeNotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3 py-8">
      <h1 className="font-heading text-3xl">Not in this company</h1>
      <p className="text-sm text-muted-foreground">
        That record is not in the company you are signed into. A second company cannot open another company’s leads, jobs, or estimates.
      </p>
      <Link href="/" className="text-sm font-medium underline">
        Back to today
      </Link>
    </div>
  );
}
