import Link from "next/link";
import { AssemblyEditor } from "@/components/mac/assembly-editor";
import { MissingRecord } from "@/components/missing-record";
import { requireSession } from "@/lib/auth/session";
import { canSeeMoney } from "@/lib/permissions";
import { assemblyDetail } from "@/lib/services/read";

export default async function AssemblyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!canSeeMoney(session.role)) return <h1 className="mac-t15">Assembly</h1>;
  if (id === "new") {
    return (
      <div>
        <Link href="/price-book" className="estimate-back">
          ‹ Price book
        </Link>
        <AssemblyEditor assembly={{ id: null, name: "", drive: "area", parts: [] }} />
      </div>
    );
  }
  const detail = assemblyDetail(session.orgId, id);
  if (!detail) return <MissingRecord orgName={session.orgName} kind="record" />;
  return (
    <div>
      <Link href="/price-book" className="estimate-back">
        ‹ Price book
      </Link>
      <AssemblyEditor
        assembly={{
          id: detail.assembly.id,
          name: detail.assembly.name,
          drive: detail.assembly.drive,
          parts: detail.parts.map((part) => ({
            name: part.name,
            costCode: part.costCode,
            formula: part.formula,
            wasteBps: part.wasteBps,
            roundToMilli: part.roundToMilli,
            unit: part.unit,
            unitCostCents: part.unitCostCents,
          })),
        }}
      />
    </div>
  );
}
