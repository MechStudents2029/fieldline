import Link from "next/link";
import { notFound } from "next/navigation";
import { SignatureCertificate } from "@/components/signature-certificate";
import { requireSession } from "@/lib/auth/session";
import { officeCertificate } from "@/lib/services/doc-signatures";

export const dynamic = "force-dynamic";

export default async function OfficeCertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const certificate = officeCertificate(session, id);
  if (!certificate) notFound();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 py-10">
      <Link href={`/signatures/${id}`} className="text-sm text-[var(--mac-accent)]">
        ‹
      </Link>
      <SignatureCertificate certificate={certificate} />
    </main>
  );
}
