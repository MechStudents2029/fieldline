import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { auditLogs, documents, estimateMeasurements, estimates, jobFiles, planScales, projects, proposals, takeoffs } from "@/lib/db/schema";
import { measurementName, FormulaError } from "@/lib/estimate/formula";
import { id, nowIso } from "@/lib/ids";
import { canManageMoney, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { applyMeasurementValue } from "@/lib/services/write";
import {
  measureQuantity,
  parseFeetInches,
  presetById,
  scaleLabel,
  type Pt,
  type Scale,
  type TakeoffKind,
  TakeoffError,
} from "@/lib/takeoff/geometry";

const COLORS = new Set(["teal", "blue", "orange", "purple"]);
const KINDS = new Set<TakeoffKind>(["linear", "wall", "area", "count"]);

export type TakeoffRow = {
  id: string;
  jobFileId: string;
  kind: TakeoffKind;
  name: string;
  color: string;
  room: string;
  points: Pt[];
  heightInches: number | null;
  pitchRise: number | null;
  pitchRun: number | null;
  depthInches: number | null;
  estimateId: string | null;
  measurementId: string | null;
  qtyMilli: number | null;
  unit: string | null;
  reviewed: boolean;
  copied: boolean;
};

export type TakeoffSheet = {
  id: string;
  name: string;
  revision: number;
  current: boolean;
  rows: TakeoffRow[];
};

export type TakeoffBoard = {
  projectId: string;
  fileId: string;
  name: string;
  revision: number;
  current: boolean;
  readOnly: boolean;
  canEdit: boolean;
  documentHref: string;
  kind: "pdf" | "image";
  scale: Scale | null;
  scaleText: string;
  sheets: TakeoffSheet[];
  estimates: { id: string; title: string; locked: boolean }[];
  measurements: { id: string; estimateId: string; name: string; unit: string; valueMilli: number; fromPlan: boolean }[];
  unreviewed: number;
};

export type TakeoffInput = {
  id?: string | null;
  projectId: string;
  jobFileId: string;
  kind: string;
  name: string;
  color: string;
  room?: string;
  points: Pt[];
  heightInches?: number | null;
  pitchRise?: number | null;
  pitchRun?: number | null;
  depthInches?: number | null;
  estimateId?: string | null;
  measurementId?: string | null;
  createMeasurement?: boolean;
};

function assertEstimator(actor: Actor) {
  if (!canManageMoney(actor.role as Role)) throw new ServiceError("Your role cannot change an estimate.");
}

function dbFor(actor: Actor) {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function writeAudit(db: AppDatabase, orgId: string, actorId: string | null, action: string, entityId: string, payload: Record<string, unknown>) {
  db.insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "takeoff",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function pointsOf(json: string): Pt[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((point) => {
      if (!point || typeof point !== "object") return [];
      const row = point as { x?: unknown; y?: unknown };
      if (!Number.isInteger(row.x) || !Number.isInteger(row.y)) return [];
      return [{ x: row.x as number, y: row.y as number }];
    });
  } catch {
    return [];
  }
}

export function scaleFromRow(row: {
  mode: string;
  preset: string | null;
  ax: number | null;
  ay: number | null;
  bx: number | null;
  by: number | null;
  realInches: number | null;
  paperWidthInches: number;
  aspectBps: number;
}): Scale | null {
  if (row.mode === "preset" && row.preset && presetById(row.preset)) {
    return { mode: "preset", preset: row.preset, paperWidthInches: row.paperWidthInches || 36, aspectBps: row.aspectBps || 10_000 };
  }
  if (row.mode === "segment" && row.ax != null && row.ay != null && row.bx != null && row.by != null && row.realInches != null && row.realInches > 0) {
    return { mode: "segment", ax: row.ax, ay: row.ay, bx: row.bx, by: row.by, realInches: row.realInches, aspectBps: row.aspectBps || 10_000 };
  }
  return null;
}

function checkedPoints(points: Pt[]) {
  if (!Array.isArray(points) || points.length > 80) throw new ServiceError("Check the points.");
  return points.map((point) => {
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0 || point.x > 100_000 || point.y > 100_000) {
      throw new ServiceError("Check the points.");
    }
    return { x: point.x, y: point.y };
  });
}

function kindOf(value: string): TakeoffKind {
  if (!KINDS.has(value as TakeoffKind)) throw new ServiceError("Pick a tool.");
  return value as TakeoffKind;
}

function currentFile(db: AppDatabase, actor: Actor, projectId: string, jobFileId: string) {
  const file = db.select().from(jobFiles).where(and(eq(jobFiles.id, jobFileId), eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, projectId))).get();
  if (!file || file.deletedAt) throw new ServiceError("Plan not found.");
  if (file.isCurrent !== 1) throw new ServiceError("This revision is read-only.");
  return file;
}

