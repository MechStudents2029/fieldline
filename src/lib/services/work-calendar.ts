import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { organizations, projects, workdayExceptions } from "@/lib/db/schema";
import { DEFAULT_WORKDAY_MASK, type WorkdayCalendar, type WorkException } from "@/lib/schedule/workdays";
import { canEditSchedule, canManageSettings, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { id, nowIso } from "@/lib/ids";
import { addCalendarDays } from "@/lib/time/calendar";

function cleanDay(value: string, label: string): string {
  const day = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || addCalendarDays(day, 0) !== day) throw new ServiceError(`Enter a ${label} date.`);
  return day;
}

/** Company exceptions first, then the job, so a job row overrides the company for that date. */
export function workCalendarFor(orgId: string, projectId?: string | null): WorkdayCalendar {
  const db = getDb();
  const org = db.select({ workdaysMask: organizations.workdaysMask }).from(organizations).where(eq(organizations.id, orgId)).get();
  const rows = db
    .select()
    .from(workdayExceptions)
    .where(
      and(
        eq(workdayExceptions.orgId, orgId),
        projectId ? or(isNull(workdayExceptions.projectId), eq(workdayExceptions.projectId, projectId)) : isNull(workdayExceptions.projectId),
      ),
    )
    .all()
    .sort((a, b) => Number(Boolean(a.projectId)) - Number(Boolean(b.projectId)) || a.startDate.localeCompare(b.startDate));
  const exceptions: WorkException[] = rows.map((row) => ({
    kind: row.kind === "work" ? "work" : "off",
    start: row.startDate,
    end: row.endDate,
    yearly: row.yearly === 1,
  }));
  return { mask: org?.workdaysMask ?? DEFAULT_WORKDAY_MASK, exceptions };
}

export type WorkExceptionRow = {
  id: string;
  projectId: string | null;
  title: string;
  kind: "off" | "work";
  startDate: string;
  endDate: string;
  yearly: boolean;
};

export function listWorkExceptions(actor: Actor, projectId: string | null): WorkExceptionRow[] {
  const db = getDb();
  const rows = db
    .select()
    .from(workdayExceptions)
    .where(
      and(
        eq(workdayExceptions.orgId, actor.orgId),
        projectId ? eq(workdayExceptions.projectId, projectId) : isNull(workdayExceptions.projectId),
      ),
    )
    .all()
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    kind: row.kind === "work" ? "work" : "off",
    startDate: row.startDate,
    endDate: row.endDate,
    yearly: row.yearly === 1,
  }));
}

export function addWorkException(
  actor: Actor,
  input: { projectId?: string | null; title: string; kind: string; startDate: string; endDate?: string; yearly?: boolean },
) {
  const job = Boolean(input.projectId);
  if (job) {
    if (!canEditSchedule(actor.role as Role)) throw new ServiceError("Your role can view the schedule, not change it.");
  } else if (!canManageSettings(actor.role as Role)) {
    throw new ServiceError("Your role cannot change company workdays.");
  }
  const title = input.title.trim().replace(/\s+/g, " ");
  if (!title || title.length > 60) throw new ServiceError("Add a short title.");
  if (input.kind !== "off" && input.kind !== "work") throw new ServiceError("Pick off or work.");
  const startDate = cleanDay(input.startDate, "start");
  const endDate = input.endDate?.trim() ? cleanDay(input.endDate, "end") : startDate;
  if (endDate < startDate) throw new ServiceError("End is on or after the start.");
  const db = getDb();
  if (input.projectId) {
    const project = db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.orgId, actor.orgId))).get();
    if (!project) throw new ServiceError("That job is not in your company.");
  }
  const rowId = id("wex");
  db.insert(workdayExceptions)
    .values({
      id: rowId,
      orgId: actor.orgId,
      projectId: input.projectId || null,
      title,
      kind: input.kind,
      startDate,
      endDate,
      yearly: input.yearly ? 1 : 0,
      createdAt: nowIso(),
      createdBy: actor.userId,
    })
    .run();
  return rowId;
}

export function removeWorkException(actor: Actor, exceptionId: string) {
  const db = getDb();
  const row = db.select().from(workdayExceptions).where(and(eq(workdayExceptions.id, exceptionId), eq(workdayExceptions.orgId, actor.orgId))).get();
  if (!row) throw new ServiceError("That day is not in your company.");
  if (row.projectId) {
    if (!canEditSchedule(actor.role as Role)) throw new ServiceError("Your role can view the schedule, not change it.");
  } else if (!canManageSettings(actor.role as Role)) {
    throw new ServiceError("Your role cannot change company workdays.");
  }
  db.delete(workdayExceptions).where(and(eq(workdayExceptions.id, row.id), eq(workdayExceptions.orgId, actor.orgId))).run();
}
