import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  auditLogs,
  billLines,
  bills,
  contacts,
  documents,
  fileFolders,
  handoverItems,
  handoverPackages,
  handoverSections,
  jobFiles,
  jobSpecFiles,
  jobSpecLines,
  jobSpecs,
  organizations,
  projects,
  purchaseOrderLines,
  purchaseOrders,
  scheduleItems,
  selectionChoices,
  selections,
  submittalFiles,
  submittalRevisions,
  submittals,
} from "@/lib/db/schema";
import { missingDocs, nextMaintenance, warrantyEnd } from "@/lib/handover/package";
import { id, nowIso } from "@/lib/ids";
import { canEditCrm, type Role } from "@/lib/permissions";
import { appOrigin } from "@/lib/security";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { addCalendarDays, localDay } from "@/lib/time/calendar";

export type HandoverQuery = { filter?: string; projectId?: string };

const STATUS_LABEL: Record<string, string> = { draft: "Draft", ready: "Ready", delivered: "Delivered" };

type ItemDraft = {
  title: string;
  manufacturer: string;
  model: string;
  serial: string;
  finish: string;
  documentId: string | null;
  sourceType: string;
  sourceId: string | null;
  vendorName: string;
  trade: string;
  phone: string;
};

export type ItemInput = {
  title?: string;
  manufacturer?: string;
  model?: string;
  serial?: string;
  finish?: string;
  installOn?: string;
  warrantyMonths?: string;
  intervalDays?: string;
  intervalLabel?: string;
  vendorName?: string;
  trade?: string;
  phone?: string;
  documentId?: string;
};

function office(actor: Actor) {
  if (!canEditCrm(actor.role as Role)) throw new ServiceError("Your role cannot change this.");
}

function bound(value: string | undefined, max: number) {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function dayOrNull(value: string | undefined): string | null {
  const day = (value ?? "").trim();
  if (!day) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ServiceError("Enter a date.");
  return day;
}

function intOrNull(value: string | undefined, label: string, max: number): number | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new ServiceError(`${label} must be a whole number.`);
  return parsed;
}

function todayFor(orgId: string): string {
  const org = getDb().select().from(organizations).where(eq(organizations.id, orgId)).get();
  return localDay(Date.now(), org?.timeZone || "America/New_York");
}

function shareToken(): string {
  return randomBytes(18).toString("base64url");
}

export function handoverShareUrl(token: string): string {
  const origin = appOrigin(process.env) ?? "";
  return `${origin}/h/${token}`;
}

function audit(orgId: string, actorId: string | null, action: string, entityId: string, payload: unknown) {
  getDb()
    .insert(auditLogs)
    .values({
      id: id("audit"),
      orgId,
      actorId,
      action,
      entityType: "handover",
      entityId,
      payloadJson: JSON.stringify(payload),
      ip: null,
      createdAt: nowIso(),
    })
    .run();
}

function projectOf(orgId: string, projectId: string) {
  return getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)))
    .get();
}

function packageOf(orgId: string, packageId: string) {
  return getDb()
    .select()
    .from(handoverPackages)
    .where(and(eq(handoverPackages.orgId, orgId), eq(handoverPackages.id, packageId)))
    .get();
}

function requirePackage(actor: Actor, packageId: string) {
  const row = packageOf(actor.orgId, packageId);
  if (!row) throw new ServiceError("That package is not in your company.");
  return row;
}

function fileMatches(kind: string, folderName: string, fileName: string) {
  if (kind === "plans") return true;
  const blob = `${kind} ${folderName} ${fileName}`.toLowerCase();
  return blob.includes("as-built") || blob.includes("as built") || blob.includes("asbuilt") || blob.includes("manual");
}

function blankItem(partial: Partial<ItemDraft> & { title: string; sourceType: string }): ItemDraft {
  return {
    title: partial.title,
    manufacturer: partial.manufacturer ?? "",
    model: partial.model ?? "",
    serial: partial.serial ?? "",
    finish: partial.finish ?? "",
    documentId: partial.documentId ?? null,
    sourceType: partial.sourceType,
    sourceId: partial.sourceId ?? null,
    vendorName: partial.vendorName ?? "",
    trade: partial.trade ?? "",
    phone: partial.phone ?? "",
  };
}