function viewRow(row: typeof takeoffs.$inferSelect, scale: Scale | null): TakeoffRow {
  const points = pointsOf(row.pointsJson);
  const kind = kindOf(KINDS.has(row.kind as TakeoffKind) ? row.kind : "linear");
  let qty: { qtyMilli: number; unit: string } | null = null;
  if (scale) {
    try {
      qty = measureQuantity({
        kind,
        points,
        scale,
        heightInches: row.heightInches,
        pitchRise: row.pitchRise,
        pitchRun: row.pitchRun,
        depthInches: row.depthInches,
      });
    } catch {
      qty = null;
    }
  }
  return {
    id: row.id,
    jobFileId: row.jobFileId,
    kind,
    name: row.name,
    color: row.color,
    room: row.room,
    points,
    heightInches: row.heightInches,
    pitchRise: row.pitchRise,
    pitchRun: row.pitchRun,
    depthInches: row.depthInches,
    estimateId: row.estimateId,
    measurementId: row.measurementId,
    qtyMilli: qty?.qtyMilli ?? null,
    unit: qty?.unit ?? null,
    reviewed: row.reviewed === 1,
    copied: Boolean(row.copiedFromId),
  };
}

export function estimatePlanHref(orgId: string, leadId: string, estimateId: string): string | null {
  const db = officeDb(orgId);
  if (!db) return null;
  const plans = db
    .select()
    .from(jobFiles)
    .where(and(eq(jobFiles.orgId, orgId), eq(jobFiles.isCurrent, 1)))
    .all()
    .filter((row) => !row.deletedAt);
  const project = db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.leadId, leadId))).get();
  if (!project) return null;
  const onJob = plans.filter((row) => row.projectId === project.id);
  const plan = onJob.find((row) => /plan|a-\d/i.test(row.name)) ?? onJob[0];
  if (!plan) return null;
  return `/projects/${project.id}/plans/${plan.id}?takeoff=1&estimate=${estimateId}`;
}

