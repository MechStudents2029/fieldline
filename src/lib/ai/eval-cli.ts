import { draftEstimate, draftToTotals } from "@/lib/ai/estimate";
import { riveraCatalog } from "@/lib/db/catalog";
import { formatMoney, lineAmounts, qtyToMilli } from "@/lib/money";

const book = riveraCatalog().map((item) => ({ ...item, defaultMarkupBps: 3500 }));

const cases = [
  {
    name: "Vasquez kitchen",
    scope:
      "Elena Vasquez, 240 sq ft kitchen, gut, new cabinets, quartz, 14 linear ft of base cabinets. Relocate the sink. Paint. Recessed lights. Budget $60–80k.",
    photos: ["vasquez-cabinets.svg", "vasquez-floor.svg", "vasquez-sink.svg"],
    low: 6_000_000,
    high: 8_500_000,
  },
  {
    name: "Hall bath",
    scope: "Gut a 60 sq ft hall bath. New tile shower, vanity, and paint.",
    photos: ["okonkwo-shower.svg"],
    low: 800_000,
    high: 6_000_000,
  },
  {
    name: "Deck stain",
    scope: "Stain and wash a 320 sq ft deck. No structural work.",
    photos: ["diaz-deck.svg"],
    low: 100_000,
    high: 2_000_000,
  },
];

let failed = 0;
for (const item of cases) {
  const draft = draftEstimate({
    scope: item.scope,
    photoNames: item.photos,
    book,
    markupBps: 3500,
  });
  const totals = draftToTotals(draft, lineAmounts, qtyToMilli);
  const lines = draft.sections.flatMap((section) => section.lines);
  const low = lines.filter((line) => line.confidence < 0.7);
  const inside = totals.price >= item.low && totals.price <= item.high;
  if (!inside) failed += 1;
  console.log(
    `${inside ? "ok" : "OUT"}  ${item.name}  ${formatMoney(totals.price)}  (${lines.length} lines, ${low.length} under 70%)`,
  );
  for (const line of lines) {
    console.log(`     ${line.code}  qty ${line.qty}  conf ${line.confidence}  ${line.reason}`);
  }
}

const captionOnly = draftEstimate({
  scope: "Repaint the hall closet.",
  photos: [{ filename: "site.jpg", caption: "tile shower" }],
  book,
  markupBps: 3500,
});
const shower = captionOnly.sections.flatMap((section) => section.lines).find((line) => line.code === "TILE-SHOWER");
const captionOk =
  shower != null &&
  shower.confidence <= 0.56 &&
  /site photo/i.test(shower.reason) &&
  /site check/i.test(shower.reason);
console.log(`${captionOk ? "ok" : "OUT"}  caption-only shower  conf ${shower?.confidence ?? "missing"}`);
if (!captionOk) failed += 1;

if (failed > 0) {
  console.error(`${failed} case(s) outside the expected band.`);
  process.exit(1);
}
