import { notFound } from "next/navigation";
import { VendorPortalView } from "@/components/vendor-portal-view";
import { vendorPortal } from "@/lib/services/vendor-portal";

export const dynamic = "force-dynamic";

export default async function VendorPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const home = vendorPortal(token);
  if (!home) notFound();
  return <VendorPortalView token={token} home={home} />;
}