export function takeoffBoard(actor: Actor, projectId: string, fileId: string): TakeoffBoard | null {
  const db = officeDb(actor.orgId);
  if (!db) return null;
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId))).get();
  const file = db.select().from(jobFiles).where(and(eq(jobFiles.id, fileId), eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, projectId))).get();
  if (!project || !file || file.deletedAt) return null;
  const document = db.select().from(documents).where(and(eq(documents.id, file.documentId), eq(documents.orgId, actor.orgId))).get();
  if (!document) return null;
  const files = db
    .select()
    .from(jobFiles)
    .where(and(eq(jobFiles.orgId, actor.orgId), eq(jobFiles.projectId, project.id), eq(jobFiles.revisionGroupId, file.revisionGroupId)))
    .all()
    .filter((row) => !row.deletedAt)
    .sort((a, b) => b.revision - a.revision);
  const scales = db.select().from(planScales).where(and(eq(planScales.orgId, actor.orgId), eq(planScales.projectId, project.id))).all();
  const scaleByFile = new Map(scales.map((row) => [row.jobFileId, scaleFromRow(row)]));
  const rows = db.select().from(takeoffs).where(and(eq(takeoffs.orgId, actor.orgId), eq(takeoffs.projectId, project.id))).all();
  const sheets: TakeoffSheet[] = files.map((sheet) => ({
    id: sheet.id,
    name: sheet.name,
    revision: sheet.revision,
    current: sheet.isCurrent === 1,
    rows: rows
      .filter((row) => row.jobFileId === sheet.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((row) => viewRow(row, scaleByFile.get(sheet.id) ?? null)),
  }));
  const leadEstimates = project.leadId
    ? db.select().from(estimates).where(and(eq(estimates.orgId, actor.orgId), eq(estimates.leadId, project.leadId))).all()
    : [];
  const measurements = db
    .select()
    .from(estimateMeasurements)
    .where(eq(estimateMeasurements.orgId, actor.orgId))
    .all()
    .filter((row) => leadEstimates.some((estimate) => estimate.id === row.estimateId));
  const proposalRows = db.select().from(proposals).where(eq(proposals.orgId, actor.orgId)).all();
  const currentScale = scaleByFile.get(file.id) ?? null;
  const currentRows = sheets.find((sheet) => sheet.id === file.id)?.rows ?? [];
  const kind = document.filename.toLowerCase().endsWith(".pdf") || document.storagePath.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
  return {
    projectId: project.id,
    fileId: file.id,
    name: file.name,
    revision: file.revision,
    current: file.isCurrent === 1,
    readOnly: file.isCurrent !== 1,
    canEdit: file.isCurrent === 1 && canManageMoney(actor.role as Role),
    documentHref: document.storagePath.startsWith("/") ? document.storagePath : `/api/files/${document.id}`,
    kind,
    scale: currentScale,
    scaleText: scaleLabel(currentScale),
    sheets,
    estimates: leadEstimates
      .sort((a, b) => b.version - a.version)
      .map((estimate) => ({
        id: estimate.id,
        title: estimate.title,
        locked: proposalRows.some((row) => row.estimateId === estimate.id && row.status !== "superseded"),
      })),
    measurements: measurements.map((row) => ({
      id: row.id,
      estimateId: row.estimateId,
      name: row.name,
      unit: row.unit,
      valueMilli: row.valueMilli,
      fromPlan: row.fromPlan === 1,
    })),
    unreviewed: currentRows.filter((row) => !row.reviewed).length,
  };
}

