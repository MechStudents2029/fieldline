import { notFound } from "next/navigation";
import { VendorPortalView } from "@/components/vendor-portal-view";
import { vendorBidPortal } from "@/lib/services/bids";
import { vendorPortalRfis } from "@/lib/services/rfis";
import { vendorPortal } from "@/lib/services/vendor-portal";
import { vendorTodos } from "@/lib/services/todos";

export const dynamic = "force-dynamic";

export default async function VendorPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const home = vendorPortal(token);
  if (!home) notFound();
  const bids = vendorBidPortal(token) ?? [];
  return <VendorPortalView token={token} home={home} bids={bids} rfis={vendorPortalRfis(token)} todos={vendorTodos(token)} />;
}
