import { notFound } from "next/navigation";
import { VendorPortalView } from "@/components/vendor-portal-view";
import { vendorPortalFiles } from "@/lib/services/files";
import { vendorPortalWaivers } from "@/lib/services/waivers";
import { vendorBidPortal } from "@/lib/services/bids";
import { vendorPortalRfis } from "@/lib/services/rfis";
import { vendorPortalSubmittals } from "@/lib/services/submittals";
import { vendorPortal } from "@/lib/services/vendor-portal";
import { vendorInspectionRows } from "@/lib/services/permits";
import { vendorTodos } from "@/lib/services/todos";

export const dynamic = "force-dynamic";

export default async function VendorPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const home = vendorPortal(token);
  if (!home) notFound();
  const bids = vendorBidPortal(token) ?? [];
  return (
    <VendorPortalView
      token={token}
      home={home}
      bids={bids}
      rfis={vendorPortalRfis(token)}
      todos={vendorTodos(token)}
      inspections={vendorInspectionRows(token)}
      submittals={vendorPortalSubmittals(token)}
      waivers={vendorPortalWaivers(token) ?? []}
      files={vendorPortalFiles(token) ?? []}
    />
  );
}
