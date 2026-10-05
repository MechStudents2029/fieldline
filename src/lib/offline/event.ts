import { z } from "zod";

export const OFFLINE_KINDS = ["clock_in", "break_start", "break_end", "switch", "clock_out", "log_draft"] as const;
export type OfflineKind = (typeof OFFLINE_KINDS)[number];

const textOrNull = (max: number) => z.string().max(max).nullable().optional();

export const offlineLogSchema = z.object({
  notes: textOrNull(4000),
  plannedNext: textOrNull(2000),
  weatherSky: textOrNull(80),
  weatherHighF: textOrNull(8),
  weatherLowF: textOrNull(8),
  weatherLostHours: textOrNull(8),
  weatherImpact: textOrNull(2000),
  delayCause: textOrNull(500),
  delayHours: textOrNull(8),
  deliveries: textOrNull(2000),
  visitors: textOrNull(2000),
  safetyNote: textOrNull(2000),
});

export const offlineEventSchema = z.object({
  clientEventId: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  kind: z.enum(OFFLINE_KINDS),
  capturedAt: z.string().datetime({ offset: true }),
  orgId: z.string().min(1).max(80),
  userId: z.string().min(1).max(80),
  projectId: z.string().max(80).nullable().optional(),
  costCode: z.string().max(40).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  lat: z.string().max(40).nullable().optional(),
  lng: z.string().max(40).nullable().optional(),
  log: offlineLogSchema.nullable().optional(),
  syncStatus: z.enum(["pending", "needs_review", "wrong_user"]).optional(),
});

export type OfflineEvent = z.infer<typeof offlineEventSchema>;

export const SYNC_BATCH_LIMIT = 50;

export type SyncStatus = "applied" | "needs_review" | "sign_in" | "wrong_user" | "error";

export type SyncResult = {
  clientEventId: string;
  status: SyncStatus;
  anomaly: string | null;
  detail: string;
  entryId: string | null;
  logId: string | null;
};