function prefill(orgId: string, projectId: string): { kind: string; title: string; items: ItemDraft[] }[] {
  const db = getDb();
  const chosen = db
    .select()
    .from(selections)
    .where(and(eq(selections.orgId, orgId), eq(selections.projectId, projectId)))
    .all()
    .filter((row) => (row.status === "chosen" || row.status === "locked") && row.chosenChoiceId);
  const choices = db.select().from(selectionChoices).where(eq(selectionChoices.orgId, orgId)).all();
  const selectionItems = chosen.flatMap((row) => {
    const choice = choices.find((item) => item.id === row.chosenChoiceId);
    if (!choice) return [];
    return [
      blankItem({
        title: row.title,
        model: choice.name,
        finish: choice.note ?? "",
        manufacturer: choice.vendor ?? "",
        vendorName: choice.vendor ?? "",
        sourceType: "selection",
        sourceId: row.id,
      }),
    ];
  });

  const approvedSubs = db
    .select()
    .from(submittals)
    .where(and(eq(submittals.orgId, orgId), eq(submittals.projectId, projectId), eq(submittals.status, "approved")))
    .all()
    .sort((a, b) => a.number - b.number);
  const revisions = db.select().from(submittalRevisions).where(eq(submittalRevisions.orgId, orgId)).all();
  const subFiles = db.select().from(submittalFiles).where(eq(submittalFiles.orgId, orgId)).all();
  const revisionNumber = new Map(revisions.map((row) => [row.id, row.revision]));
  const submittalItems = approvedSubs.map((row) => {
    const files = subFiles
      .filter((file) => file.submittalId === row.id)
      .sort((a, b) => (revisionNumber.get(b.revisionId) ?? 0) - (revisionNumber.get(a.revisionId) ?? 0));
    return blankItem({
      title: row.title,
      documentId: files[0]?.documentId ?? null,
      sourceType: "submittal",
      sourceId: row.id,
    });
  });

  const specs = db.select().from(jobSpecs).where(and(eq(jobSpecs.orgId, orgId), eq(jobSpecs.projectId, projectId))).all();
  const replaced = new Set(specs.map((row) => row.replacesId).filter((value): value is string => Boolean(value)));
  const published = specs.filter((row) => row.status === "published" && !replaced.has(row.id));
  const latestVersion = published.reduce((max, row) => Math.max(max, row.version), 0);
  const currentSpecs = published.filter((row) => row.version === latestVersion);
  const lines = db.select().from(jobSpecLines).where(eq(jobSpecLines.orgId, orgId)).all();
  const specFiles = db.select().from(jobSpecFiles).where(eq(jobSpecFiles.orgId, orgId)).all();
  const specItems = currentSpecs.flatMap((spec) =>
    lines
      .filter((line) => line.specId === spec.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((line) =>
        blankItem({
          title: line.description,
          documentId: specFiles.find((file) => file.lineId === line.id)?.documentId ?? null,
          sourceType: "spec",
          sourceId: line.id,
        }),
      ),
  );

  const folders = db.select().from(fileFolders).where(and(eq(fileFolders.orgId, orgId), eq(fileFolders.projectId, projectId))).all();
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const files = db
    .select()
    .from(jobFiles)
    .where(and(eq(jobFiles.orgId, orgId), eq(jobFiles.projectId, projectId)))
    .all()
    .filter((file) => file.isCurrent === 1 && !file.deletedAt);
  const fileItems = files.flatMap((file) => {
    const folder = folderById.get(file.folderId);
    if (!folder || folder.archivedAt) return [];
    if (!fileMatches(folder.kind, folder.name, file.name)) return [];
    return [blankItem({ title: file.name, documentId: file.documentId, sourceType: "file", sourceId: file.id })];
  });

  const people = db.select().from(contacts).where(eq(contacts.orgId, orgId)).all();
  const personById = new Map(people.map((person) => [person.id, person]));
  const trades = new Map<string, { name: string; phone: string; trade: string }>();
  const remember = (contactId: string | null, trade: string) => {
    if (!contactId) return;
    const person = personById.get(contactId);
    if (!person) return;
    const name = person.company || person.name;
    const existing = trades.get(contactId);
    if (!existing) trades.set(contactId, { name, phone: person.phone ?? "", trade });
    else if (!existing.trade && trade) existing.trade = trade;
  };
  const jobBills = db.select().from(bills).where(and(eq(bills.orgId, orgId), eq(bills.projectId, projectId))).all();
  const linesByBill = db.select().from(billLines).where(eq(billLines.orgId, orgId)).all();
  for (const bill of jobBills) remember(bill.vendorContactId, linesByBill.find((line) => line.billId === bill.id)?.costCode ?? "");
  const orders = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.projectId, projectId))).all();
  const orderLines = db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orgId, orgId)).all();
  for (const order of orders) remember(order.vendorContactId, orderLines.find((line) => line.purchaseOrderId === order.id)?.costCode ?? "");
  const tasks = db.select().from(scheduleItems).where(and(eq(scheduleItems.orgId, orgId), eq(scheduleItems.projectId, projectId))).all();
  for (const task of tasks) remember(task.vendorContactId, task.title);
  const tradeItems = [...trades.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([contactId, row]) =>
      blankItem({
        title: row.name,
        vendorName: row.name,
        trade: row.trade,
        phone: row.phone,
        sourceType: "trade",
        sourceId: contactId,
      }),
    );

  const sections = [
    { kind: "selections", title: "Selections", items: selectionItems },
    { kind: "submittals", title: "Submittals", items: submittalItems },
    { kind: "specs", title: "Specifications", items: specItems },
    { kind: "files", title: "Files", items: fileItems },
    { kind: "trades", title: "Trades", items: tradeItems },
    { kind: "installed", title: "Installed items", items: [] as ItemDraft[] },
  ];
  return sections.filter((section) => section.kind === "installed" || section.items.length > 0);
}

