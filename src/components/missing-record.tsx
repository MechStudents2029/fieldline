import Link from "next/link";

export function MissingRecord({ orgName, kind }: { orgName: string; kind: string }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3 py-6">
      <h1 className="font-heading text-3xl">Not in {orgName}</h1>
      <p className="text-sm text-muted-foreground">
        This {kind} is not in the company you are signed into. Open the pipeline in this company, or sign in to the company that owns it.
      </p>
      <Link href="/" className="text-sm font-medium underline">
        Back to today
      </Link>
    </div>
  );
}
