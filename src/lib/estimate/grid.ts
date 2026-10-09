import { z } from "zod";
import { lineInputError } from "@/lib/money";
import type { Billing } from "@/lib/estimate/pricing";

const billingSchema = z.enum(["included", "optional", "allowance", "excluded"]);

const lineSchema = z.object({
  id: z.string().regex(/^li_[A-Za-z0-9_-]{1,80}$/),
  sectionId: z.string().regex(/^sec_[A-Za-z0-9_-]{1,80}$/),
  name: z.string().trim().min(1).max(180),
  qty: z.number().finite(),
  unit: z.string().trim().min(1).max(12),
  unitCostCents: z.number().int(),
  markupBps: z.number().int(),
  billing: billingSchema,
  costCode: z.string().trim().max(40).nullable(),
  sortOrder: z.number().int().min(0).max(100_000),
  formula: z.string().trim().max(80).nullable().optional(),
  wasteBps: z.number().int().min(0).max(10_000).optional(),
  roundToMilli: z.number().int().positive().max(1_000_000_000).nullable().optional(),
  groupId: z.string().max(80).nullable().optional(),
  qtyOverridden: z.boolean().optional(),
});

export const gridSyncSchema = z.object({
  estimateId: z.string().trim().min(1).max(80),
  lines: z.array(lineSchema).max(200),
  deletedIds: z.array(z.string().regex(/^li_[A-Za-z0-9_-]{1,80}$/)).max(200),
  marginTargetBps: z.number().int().min(0).max(9000).optional(),
});

export type GridSync = z.infer<typeof gridSyncSchema>;
export type GridSyncLine = GridSync["lines"][number] & { billing: Billing };

/** Rejects a grid save that would store a blank, negative, or absurd line. */
export function parseGridSync(input: unknown): GridSync {
  const parsed = gridSyncSchema.safeParse(input);
  if (!parsed.success) throw new Error("Check the line.");
  for (const line of parsed.data.lines) {
    const invalid = lineInputError({ qty: line.qty, unitCostCents: line.unitCostCents, markupBps: line.markupBps });
    if (invalid) throw new Error(invalid);
  }
  const ids = new Set<string>();
  for (const line of parsed.data.lines) {
    if (ids.has(line.id)) throw new Error("Check the line.");
    ids.add(line.id);
  }
  return parsed.data;
}
