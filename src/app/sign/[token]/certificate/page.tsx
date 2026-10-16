import { SignatureCertificate } from "@/components/signature-certificate";
import { signatureCertificateByToken } from "@/lib/services/doc-signatures";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PublicCertificatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const certificate = signatureCertificateByToken(token);
  if (!certificate) notFound();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 py-10">
      <SignatureCertificate certificate={certificate} />
    </main>
  );
}
