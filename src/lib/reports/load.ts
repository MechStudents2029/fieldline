import { and, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import {
  bills,
  changeOrders,
  contacts,
  invoices,
  leads,
  payments,
  pipelineStages,
  projects,
  proposals,
  punchItems,
  scheduleItems,
  tasks,
  timeApprovals,
  timeEntries,
  users,
  vendorCertificates,
} from "@/lib/db/schema";
import { formatPercent, formatWhole } from "@/lib/money";
import { canEditCrm, canSeeMoney, type Role } from "@/lib/permissions";
import { CATALOG, customRecord, type CatalogColumn, type SourceId } from "@/lib/reports/catalog";
import type { EngineCell, EngineColumn, EngineRow } from "@/lib/reports/engine";
import { customCell, customColumns } from "@/lib/services/custom-fields";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { deliveryRows } from "@/lib/receiving/facts";
import { listTodos } from "@/lib/services/todos";
import { calendarForOrg, formatHours, splitsById, workedMinutes } from "@/lib/services/time";
import { burdenBpsFor, hourlyCostFor, otRulesFor } from "@/lib/time/post";
import { isNonJob, isShiftType, laborMoney } from "@/lib/time/overtime";
import { localDay } from "@/lib/time/calendar";
import { cashForecast } from "@/lib/services/cash";
import { wipReport } from "@/lib/services/wip";

const INSURANCE = new Set(["general_liability", "workers_comp"]);

function dbFor(actor: Actor): AppDatabase {
  const db = officeDb(actor.orgId);
  if (!db) throw new ServiceError("This company is not on the signed-in account.");
  return db;
}

function text(value: string, sort: string | number = value): EngineCell {
  return { text: value, sort, value: null };
}

function num(value: number, label = String(value)): EngineCell {
  return { text: label, sort: value, value };
}

function money(cents: number): EngineCell {
  return { text: formatWhole(cents), sort: cents, value: cents };
}

function date(day: string): EngineCell {
  return { text: day, sort: day, value: null };
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T12:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

function bucket(due: string, today: string): string {
  const late = daysBetween(due, today);
  if (late <= 0) return "Current";
  if (late <= 30) return "30";
  if (late <= 60) return "60";
  return "90+";
}

function attachCustom(actor: Actor, source: SourceId, rows: EngineRow[]): CatalogColumn[] {
  const recordType = customRecord(source);
  if (!recordType) return [];
  const columns = customColumns(actor, recordType);
  for (const row of rows) {
    for (const column of columns) {
      const cell = customCell(actor, row.id, column.key);
      const numeric = column.fieldType === "number" || column.fieldType === "money";
      const value = numeric && typeof cell.sort === "number" && cell.sort >= 0 ? cell.sort : null;
      row.cells[column.key] = { text: cell.text, sort: cell.sort, value };
    }
  }
  return columns.map((column) => ({
    key: column.key,
    label: column.label,
    kind: column.fieldType === "money" ? "money" : column.fieldType === "number" ? "number" : column.fieldType === "date" ? "date" : "text",
    money: column.fieldType === "money",
  }));
}

export function columnsFor(actor: Actor, source: SourceId, rows: EngineRow[]): EngineColumn[] {
  return [...CATALOG[source], ...attachCustom(actor, source, rows)];
}

export function loadSource(actor: Actor, source: SourceId, today: string): EngineRow[] {
  const db = dbFor(actor);
  if (source === "jobs") return loadJobs(actor, db);
  if (source === "clients") return loadClients(db, actor.orgId);
  if (source === "leads") return loadLeads(db, actor.orgId);
  if (source === "estimates") return loadProposals(db, actor.orgId, today);
  if (source === "invoices") return loadInvoices(db, actor.orgId, today);
  if (source === "payments") return loadPayments(db, actor.orgId);
  if (source === "bills") return loadBills(db, actor.orgId);
  if (source === "time") return loadTime(actor, db, today);
  if (source === "change_orders") return loadChanges(db, actor.orgId);
  if (source === "todos") return loadTodoRows(actor);
  if (source === "deliveries") return loadDeliveries(actor);
  if (source === "certificates") return loadCerts(db, actor.orgId, today);
  if (source === "cash") return loadCash(actor);
  if (source === "confirmations") return loadConfirmations(db, actor.orgId);
  return loadPunch(db, actor.orgId);
}

function loadDeliveries(actor: Actor): EngineRow[] {
  const see = canSeeMoney(actor.role as Role);
  return deliveryRows(actor.orgId, see).map((row) => ({
    id: row.id,
    href: see ? `/purchase-orders/${row.poId}` : "/deliveries",
    cells: {
      order: text(row.number),
      job: text(row.job),
      vendor: text(row.vendor),
      line: text(row.description),
      expected: date(row.expectedOn ?? ""),
      status: text(row.backordered ? `${row.label} · backordered` : row.label),
      qty: text(row.text),
    },
  }));
}

function loadCash(actor: Actor): EngineRow[] {
  const board = cashForecast(actor, { projected: false, jobId: "", customerId: "" });
  const net = board.forecast.rows.find((row) => row.id === "net");
  const balance = board.forecast.rows.find((row) => row.id === "balance");
  return board.forecast.columns
    .filter((column) => column.key !== "past")
    .map((column) => {
      const at = board.forecast.columns.findIndex((item) => item.key === column.key);
      return {
        id: column.key,
        href: "/reports/cash",
        cells: {
          week: { text: column.label, sort: column.key, value: null },
          net: money(net?.cells[at]?.cents ?? 0),
          balance: money(balance?.cells[at]?.cents ?? 0),
        },
      };
    });
}

function loadJobs(actor: Actor, db: AppDatabase): EngineRow[] {
  const orgId = actor.orgId;
  const people = db.select().from(contacts).where(eq(contacts.orgId, orgId)).all();
  const names = new Map(people.map((person) => [person.id, person.name]));
  const figures = new Map<string, { contract: number; cost: number; margin: number; under: number }>();
  if (canEditCrm(actor.role as Role)) {
    for (const row of wipReport(actor, { status: "all" }).rows) {
      figures.set(row.projectId, {
        contract: row.contractCents,
        cost: row.costToDateCents,
        margin: row.profitBps,
        under: Math.max(0, -row.overUnderCents),
      });
    }
  }
  const moneyOn = canSeeMoney(actor.role as Role);
  return db
    .select()
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .all()
    .map((project) => {
      const fig = figures.get(project.id);
      return {
        id: project.id,
        href: `/projects/${project.id}`,
        cells: {
          name: text(project.name),
          status: text(project.status),
          client: text(names.get(project.contactId) ?? ""),
          start: date((project.startDate ?? "").slice(0, 10)),
          contract: moneyOn && fig ? money(fig.contract) : money(0),
          cost: moneyOn && fig ? money(fig.cost) : money(0),
          margin: moneyOn && fig ? { text: formatPercent(fig.margin), sort: fig.margin, value: fig.margin } : num(0, "—"),
          under: moneyOn && fig ? money(fig.under) : money(0),
        },
      };
    });
}

function loadClients(db: AppDatabase, orgId: string): EngineRow[] {
  return db
    .select()
    .from(contacts)
    .where(and(eq(contacts.orgId, orgId), eq(contacts.type, "client"), isNull(contacts.deletedAt)))
    .all()
    .map((person) => ({
      id: person.id,
      href: `/contacts/${person.id}`,
      cells: {
        name: text(person.name),
        company: text(person.company ?? ""),
        city: text(person.city ?? ""),
        email: text(person.email ?? ""),
        phone: text(person.phone ?? ""),
        created: date(person.createdAt.slice(0, 10)),
      },
    }));
}

function loadLeads(db: AppDatabase, orgId: string): EngineRow[] {
  const stages = new Map(db.select().from(pipelineStages).where(eq(pipelineStages.orgId, orgId)).all().map((stage) => [stage.id, stage.name]));
  return db
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt)))
    .all()
    .map((lead) => ({
      id: lead.id,
      href: `/leads/${lead.id}`,
      cells: {
        title: text(lead.title),
        stage: text(stages.get(lead.stageId) ?? ""),
        status: text(lead.status),
        source: text(lead.source),
        value: money(lead.valueEstCents ?? 0),
        created: date(lead.createdAt.slice(0, 10)),
      },
    }));
}

