import { z } from "zod";
import { draftEstimate, type DraftEstimate, type PriceRef } from "@/lib/ai/estimate";

const modelSchema = z.object({
  title: z.string(),
  notes: z.string(),
  lines: z.array(
    z.object({
      code: z.string(),
      qty: z.number(),
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
});

/**
 * Prices come from the contractor's price book either way.
 * A gateway key may choose codes and quantities. If it is missing or the call fails, the local matcher runs.
 */
export async function estimateFromScope(input: {
  scope: string;
  photoNames: string[];
  book: PriceRef[];
  markupBps: number;
}): Promise<DraftEstimate> {
  const local = () =>
    draftEstimate({
      scope: input.scope,
      photoNames: input.photoNames,
      book: input.book,
      markupBps: input.markupBps,
    });

  if (!process.env.AI_GATEWAY_API_KEY) return local();

  try {
    const { generateObject, gateway } = await import("ai");
    const bookList = input.book
      .map((item) => `${item.code} | ${item.name} | ${item.unit} | ${item.category}`)
      .join("\n");
    const result = await generateObject({
      model: gateway(process.env.AI_ESTIMATE_MODEL || "anthropic/claude-sonnet-4.5"),
      schema: modelSchema,
      prompt: [
        "You are pricing a remodeling scope for a contractor.",
        "Use only price book codes from the list. Do not invent codes or prices.",
        "Quantities must be plain numbers in the unit shown.",
        "Confidence is 0 to 1.",
        "",
        "PRICE BOOK",
        bookList,
        "",
        "SCOPE",
        input.scope,
        "",
        "PHOTO FILE NAMES",
        input.photoNames.join(", ") || "(none)",
      ].join("\n"),
    });

    const byCode = new Map(input.book.map((item) => [item.code, item]));
    const lines = result.object.lines.flatMap((line) => {
      const item = byCode.get(line.code);
      if (!item || line.qty <= 0) return [];
      return [
        {
          code: item.code,
          name: item.name,
          category: item.category,
          unit: item.unit,
          qty: line.qty,
          unitCostCents: item.unitCostCents,
          markupBps: input.markupBps,
          confidence: Math.max(0, Math.min(1, line.confidence)),
          reason: line.reason,
          priceBookItemId: item.id,
        },
      ];
    });
    if (lines.length === 0) return local();

    const groups = new Map<string, typeof lines>();
    for (const line of lines) {
      const list = groups.get(line.category) ?? [];
      list.push(line);
      groups.set(line.category, list);
    }
    return {
      title: result.object.title || "Remodel estimate",
      sections: [...groups.entries()].map(([name, sectionLines]) => ({ name, lines: sectionLines })),
      notes: result.object.notes,
      model: process.env.AI_ESTIMATE_MODEL || "gateway",
    };
  } catch {
    return local();
  }
}