export function savePlanScale(
  actor: Actor,
  input: {
    projectId: string;
    jobFileId: string;
    mode: "segment" | "preset";
    preset?: string | null;
    ax?: number | null;
    ay?: number | null;
    bx?: number | null;
    by?: number | null;
    length?: string | null;
    realInches?: number | null;
    paperWidthInches?: number | null;
    aspectBps?: number | null;
  },
) {
  assertEstimator(actor);
  const db = dbFor(actor);
  const file = currentFile(db, actor, input.projectId, input.jobFileId);
  const aspect = Number.isInteger(input.aspectBps) && (input.aspectBps ?? 0) > 0 ? (input.aspectBps as number) : 10_000;
  const paper = Number.isInteger(input.paperWidthInches) && (input.paperWidthInches ?? 0) > 0 ? (input.paperWidthInches as number) : 36;
  let mode = input.mode;
  let preset: string | null = null;
  let realInches: number | null = null;
  let ax: number | null = null;
  let ay: number | null = null;
  let bx: number | null = null;
  let by: number | null = null;
  if (mode === "preset") {
    if (!input.preset || !presetById(input.preset)) throw new ServiceError("Pick a scale.");
    preset = input.preset;
  } else {
    mode = "segment";
    const points = checkedPoints([
      { x: input.ax ?? -1, y: input.ay ?? -1 },
      { x: input.bx ?? -1, y: input.by ?? -1 },
    ]);
    ax = points[0]!.x;
    ay = points[0]!.y;
    bx = points[1]!.x;
    by = points[1]!.y;
    try {
      realInches = input.realInches && input.realInches > 0 ? Math.round(input.realInches) : parseFeetInches(input.length ?? "");
    } catch (error) {
      throw new ServiceError(error instanceof TakeoffError ? error.message : "Enter the length.");
    }
    if (realInches <= 0 || realInches > 100_000) throw new ServiceError("Enter the length.");
  }
  const existing = db.select().from(planScales).where(and(eq(planScales.orgId, actor.orgId), eq(planScales.jobFileId, file.id))).get();
  const scaleId = existing?.id ?? id("psc");
  const values = {
    mode,
    preset,
    ax,
    ay,
    bx,
    by,
    realInches,
    paperWidthInches: paper,
    aspectBps: aspect,
    updatedAt: nowIso(),
    updatedBy: actor.userId,
  };
  if (existing) db.update(planScales).set(values).where(eq(planScales.id, existing.id)).run();
  else {
    db.insert(planScales)
      .values({ id: scaleId, orgId: actor.orgId, projectId: file.projectId, jobFileId: file.id, ...values })
      .run();
  }
  const scale = scaleFromRow({ ...values, preset, ax, ay, bx, by, realInches, paperWidthInches: paper, aspectBps: aspect });
  refreshFile(actor, file.id, scale);
  writeAudit(db, actor.orgId, actor.userId, "takeoff.scale", scaleId, { jobFileId: file.id, mode });
  return { id: scaleId, scaleText: scaleLabel(scale) };
}

function refreshFile(actor: Actor, jobFileId: string, scale: Scale | null) {
  if (!scale) return;
  const db = dbFor(actor);
  const rows = db.select().from(takeoffs).where(and(eq(takeoffs.orgId, actor.orgId), eq(takeoffs.jobFileId, jobFileId))).all();
  for (const row of rows) {
    if (!row.measurementId) continue;
    pushRow(actor, row, scale);
  }
}

function pushRow(actor: Actor, row: typeof takeoffs.$inferSelect, scale: Scale) {
  const kind = kindOf(row.kind);
  let qty: { qtyMilli: number; unit: string };
  try {
    qty = measureQuantity({
      kind,
      points: pointsOf(row.pointsJson),
      scale,
      heightInches: row.heightInches,
      pitchRise: row.pitchRise,
      pitchRun: row.pitchRun,
      depthInches: row.depthInches,
    });
  } catch (error) {
    throw new ServiceError(error instanceof TakeoffError ? error.message : "Check the measurement.");
  }
  if (!row.measurementId) return { frozen: false, qty };
  const db = dbFor(actor);
  const measure = db
    .select()
    .from(estimateMeasurements)
    .where(and(eq(estimateMeasurements.id, row.measurementId), eq(estimateMeasurements.orgId, actor.orgId)))
    .get();
  if (!measure) return { frozen: false, qty };
  if (measure.unit !== qty.unit) throw new ServiceError(`This measurement is in ${measure.unit}.`);
  const applied = applyMeasurementValue(actor, measure.id, qty.qtyMilli, true);
  return { frozen: applied.frozen, qty };
}