function loadProposals(db: AppDatabase, orgId: string, today: string): EngineRow[] {
  const leadRows = db.select().from(leads).where(eq(leads.orgId, orgId)).all();
  const people = new Map(db.select().from(contacts).where(eq(contacts.orgId, orgId)).all().map((person) => [person.id, person.name]));
  const titles = new Map(leadRows.map((lead) => [lead.id, { title: lead.title, client: people.get(lead.contactId) ?? "" }]));
  return db
    .select()
    .from(proposals)
    .where(eq(proposals.orgId, orgId))
    .all()
    .map((proposal) => {
      const meta = titles.get(proposal.leadId);
      const decided = proposal.signedAt || proposal.declinedAt || proposal.sentAt || proposal.createdAt;
      const month = decided.slice(0, 7);
      const won = proposal.status === "signed";
      const sent = (proposal.sentAt ?? "").slice(0, 10);
      const age = sent ? Math.max(0, daysBetween(sent, today)) : 0;
      return {
        id: proposal.id,
        href: proposal.projectId ? `/projects/${proposal.projectId}` : `/leads/${proposal.leadId}`,
        cells: {
          title: text(meta?.title ?? "Proposal"),
          client: text(meta?.client ?? ""),
          status: text(proposal.status),
          sent: date(sent),
          age: num(age),
          amount: won || proposal.status === "sent" || proposal.status === "viewed" ? money(proposal.totalCents) : money(0),
          month: text(month),
          won: num(won ? 1 : 0),
          rate: { text: won ? "100%" : "0%", sort: won ? 10000 : 0, value: won ? 10000 : 0 },
        },
      };
    });
}

