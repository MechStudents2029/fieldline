import QRCode from "qrcode";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth/session";
import { labelItems } from "@/lib/services/equipment";

export default async function EquipmentLabelsPage() {
  const session = await requireSession();
  const items = labelItems(session);
  const header = await headers();
  const host = header.get("x-forwarded-host") || header.get("host") || "127.0.0.1";
  const proto = header.get("x-forwarded-proto") || "http";
  const tags = await Promise.all(
    items.map(async (item) => ({
      ...item,
      svg: await QRCode.toString(`${proto}://${host}/equipment?item=${item.id}`, { type: "svg", margin: 0, width: 96 }),
    })),
  );
  return (
    <main className="mx-auto grid max-w-3xl grid-cols-2 gap-4 bg-white p-6 text-black print:max-w-none md:grid-cols-3">
      <h1 className="col-span-full text-[15px] font-semibold">Equipment</h1>
      {tags.map((item) => (
        <article key={item.id} className="flex flex-col items-center gap-1 border border-neutral-300 p-3">
          <span className="text-[13px] font-semibold">{item.name}</span>
          <span className="text-[12px]">{item.tag}</span>
          <span dangerouslySetInnerHTML={{ __html: item.svg }} />
        </article>
      ))}
    </main>
  );
}
