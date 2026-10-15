import { notFound } from "next/navigation";
import { LienSheet } from "@/components/lien-sheet";
import { requireSession } from "@/lib/auth/session";
import { lienPrint } from "@/lib/services/liens";

export default async function PreliminaryNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const doc = lienPrint(session, id, "prelim");
  if (!doc) notFound();
  return <LienSheet doc={doc} back={`/projects/${id}`} />;
}