function loadInvoices(db: AppDatabase, orgId: string, today: string): EngineRow[] {
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((project) => [project.id, project.name]));
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.orgId, orgId))
    .all()
    .map((invoice) => {
      const balance = Math.max(0, invoice.totalCents - invoice.amountPaidCents);
      const due = invoice.dueDate.slice(0, 10);
      return {
        id: invoice.id,
        href: `/projects/${invoice.projectId}`,
        cells: {
          number: text(invoice.number),
          job: text(jobs.get(invoice.projectId) ?? ""),
          status: text(invoice.status),
          issued: date(invoice.issueDate.slice(0, 10)),
          due: date(due),
          balance: money(balance),
          bucket: text(balance > 0 && (invoice.status === "open" || invoice.status === "paid") ? bucket(due, today) : "Paid"),
        },
      };
    })
    .filter((row) => row.cells.balance?.value && row.cells.status?.text === "open");
}

function loadPayments(db: AppDatabase, orgId: string): EngineRow[] {
  const numbers = new Map(db.select().from(invoices).where(eq(invoices.orgId, orgId)).all().map((invoice) => [invoice.id, invoice.number]));
  return db
    .select()
    .from(payments)
    .where(eq(payments.orgId, orgId))
    .all()
    .map((payment) => ({
      id: payment.id,
      cells: {
        invoice: text(numbers.get(payment.invoiceId) ?? ""),
        method: text(payment.method),
        status: text(payment.status),
        paid: date(payment.createdAt.slice(0, 10)),
        amount: money(payment.amountCents),
      },
    }));
}

function loadBills(db: AppDatabase, orgId: string): EngineRow[] {
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((project) => [project.id, project.name]));
  const vendors = new Map(db.select().from(contacts).where(eq(contacts.orgId, orgId)).all().map((person) => [person.id, person.name]));
  return db
    .select()
    .from(bills)
    .where(eq(bills.orgId, orgId))
    .all()
    .map((bill) => ({
      id: bill.id,
      href: "/bills",
      cells: {
        number: text(bill.billNumber),
        vendor: text(vendors.get(bill.vendorContactId ?? "") ?? ""),
        job: text(jobs.get(bill.projectId) ?? ""),
        status: text(bill.status),
        due: date((bill.dueDate ?? "").slice(0, 10)),
        amount: money(bill.amountCents),
      },
    }));
}

function loadTime(actor: Actor, db: AppDatabase, today: string): EngineRow[] {
  const orgId = actor.orgId;
  const zone = calendarForOrg(orgId).timeZone;
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((project) => [project.id, project.name]));
  const people = new Map(db.select().from(users).all().map((user) => [user.id, user.name]));
  const rules = otRulesFor(db, orgId);
  const now = Date.parse(today + "T18:00:00Z") || Date.now();
  const field = actor.role === "field";
  const entries = db
    .select()
    .from(timeEntries)
    .where(eq(timeEntries.orgId, orgId))
    .all()
    .filter((entry) => entry.status !== "void")
    .filter((entry) => !field || entry.userId === actor.userId);
  const splits = splitsById(db, orgId, entries, now);
  const approvals = new Map(
    db
      .select()
      .from(timeApprovals)
      .where(and(eq(timeApprovals.orgId, orgId), eq(timeApprovals.status, "active")))
      .all()
      .map((row) => [row.entryId, row]),
  );
  return entries.map((entry) => {
    const split = splits.get(entry.id) ?? { id: entry.id, regularMinutes: 0, otMinutes: 0, dtMinutes: 0, nonjobMinutes: 0 };
    const minutes = workedMinutes(entry, now);
    const approval = approvals.get(entry.id);
    const legacy = approval != null && approval.baseCents + approval.premiumCents + approval.burdenCents === 0 && approval.amountCents > 0;
    const rate = hourlyCostFor(db, orgId, entry.userId) ?? 0;
    const priced = laborMoney(split, rate, rules, burdenBpsFor(db, orgId, entry.userId, rules));
    const cost = approval ? approval.amountCents : priced.totalCents;
    const premium = legacy ? 0 : approval ? approval.premiumCents : priced.premiumCents;
    const burden = legacy ? 0 : approval ? approval.burdenCents : priced.burdenCents;
    const jobMinutes = split.regularMinutes + split.otMinutes + split.dtMinutes;
    const share = jobMinutes > 0 ? Math.round((split.otMinutes * 10_000) / jobMinutes) : 0;
    const shift = isShiftType(entry.shiftType) ? entry.shiftType : "regular";
    const day = localDay(Date.parse(entry.clockInAt), zone);
    return {
      id: entry.id,
      href: "/time",
      cells: {
        job: text(entry.projectId ? (jobs.get(entry.projectId) ?? "") : "General"),
        code: text(entry.costCode),
        person: text(people.get(entry.userId) ?? ""),
        day: date(day),
        hours: num(Math.round((minutes / 60) * 10) / 10, formatHours(minutes)),
        ot: num(Math.round((split.otMinutes / 60) * 10) / 10, formatHours(split.otMinutes)),
        dt: num(Math.round((split.dtMinutes / 60) * 10) / 10, formatHours(split.dtMinutes)),
        pto: num(Math.round((split.nonjobMinutes / 60) * 10) / 10, formatHours(split.nonjobMinutes)),
        premium: money(isNonJob(shift) ? 0 : premium),
        burden: money(isNonJob(shift) ? 0 : burden),
        cost: money(isNonJob(shift) ? 0 : cost),
        share: { text: formatPercent(share), sort: share, value: share },
      },
    };
  });
}

