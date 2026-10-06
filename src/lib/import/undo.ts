/** Null means the row can be undone. A string is the short reason it cannot. */
export function undoDecision(input: { created: boolean; recordUpdatedAt: string; batchCreatedAt: string; usedAt: string | null }): string | null {
  if (input.created) return input.usedAt ? "Used on a job" : null;
  if (input.recordUpdatedAt > input.batchCreatedAt) return "Changed since import";
  if (input.usedAt && input.usedAt > input.batchCreatedAt) return "Used on a job";
  return null;
}
