import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { openNotification } from "@/lib/services/comments";

export default async function OpenInboxItem({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const href = openNotification(session, id);
  if (!href) notFound();
  redirect(href);
}