function rowsFor(orgId: string, packageId: string) {
  const db = getDb();
  const sections = db
    .select()
    .from(handoverSections)
    .where(and(eq(handoverSections.orgId, orgId), eq(handoverSections.packageId, packageId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  const items = db
    .select()
    .from(handoverItems)
    .where(and(eq(handoverItems.orgId, orgId), eq(handoverItems.packageId, packageId)))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  return { sections, items };
}

function readinessOf(orgId: string, packageId: string) {
  const { sections, items } = rowsFor(orgId, packageId);
  const kind = new Map(sections.map((section) => [section.id, section.kind]));
  return missingDocs(items.map((item) => ({ sectionKind: kind.get(item.sectionId) ?? "", documentId: item.documentId })));
}

function shapeItem(item: typeof handoverItems.$inferSelect, names: Map<string, string>) {
  return {
    id: item.id,
    title: item.title,
    manufacturer: item.manufacturer,
    model: item.model,
    serial: item.serial,
    finish: item.finish,
    installOn: item.installOn ?? "",
    warrantyMonths: item.warrantyMonths,
    warrantyEndsOn: item.warrantyEndsOn ?? "",
    documentId: item.documentId,
    documentName: item.documentId ? names.get(item.documentId) ?? "" : "",
    intervalDays: item.intervalDays,
    intervalLabel: item.intervalLabel,
    nextDueOn: item.nextDueOn ?? "",
    vendorName: item.vendorName,
    trade: item.trade,
    phone: item.phone,
    missing: !item.documentId,
  };
}

function detailOf(actor: Actor, pack: typeof handoverPackages.$inferSelect) {
  const db = getDb();
  const project = projectOf(actor.orgId, pack.projectId);
  if (!project) return null;
  const { sections, items } = rowsFor(actor.orgId, pack.id);
  const docs = db
    .select()
    .from(documents)
    .where(and(eq(documents.orgId, actor.orgId), eq(documents.projectId, project.id)))
    .all()
    .filter((doc) => !doc.deletedAt)
    .sort((a, b) => a.filename.localeCompare(b.filename));
  const names = new Map(docs.map((doc) => [doc.id, doc.filename]));
  const kind = new Map(sections.map((section) => [section.id, section.kind]));
  return {
    id: pack.id,
    projectId: project.id,
    job: project.name,
    address: project.address ?? "",
    closedOn: (project.closedAt ?? project.endDate ?? "").slice(0, 10),
    warrantyEndsOn: project.warrantyEndsOn ?? "",
    status: pack.status,
    statusLabel: STATUS_LABEL[pack.status] ?? pack.status,
    published: Boolean(pack.publishedAt),
    publishedAt: pack.publishedAt,
    deliveredAt: pack.deliveredAt,
    copiedAt: pack.copiedAt,
    shareUrl: handoverShareUrl(pack.shareToken),
    readiness: missingDocs(items.map((item) => ({ sectionKind: kind.get(item.sectionId) ?? "", documentId: item.documentId }))),
    sections: sections.map((section) => ({
      id: section.id,
      kind: section.kind,
      title: section.title,
      items: items.filter((item) => item.sectionId === section.id).map((item) => ({ ...shapeItem(item, names), missing: section.kind === "installed" && !item.documentId })),
    })),
    documents: docs.map((doc) => ({ id: doc.id, filename: doc.filename })),
  };
}

export type HandoverDetail = NonNullable<ReturnType<typeof detailOf>>;

export function startHandover(actor: Actor, projectId: string): string {
  office(actor);
  const project = projectOf(actor.orgId, projectId);
  if (!project) throw new ServiceError("That job is not in your company.");
  const existing = getDb()
    .select()
    .from(handoverPackages)
    .where(and(eq(handoverPackages.orgId, actor.orgId), eq(handoverPackages.projectId, projectId)))
    .get();
  if (existing) throw new ServiceError("This job already has a handover package.");
  const packageId = id("ho");
  const stamp = nowIso();
  const sections = prefill(actor.orgId, projectId);
  const db = getDb();
  db.transaction((tx) => {
    tx.insert(handoverPackages)
      .values({
        id: packageId,
        orgId: actor.orgId,
        projectId,
        status: "draft",
        shareToken: shareToken(),
        publishedAt: null,
        publishedBy: null,
        deliveredAt: null,
        deliveredBy: null,
        copiedAt: null,
        copiedBy: null,
        createdAt: stamp,
        updatedAt: stamp,
        createdBy: actor.userId,
      })
      .run();
    sections.forEach((section, index) => {
      const sectionId = id("hsec");
      tx.insert(handoverSections)
        .values({ id: sectionId, orgId: actor.orgId, packageId, kind: section.kind, title: section.title, sortOrder: index })
        .run();
      section.items.forEach((item, itemIndex) => {
        tx.insert(handoverItems)
          .values({
            id: id("hit"),
            orgId: actor.orgId,
            packageId,
            sectionId,
            sortOrder: itemIndex,
            title: item.title,
            manufacturer: item.manufacturer,
            model: item.model,
            serial: item.serial,
            finish: item.finish,
            installOn: null,
            warrantyMonths: null,
            warrantyEndsOn: null,
            documentId: item.documentId,
            intervalDays: null,
            intervalLabel: "",
            nextDueOn: null,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            vendorName: item.vendorName,
            trade: item.trade,
            phone: item.phone,
          })
          .run();
      });
    });
  });
  audit(actor.orgId, actor.userId, "handover.create", packageId, { projectId });
  return packageId;
}

export function handoverForProject(actor: Actor, projectId: string) {
  const project = projectOf(actor.orgId, projectId);
  if (!project) return null;
  const pack = getDb()
    .select()
    .from(handoverPackages)
    .where(and(eq(handoverPackages.orgId, actor.orgId), eq(handoverPackages.projectId, projectId)))
    .get();
  if (!pack) return null;
  return { id: pack.id, status: pack.status, statusLabel: STATUS_LABEL[pack.status] ?? pack.status, readiness: readinessOf(actor.orgId, pack.id) };
}

function duePackageIds(orgId: string, today: string) {
  const db = getDb();
  const end = addCalendarDays(today, 30);
  const closed = new Set(
    db
      .select()
      .from(projects)
      .where(eq(projects.orgId, orgId))
      .all()
      .filter((project) => project.closedAt)
      .map((project) => project.id),
  );
  const packs = db
    .select()
    .from(handoverPackages)
    .where(eq(handoverPackages.orgId, orgId))
    .all()
    .filter((pack) => pack.publishedAt && closed.has(pack.projectId));
  const packIds = new Set(packs.map((pack) => pack.id));
  const installed = new Set(
    db
      .select()
      .from(handoverSections)
      .where(eq(handoverSections.orgId, orgId))
      .all()
      .filter((section) => section.kind === "installed")
      .map((section) => section.id),
  );
  const hits = db
    .select()
    .from(handoverItems)
    .where(eq(handoverItems.orgId, orgId))
    .all()
    .filter((item) => packIds.has(item.packageId) && installed.has(item.sectionId) && item.nextDueOn && item.nextDueOn >= today && item.nextDueOn <= end);
  return { hits, packs };
}

export function listHandovers(actor: Actor, query: HandoverQuery = {}) {
  const db = getDb();
  const filter = query.filter ?? "";
  const today = todayFor(actor.orgId);
  const dueIds = filter === "due" ? new Set(duePackageIds(actor.orgId, today).hits.map((item) => item.packageId)) : null;
  const jobs = new Map(
    db
      .select()
      .from(projects)
      .where(eq(projects.orgId, actor.orgId))
      .all()
      .map((project) => [project.id, project.name]),
  );
  return db
    .select()
    .from(handoverPackages)
    .where(eq(handoverPackages.orgId, actor.orgId))
    .all()
    .filter((pack) => !query.projectId || pack.projectId === query.projectId)
    .filter((pack) => !filter || filter === "due" || pack.status === filter)
    .filter((pack) => !dueIds || dueIds.has(pack.id))
    .map((pack) => ({
      id: pack.id,
      projectId: pack.projectId,
      job: jobs.get(pack.projectId) ?? "",
      status: pack.status,
      statusLabel: STATUS_LABEL[pack.status] ?? pack.status,
      readiness: readinessOf(actor.orgId, pack.id),
      deliveredOn: (pack.deliveredAt ?? "").slice(0, 10),
    }))
    .sort((a, b) => a.job.localeCompare(b.job));
}

export function handoverDetail(actor: Actor, packageId: string) {
  const pack = packageOf(actor.orgId, packageId);
  if (!pack) return null;
  return detailOf(actor, pack);
}

export function addSection(actor: Actor, packageId: string, title: string) {
  office(actor);
  const pack = requirePackage(actor, packageId);
  const name = bound(title, 120);
  if (!name) throw new ServiceError("Enter a section.");
  const { sections } = rowsFor(actor.orgId, pack.id);
  const sectionId = id("hsec");
  getDb()
    .insert(handoverSections)
    .values({
      id: sectionId,
      orgId: actor.orgId,
      packageId: pack.id,
      kind: "custom",
      title: name,
      sortOrder: sections.reduce((max, section) => Math.max(max, section.sortOrder), -1) + 1,
    })
    .run();
  audit(actor.orgId, actor.userId, "handover.section", pack.id, { sectionId });
  return sectionId;
}

function sectionOf(orgId: string, sectionId: string) {
  return getDb()
    .select()
    .from(handoverSections)
    .where(and(eq(handoverSections.orgId, orgId), eq(handoverSections.id, sectionId)))
    .get();
}

export function moveSection(actor: Actor, sectionId: string, direction: "up" | "down") {
  office(actor);
  const section = sectionOf(actor.orgId, sectionId);
  if (!section) throw new ServiceError("That section is not in your company.");
  const { sections } = rowsFor(actor.orgId, section.packageId);
  const index = sections.findIndex((row) => row.id === section.id);
  const swap = index + (direction === "up" ? -1 : 1);
  if (index < 0 || swap < 0 || swap >= sections.length) return;
  const other = sections[swap]!;
  const db = getDb();
  db.transaction((tx) => {
    tx.update(handoverSections).set({ sortOrder: other.sortOrder }).where(and(eq(handoverSections.id, section.id), eq(handoverSections.orgId, actor.orgId))).run();
    tx.update(handoverSections).set({ sortOrder: section.sortOrder }).where(and(eq(handoverSections.id, other.id), eq(handoverSections.orgId, actor.orgId))).run();
  });
}

export function removeSection(actor: Actor, sectionId: string) {
  office(actor);
  const section = sectionOf(actor.orgId, sectionId);
  if (!section) throw new ServiceError("That section is not in your company.");
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(handoverItems).where(and(eq(handoverItems.orgId, actor.orgId), eq(handoverItems.sectionId, section.id))).run();
    tx.delete(handoverSections).where(and(eq(handoverSections.orgId, actor.orgId), eq(handoverSections.id, section.id))).run();
  });
  const pack = packageOf(actor.orgId, section.packageId);
  if (pack?.status === "ready" && readinessOf(actor.orgId, pack.id) > 0) {
    db.update(handoverPackages).set({ status: "draft", updatedAt: nowIso() }).where(and(eq(handoverPackages.id, pack.id), eq(handoverPackages.orgId, actor.orgId))).run();
  }
}

export function addItem(actor: Actor, sectionId: string, title: string) {
  office(actor);
  const section = sectionOf(actor.orgId, sectionId);
  if (!section) throw new ServiceError("That section is not in your company.");
  const name = bound(title, 160);
  if (!name) throw new ServiceError("Enter an item.");
  const { items } = rowsFor(actor.orgId, section.packageId);
  const mine = items.filter((item) => item.sectionId === section.id);
  const itemId = id("hit");
  const db = getDb();
  db.insert(handoverItems)
    .values({
      id: itemId,
      orgId: actor.orgId,
      packageId: section.packageId,
      sectionId: section.id,
      sortOrder: mine.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1,
      title: name,
      manufacturer: "",
      model: "",
      serial: "",
      finish: "",
      installOn: null,
      warrantyMonths: null,
      warrantyEndsOn: null,
      documentId: null,
      intervalDays: null,
      intervalLabel: "",
      nextDueOn: null,
      sourceType: "",
      sourceId: null,
      vendorName: "",
      trade: "",
      phone: "",
    })
    .run();
  const pack = packageOf(actor.orgId, section.packageId);
  if (pack?.status === "ready" && section.kind === "installed") {
    db.update(handoverPackages).set({ status: "draft", updatedAt: nowIso() }).where(and(eq(handoverPackages.id, pack.id), eq(handoverPackages.orgId, actor.orgId))).run();
  }
  return itemId;
}

function itemOf(orgId: string, itemId: string) {
  return getDb()
    .select()
    .from(handoverItems)
    .where(and(eq(handoverItems.orgId, orgId), eq(handoverItems.id, itemId)))
    .get();
}

function documentOnJob(orgId: string, projectId: string, documentId: string) {
  const doc = getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.orgId, orgId)))
    .get();
  if (!doc || doc.deletedAt || doc.projectId !== projectId) throw new ServiceError("That file is not on this job.");
  return doc;
}

