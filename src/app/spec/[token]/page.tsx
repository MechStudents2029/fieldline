import { headers } from "next/headers";
import { SpecPublic } from "@/components/spec-public";
import { publicSpec } from "@/lib/services/job-specs";

export const dynamic = "force-dynamic";

export default async function PublicSpecPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const pack = publicSpec(token, ip);
  if (pack.state === "missing") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-16">
        <h1 className="font-heading text-2xl">Specifications</h1>
        <p className="mt-3 text-base">That spec is not here.</p>
      </main>
    );
  }
  if (pack.state === "limited") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-16" data-status="limited">
        <h1 className="font-heading text-2xl">Specifications</h1>
        <p className="mt-3 text-base">Try again later.</p>
      </main>
    );
  }
  if (pack.state === "unpublished") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-16" data-status="unpublished">
        <div className="mb-6 h-1 w-10 bg-[var(--fl-accent)]" />
        <h1 className="font-heading text-2xl">{pack.orgName}</h1>
        <p className="mt-3 text-base">Not published.</p>
      </main>
    );
  }
  return <SpecPublic pack={pack} />;
}
