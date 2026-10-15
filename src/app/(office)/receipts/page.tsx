import { ReceiptFrame } from "@/components/receipt-frame";
import { requireSession } from "@/lib/auth/session";
import { listCostReceipts } from "@/lib/services/cost-receipts";

const STATUSES = new Set(["new", "coded", "posted", "rejected"]);

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const raw = Array.isArray(query.status) ? query.status[0] : query.status;
  const status = raw && STATUSES.has(raw) ? raw : "new";
  const rows = listCostReceipts(session, status);
  return <ReceiptFrame title="Receipts" status={status} rows={rows} />;
}