export function saveItem(actor: Actor, itemId: string, input: ItemInput) {
  office(actor);
  const item = itemOf(actor.orgId, itemId);
  if (!item) throw new ServiceError("That item is not in your company.");
  const pack = requirePackage(actor, item.packageId);
  const title = input.title === undefined ? item.title : bound(input.title, 160);
  if (!title) throw new ServiceError("Enter an item.");
  const installOn = input.installOn === undefined ? item.installOn : dayOrNull(input.installOn);
  const months = input.warrantyMonths === undefined ? item.warrantyMonths : intOrNull(input.warrantyMonths, "Warranty", 1200);
  const intervalDays = input.intervalDays === undefined ? item.intervalDays : intOrNull(input.intervalDays, "Interval", 3650);
  let documentId = item.documentId;
  if (input.documentId !== undefined) {
    const picked = input.documentId.trim();
    documentId = picked ? documentOnJob(actor.orgId, pack.projectId, picked).id : null;
  }
  const today = todayFor(actor.orgId);
  getDb()
    .update(handoverItems)
    .set({
      title,
      manufacturer: input.manufacturer === undefined ? item.manufacturer : bound(input.manufacturer, 120),
      model: input.model === undefined ? item.model : bound(input.model, 120),
      serial: input.serial === undefined ? item.serial : bound(input.serial, 120),
      finish: input.finish === undefined ? item.finish : bound(input.finish, 120),
      installOn,
      warrantyMonths: months,
      warrantyEndsOn: warrantyEnd(installOn, months),
      documentId,
      intervalDays,
      intervalLabel: input.intervalLabel === undefined ? item.intervalLabel : bound(input.intervalLabel, 80),
      nextDueOn: nextMaintenance(installOn, intervalDays, today),
      vendorName: input.vendorName === undefined ? item.vendorName : bound(input.vendorName, 120),
      trade: input.trade === undefined ? item.trade : bound(input.trade, 80),
      phone: input.phone === undefined ? item.phone : bound(input.phone, 40),
    })
    .where(and(eq(handoverItems.id, item.id), eq(handoverItems.orgId, actor.orgId)))
    .run();
  if (pack.status === "ready" && readinessOf(actor.orgId, pack.id) > 0) {
    getDb().update(handoverPackages).set({ status: "draft", updatedAt: nowIso() }).where(and(eq(handoverPackages.id, pack.id), eq(handoverPackages.orgId, actor.orgId))).run();
  }
}

