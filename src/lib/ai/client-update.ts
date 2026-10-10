import { z } from "zod";
import { draftClientUpdate, UPDATE_SECTION_KEYS, type ClientUpdateDraft, type ClientUpdateFacts } from "@/lib/updates/draft";

const sourceSchema = z.object({
  kind: z.enum(["log", "schedule", "change_order", "invoice", "selection", "photo"]),
  id: z.string().min(1),
});

export const clientUpdateModelSchema = z.object({
  sections: z.array(
    z.object({
      key: z.enum(UPDATE_SECTION_KEYS),
      title: z.string().min(1),
      sentences: z.array(
        z.object({
          text: z.string().min(1),
          source: sourceSchema.nullable(),
        }),
      ),
    }),
  ),
  photoIds: z.array(z.string()),
});

/**
 * The stub is the default. A later provider would return this same shape
 * after Zod, and fall back here. This path does not call the network.
 */
export function clientUpdateFromFacts(facts: ClientUpdateFacts): ClientUpdateDraft {
  return clientUpdateModelSchema.parse(draftClientUpdate(facts));
}
