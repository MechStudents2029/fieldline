import { z } from "zod";
import {
  draftEstimate,
  measurementsFromScope,
  normalizePhotos,
  reviewModelLine,
  type DraftEstimate,
  type EstimatePhoto,
  type PriceRef,
} from "@/lib/ai/estimate";

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

export function gatewayEstimatePrompt(input: {
  scope: string;
  book: PriceRef[];
  photos: EstimatePhoto[];
}): string {
  const bookList = input.book.map((item) => `${item.code} | ${item.name} | ${item.unit} | ${item.category}`).join("\n");
  const photoLines =
    input.photos.length > 0
      ? input.photos
          .map((photo) => {
            const name = photo.filename.trim() || "(unnamed)";
            const caption = photo.caption?.trim();
            return caption ? `${name} — ${caption}` : name;
          })
          .join("\n")
      : "(none)";
  return [
    "You are pricing a remodeling scope for a contractor.",
    "Use only price book codes from the list. Do not invent codes or prices.",
    "Quantities must be plain numbers in the unit shown.",
    "Confidence is 0 to 1.",
    "Photo captions and file names are clues. They are not a measured takeoff.",
    "If a line comes only from a photo, say so and keep confidence at or below 0.56.",
    "",
    "PRICE BOOK",
    bookList,
    "",
    "SCOPE",
    input.scope,
    "",
    "PHOTOS (file name and caption)",
    photoLines,
  ].join("\n");
}

/**
 * Prices come from the contractor's price book either way.
 * A gateway key may choose codes and quantities. If it is missing or the call fails, the local matcher runs.
 * Captions are text. This path does not send image bytes.
 */
export async function estimateFromScope(input: {
  scope: string;
  photoNames?: string[];
  photos?: EstimatePhoto[];
  book: PriceRef[];
  markupBps: number;
}): Promise<DraftEstimate> {
  const photos = normalizePhotos(input);
  const local = () =>
    draftEstimate({
      scope: input.scope,
      photos,
      book: input.book,
      markupBps: input.markupBps,
    });

  if (!process.env.AI_GATEWAY_API_KEY) return local();

  try {
    const { generateObject, gateway } = await import("ai");
    const result = await generateObject({
      model: gateway(process.env.AI_ESTIMATE_MODEL || "anthropic/claude-sonnet-4.5"),
      schema: modelSchema,
      prompt: gatewayEstimatePrompt({ scope: input.scope, book: input.book, photos }),
    });

    const byCode = new Map(input.book.map((item) => [item.code, item]));
    const lines = result.object.lines.flatMap((line) => {
      const item = byCode.get(line.code);
      if (!item || line.qty <= 0) return [];
      const reviewed = reviewModelLine({
        code: item.code,
        confidence: Math.max(0, Math.min(1, line.confidence)),
        reason: line.reason,
        scope: input.scope,
        photos,
      });
      return [
        {
          code: item.code,
          name: item.name,
          category: item.category,
          unit: item.unit,
          qty: line.qty,
          unitCostCents: item.unitCostCents,
          markupBps: input.markupBps,
          confidence: reviewed.confidence,
          reason: reviewed.reason,
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
      measurements: measurementsFromScope(input.scope),
    };
  } catch {
    return local();
  }
}