export function saveTakeoff(actor: Actor, input: TakeoffInput) {
  assertEstimator(actor);
  const db = dbFor(actor);
  const file = currentFile(db, actor, input.projectId, input.jobFileId);
  const kind = kindOf(input.kind);
  let name: string;
  try {
    name = measurementName(input.name);
  } catch (error) {
    throw new ServiceError(error instanceof FormulaError ? error.message : "Name the measurement.");
  }
  const color = COLORS.has(input.color) ? input.color : "teal";
  const room = (input.room ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  const points = checkedPoints(input.points);
  const heightInches = input.heightInches && input.heightInches > 0 ? Math.round(input.heightInches) : null;
  const pitchRise = input.pitchRise != null && input.pitchRise >= 0 ? Math.round(input.pitchRise) : null;
  const pitchRun = input.pitchRun != null && input.pitchRun > 0 ? Math.round(input.pitchRun) : null;
  const depthInches = input.depthInches && input.depthInches > 0 ? Math.round(input.depthInches) : null;
  if ((pitchRise == null) !== (pitchRun == null)) throw new ServiceError("Check the pitch.");
  const scaleRow = db.select().from(planScales).where(and(eq(planScales.orgId, actor.orgId), eq(planScales.jobFileId, file.id))).get();
  const scale = scaleRow ? scaleFromRow(scaleRow) : null;
  if (!scale) throw new ServiceError("Set the scale.");
  let qty: { qtyMilli: number; unit: string };
  try {
    qty = measureQuantity({ kind, points, scale, heightInches, pitchRise, pitchRun, depthInches });
  } catch (error) {
    throw new ServiceError(error instanceof TakeoffError ? error.message : "Check the measurement.");
  }
  const existing = input.id
    ? db.select().from(takeoffs).where(and(eq(takeoffs.id, input.id), eq(takeoffs.orgId, actor.orgId), eq(takeoffs.jobFileId, file.id))).get()
    : undefined;
  if (input.id && !existing) throw new ServiceError("Measurement not found.");
  let measurementId = input.measurementId ?? existing?.measurementId ?? null;
  let estimateId = input.estimateId ?? existing?.estimateId ?? null;
  if (measurementId) {
    const measure = db.select().from(estimateMeasurements).where(and(eq(estimateMeasurements.id, measurementId), eq(estimateMeasurements.orgId, actor.orgId))).get();
    if (!measure) throw new ServiceError("Measurement not found.");
    if (measure.unit !== qty.unit) throw new ServiceError(`This measurement is in ${measure.unit}.`);
    estimateId = measure.estimateId;
  } else if (input.createMeasurement) {
    if (!estimateId) throw new ServiceError("Pick an estimate.");
    const estimate = db.select().from(estimates).where(and(eq(estimates.id, estimateId), eq(estimates.orgId, actor.orgId))).get();
    const project = db.select().from(projects).where(and(eq(projects.id, file.projectId), eq(projects.orgId, actor.orgId))).get();
    if (!estimate || !project || estimate.leadId !== project.leadId) throw new ServiceError("Estimate not found.");
    const siblings = db.select().from(estimateMeasurements).where(and(eq(estimateMeasurements.orgId, actor.orgId), eq(estimateMeasurements.estimateId, estimate.id))).all();
    const same = siblings.find((row) => row.name === name);
    if (same) {
      if (same.unit !== qty.unit) throw new ServiceError(`This measurement is in ${same.unit}.`);
      measurementId = same.id;
    } else {
      measurementId = id("meas");
      db.insert(estimateMeasurements)
        .values({
          id: measurementId,
          orgId: actor.orgId,
          estimateId: estimate.id,
          name,
          valueMilli: qty.qtyMilli,
          unit: qty.unit,
          sortOrder: siblings.length,
          fromPlan: 1,
        })
        .run();
    }
  }
  const takeoffId = existing?.id ?? id("to");
  const now = nowIso();
  const stored = {
    kind,
    name,
    color,
    room,
    pointsJson: JSON.stringify(points),
    heightInches,
    pitchRise,
    pitchRun,
    depthInches,
    estimateId,
    measurementId,
    updatedAt: now,
  };
  if (existing) db.update(takeoffs).set(stored).where(eq(takeoffs.id, existing.id)).run();
  else {
    const count = db.select().from(takeoffs).where(and(eq(takeoffs.orgId, actor.orgId), eq(takeoffs.jobFileId, file.id))).all().length;
    db.insert(takeoffs)
      .values({
        id: takeoffId,
        orgId: actor.orgId,
        projectId: file.projectId,
        jobFileId: file.id,
        ...stored,
        copiedFromId: null,
        reviewed: 1,
        sortOrder: count,
        createdAt: now,
        createdBy: actor.userId,
      })
      .run();
  }
  const saved = db.select().from(takeoffs).where(eq(takeoffs.id, takeoffId)).get()!;
  const pushed = pushRow(actor, saved, scale);
  writeAudit(db, actor.orgId, actor.userId, existing ? "takeoff.update" : "takeoff.create", takeoffId, { jobFileId: file.id, kind, qtyMilli: pushed.qty.qtyMilli });
  return { id: takeoffId, qtyMilli: pushed.qty.qtyMilli, unit: pushed.qty.unit, frozen: pushed.frozen };
}

export function deleteTakeoff(actor: Actor, input: { projectId: string; jobFileId: string; id: string }) {
  assertEstimator(actor);
  const db = dbFor(actor);
  const file = currentFile(db, actor, input.projectId, input.jobFileId);
  const row = db.select().from(takeoffs).where(and(eq(takeoffs.id, input.id), eq(takeoffs.orgId, actor.orgId), eq(takeoffs.jobFileId, file.id))).get();
  if (!row) throw new ServiceError("Measurement not found.");
  db.delete(takeoffs).where(eq(takeoffs.id, row.id)).run();
  writeAudit(db, actor.orgId, actor.userId, "takeoff.delete", row.id, { jobFileId: file.id });
  return { id: row.id };
}

export function reviewTakeoffs(actor: Actor, input: { projectId: string; jobFileId: string }) {
  assertEstimator(actor);
  const db = dbFor(actor);
  const file = currentFile(db, actor, input.projectId, input.jobFileId);
  db.update(takeoffs)
    .set({ reviewed: 1, updatedAt: nowIso() })
    .where(and(eq(takeoffs.orgId, actor.orgId), eq(takeoffs.jobFileId, file.id), eq(takeoffs.reviewed, 0)))
    .run();
  writeAudit(db, actor.orgId, actor.userId, "takeoff.review", file.id, { jobFileId: file.id });
  return { id: file.id };
}

export function carryTakeoffs(db: AppDatabase, orgId: string, fromFileId: string, toFileId: string, actorId: string | null) {
  const scale = db.select().from(planScales).where(and(eq(planScales.orgId, orgId), eq(planScales.jobFileId, fromFileId))).get();
  const now = nowIso();
  if (scale) {
    db.insert(planScales)
      .values({
        id: id("psc"),
        orgId,
        projectId: scale.projectId,
        jobFileId: toFileId,
        mode: scale.mode,
        preset: scale.preset,
        ax: scale.ax,
        ay: scale.ay,
        bx: scale.bx,
        by: scale.by,
        realInches: scale.realInches,
        paperWidthInches: scale.paperWidthInches,
        aspectBps: scale.aspectBps,
        updatedAt: now,
        updatedBy: actorId,
      })
      .run();
  }
  const rows = db.select().from(takeoffs).where(and(eq(takeoffs.orgId, orgId), eq(takeoffs.jobFileId, fromFileId))).all();
  for (const row of rows) {
    db.insert(takeoffs)
      .values({
        id: id("to"),
        orgId,
        projectId: row.projectId,
        jobFileId: toFileId,
        kind: row.kind,
        name: row.name,
        color: row.color,
        room: row.room,
        pointsJson: row.pointsJson,
        heightInches: row.heightInches,
        pitchRise: row.pitchRise,
        pitchRun: row.pitchRun,
        depthInches: row.depthInches,
        estimateId: row.estimateId,
        measurementId: row.measurementId,
        copiedFromId: row.id,
        reviewed: 0,
        sortOrder: row.sortOrder,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
      })
      .run();
  }
  return rows.length;
}