export function attachDoc(actor: Actor, itemId: string, documentId: string) {
  saveItem(actor, itemId, { documentId });
}

export function moveItem(actor: Actor, itemId: string, direction: "up" | "down") {
  office(actor);
  const item = itemOf(actor.orgId, itemId);
  if (!item) throw new ServiceError("That item is not in your company.");
  const siblings = rowsFor(actor.orgId, item.packageId).items.filter((row) => row.sectionId === item.sectionId);
  const index = siblings.findIndex((row) => row.id === item.id);
  const swap = index + (direction === "up" ? -1 : 1);
  if (index < 0 || swap < 0 || swap >= siblings.length) return;
  const other = siblings[swap]!;
  const db = getDb();
  db.transaction((tx) => {
    tx.update(handoverItems).set({ sortOrder: other.sortOrder }).where(and(eq(handoverItems.id, item.id), eq(handoverItems.orgId, actor.orgId))).run();
    tx.update(handoverItems).set({ sortOrder: item.sortOrder }).where(and(eq(handoverItems.id, other.id), eq(handoverItems.orgId, actor.orgId))).run();
  });
}

export function removeItem(actor: Actor, itemId: string) {
  office(actor);
  const item = itemOf(actor.orgId, itemId);
  if (!item) throw new ServiceError("That item is not in your company.");
  getDb().delete(handoverItems).where(and(eq(handoverItems.id, item.id), eq(handoverItems.orgId, actor.orgId))).run();
}