function loadChanges(db: AppDatabase, orgId: string): EngineRow[] {
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((project) => [project.id, project.name]));
  return db
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.orgId, orgId))
    .all()
    .map((order) => ({
      id: order.id,
      href: `/projects/${order.projectId}`,
      cells: {
        title: text(order.title),
        job: text(jobs.get(order.projectId) ?? ""),
        status: text(order.status),
        sent: date((order.sentAt ?? order.createdAt).slice(0, 10)),
        price: money(order.priceDeltaCents),
      },
    }));
}

function loadTodoRows(actor: Actor): EngineRow[] {
  return listTodos(actor, { status: "all" }).map((todo) => ({
    id: todo.id,
    href: "/todos",
    cells: {
      title: text(todo.title),
      job: text(todo.projectName),
      status: text(todo.status),
      assignee: text(todo.assignees.map((person) => person.name).join(", ")),
      due: date((todo.dueAt ?? "").slice(0, 10)),
    },
  }));
}

function loadCerts(db: AppDatabase, orgId: string, today: string): EngineRow[] {
  const vendors = new Map(db.select().from(contacts).where(eq(contacts.orgId, orgId)).all().map((person) => [person.id, person.name]));
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 30);
  const soon = limit.toISOString().slice(0, 10);
  return db
    .select()
    .from(vendorCertificates)
    .where(eq(vendorCertificates.orgId, orgId))
    .all()
    .filter((cert) => INSURANCE.has(cert.type) && cert.expiresOn.slice(0, 10) <= soon)
    .map((cert) => {
      const day = cert.expiresOn.slice(0, 10);
      const label = cert.type === "workers_comp" ? "Workers comp" : "General liability";
      return {
        id: cert.id,
        href: `/contacts/${cert.contactId}`,
        cells: {
          vendor: text(vendors.get(cert.contactId) ?? ""),
          type: text(label),
          expires: date(day),
          state: text(day < today ? "Expired" : "Expiring"),
        },
      };
    });
}

function loadConfirmations(db: AppDatabase, orgId: string): EngineRow[] {
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((project) => [project.id, project.name]));
  const vendors = new Map(db.select().from(contacts).where(eq(contacts.orgId, orgId)).all().map((row) => [row.id, row.company?.trim() || row.name]));
  return db
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.orgId, orgId))
    .all()
    .filter((row) => row.vendorContactId)
    .map((row) => ({
      id: row.id,
      href: `/schedule/items/${row.id}`,
      cells: {
        job: text(jobs.get(row.projectId) ?? ""),
        item: text(row.title),
        vendor: text(vendors.get(row.vendorContactId ?? "") ?? ""),
        status: text(row.confirmStatus === "requested" ? "Requested" : row.confirmStatus === "confirmed" ? "Confirmed" : row.confirmStatus === "declined" ? "Declined" : ""),
        start: date(row.startDate),
        proposed: date(row.confirmProposed ?? ""),
      },
    }));
}

function loadPunch(db: AppDatabase, orgId: string): EngineRow[] {
  const jobs = new Map(db.select().from(projects).where(eq(projects.orgId, orgId)).all().map((project) => [project.id, project.name]));
  return db
    .select()
    .from(punchItems)
    .where(eq(punchItems.orgId, orgId))
    .all()
    .map((item) => ({
      id: item.id,
      href: `/projects/${item.projectId}`,
      cells: {
        title: text(item.title),
        job: text(jobs.get(item.projectId) ?? ""),
        status: text(item.status),
        due: date((item.dueDate ?? "").slice(0, 10)),
      },
    }));
}

export function orgToday(orgId: string): string {
  return localDay(Date.now(), calendarForOrg(orgId).timeZone);
}
