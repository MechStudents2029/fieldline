import { headers } from "next/headers";
import { SpecPublic } from "@/components/spec-public";
import { publicSpec } from "@/lib/services/job-specs";

export const dynamic = "force-dynamic";

export default async function PublicSpecPrintPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const pack = publicSpec(token, ip);
  if (pack.state !== "published") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-16">
        <h1 className="font-heading text-2xl">Specifications</h1>
        <p className="mt-3 text-base">Not published.</p>
      </main>
    );
  }
  return <SpecPublic pack={pack} />;
}