export function markReady(actor: Actor, packageId: string) {
  office(actor);
  const pack = requirePackage(actor, packageId);
  if (pack.status === "delivered") return;
  if (readinessOf(actor.orgId, pack.id) > 0) throw new ServiceError("Add the missing documents.");
  const stamp = nowIso();
  getDb()
    .update(handoverPackages)
    .set({ status: "ready", updatedAt: stamp })
    .where(and(eq(handoverPackages.id, pack.id), eq(handoverPackages.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "handover.ready", pack.id, null);
}

export function publishHandover(actor: Actor, packageId: string) {
  office(actor);
  const pack = requirePackage(actor, packageId);
  if (pack.status === "draft") throw new ServiceError("Mark the package ready.");
  if (pack.publishedAt) return;
  const stamp = nowIso();
  getDb()
    .update(handoverPackages)
    .set({ publishedAt: stamp, publishedBy: actor.userId, updatedAt: stamp })
    .where(and(eq(handoverPackages.id, pack.id), eq(handoverPackages.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "handover.publish", pack.id, null);
}

export function markDelivered(actor: Actor, packageId: string) {
  office(actor);
  const pack = requirePackage(actor, packageId);
  if (pack.status === "draft") throw new ServiceError("Mark the package ready.");
  if (readinessOf(actor.orgId, pack.id) > 0) throw new ServiceError("Add the missing documents.");
  const stamp = nowIso();
  getDb()
    .update(handoverPackages)
    .set({
      status: "delivered",
      deliveredAt: stamp,
      deliveredBy: actor.userId,
      publishedAt: pack.publishedAt ?? stamp,
      publishedBy: pack.publishedBy ?? actor.userId,
      updatedAt: stamp,
    })
    .where(and(eq(handoverPackages.id, pack.id), eq(handoverPackages.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "handover.deliver", pack.id, null);
}

export function copyHandover(actor: Actor, packageId: string) {
  office(actor);
  const pack = requirePackage(actor, packageId);
  const stamp = nowIso();
  getDb()
    .update(handoverPackages)
    .set({ copiedAt: stamp, copiedBy: actor.userId, updatedAt: stamp })
    .where(and(eq(handoverPackages.id, pack.id), eq(handoverPackages.orgId, actor.orgId)))
    .run();
  audit(actor.orgId, actor.userId, "handover.copy", pack.id, null);
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function handoversCsv(actor: Actor, query: HandoverQuery = {}) {
  const rows = listHandovers(actor, query);
  const lines = ["job,status,section,item,install,warranty end,next due,missing"];
  for (const row of rows) {
    const detail = handoverDetail(actor, row.id);
    if (!detail || detail.sections.length === 0) {
      lines.push([csvCell(row.job), row.status, "", "", "", "", "", String(row.readiness)].join(","));
      continue;
    }
    for (const section of detail.sections) {
      if (section.items.length === 0) {
        lines.push([csvCell(row.job), row.status, csvCell(section.title), "", "", "", "", "0"].join(","));
        continue;
      }
      for (const item of section.items) {
        lines.push(
          [
            csvCell(row.job),
            row.status,
            csvCell(section.title),
            csvCell(item.title),
            item.installOn,
            item.warrantyEndsOn,
            item.nextDueOn,
            section.kind === "installed" && item.missing ? "1" : "0",
          ].join(","),
        );
      }
    }
  }
  return lines.join("\n");
}

export function handoverAttention(actor: Actor) {
  const today = todayFor(actor.orgId);
  const { hits, packs } = duePackageIds(actor.orgId, today);
  const jobs = new Map(
    getDb()
      .select()
      .from(projects)
      .where(eq(projects.orgId, actor.orgId))
      .all()
      .map((project) => [project.id, project.name]),
  );
  const packById = new Map(packs.map((pack) => [pack.id, pack]));
  const notes = hits
    .sort((a, b) => (a.nextDueOn ?? "").localeCompare(b.nextDueOn ?? ""))
    .slice(0, 8)
    .map((item) => {
      const pack = packById.get(item.packageId);
      const job = pack ? jobs.get(pack.projectId) ?? "" : "";
      return [job, item.title, item.nextDueOn ?? ""].filter(Boolean).join(" · ");
    });
  return { count: hits.length, href: hits.length > 0 ? "/handover?filter=due" : null, note: notes.join("\n") };
}

function portalShape(orgId: string, pack: typeof handoverPackages.$inferSelect, project: typeof projects.$inferSelect) {
  const { sections, items } = rowsFor(orgId, pack.id);
  const docs = getDb().select().from(documents).where(eq(documents.orgId, orgId)).all();
  const names = new Map(docs.map((doc) => [doc.id, doc.filename]));
  return {
    id: pack.id,
    job: project.name,
    address: project.address ?? "",
    closedOn: (project.closedAt ?? project.endDate ?? "").slice(0, 10),
    warrantyEndsOn: project.warrantyEndsOn ?? "",
    sections: sections.map((section) => ({
      id: section.id,
      kind: section.kind,
      title: section.title,
      items: items.filter((item) => item.sectionId === section.id).map((item) => shapeItem(item, names)),
    })),
  };
}

export type PortalHandover = ReturnType<typeof portalShape>;

export function portalHandover(token: string): PortalHandover | null {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, token)).get();
  if (!project) return null;
  const pack = db
    .select()
    .from(handoverPackages)
    .where(and(eq(handoverPackages.orgId, project.orgId), eq(handoverPackages.projectId, project.id)))
    .get();
  if (!pack?.publishedAt) return null;
  return portalShape(project.orgId, pack, project);
}

export function publicHandover(token: string): PortalHandover | null {
  const db = getDb();
  const pack = db.select().from(handoverPackages).where(eq(handoverPackages.shareToken, token)).get();
  if (!pack?.publishedAt) return null;
  const project = projectOf(pack.orgId, pack.projectId);
  if (!project) return null;
  return portalShape(pack.orgId, pack, project);
}
