import { and, eq } from "drizzle-orm";
import {
  bucketForecast,
  forecastCsv,
  forecastLines,
  type CashForecast,
  type CashLine,
  type CashSnap,
} from "@/lib/cash/forecast";
import { getDb } from "@/lib/db/client";
import {
  billLines,
  bills,
  changeOrders,
  contacts,
  draws,
  invoices,
  laborRates,
  leads,
  organizations,
  payments,
  projects,
  proposals,
  purchaseOrderLines,
  purchaseOrders,
  scheduleAssignees,
  scheduleItems,
  users,
} from "@/lib/db/schema";
import { canSeeCash, type Role } from "@/lib/permissions";
import { ServiceError } from "@/lib/services/errors";
import type { Actor } from "@/lib/services/read";
import { calendarForOrg } from "@/lib/services/time";
import { workCalendarFor } from "@/lib/services/work-calendar";
import { localDay } from "@/lib/time/calendar";

export type CashQuery = {
  projected: boolean;
  jobId: string;
  customerId: string;
};

export type CashBoard = {
  forecast: CashForecast;
  lines: CashLine[];
  jobs: { id: string; name: string }[];
  customers: { id: string; name: string; daysLate: number | null }[];
  openingCents: number;
  lowCents: number;
};

function assertCash(actor: Actor) {
  if (!canSeeCash(actor.role as Role)) throw new ServiceError("Your role cannot see this report.");
}

function snapFor(actor: Actor, projected: boolean): { snap: CashSnap; openingCents: number; lowCents: number } {
  const db = getDb();
  const orgId = actor.orgId;
  const org = db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .get();
  if (!org) throw new ServiceError("This company is not on the signed-in account.");
  const calendar = calendarForOrg(orgId);
  const today = localDay(Date.now(), calendar.timeZone);
  const people = db.select().from(contacts).where(eq(contacts.orgId, orgId)).all();
  const members = db.select().from(users).all();
  const memberName = new Map(members.map((member) => [member.id, member.name]));
  const jobRows = db.select().from(projects).where(eq(projects.orgId, orgId)).all();
  const leadRows = db.select().from(leads).where(eq(leads.orgId, orgId)).all();
  const proposalRows = db.select().from(proposals).where(eq(proposals.orgId, orgId)).all();
  const leadTitle = new Map(leadRows.map((lead) => [lead.id, lead.title]));
  const leadContact = new Map(leadRows.map((lead) => [lead.id, lead.contactId]));
  return {
    openingCents: org.cashOpeningCents,
    lowCents: org.cashLowCents,
    snap: {
      today,
      weekStartsOn: calendar.weekStartsOn,
      termsDays: org.paymentTermsDays,
      workdays: workCalendarFor(orgId, null),
      includeProjected: projected,
      projects: jobRows.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        contactId: project.contactId,
        endDate: project.endDate,
      })),
      contacts: people.map((person) => ({ id: person.id, name: person.name, daysLate: person.cashDaysLate })),
      invoices: db
        .select()
        .from(invoices)
        .where(eq(invoices.orgId, orgId))
        .all()
        .map((invoice) => ({
          id: invoice.id,
          projectId: invoice.projectId,
          number: invoice.number,
          status: invoice.status,
          type: invoice.type,
          dueDate: invoice.dueDate,
          totalCents: invoice.totalCents,
          amountPaidCents: invoice.amountPaidCents,
          retainageCents: invoice.retainageCents,
          applicationNumber: invoice.applicationNumber,
          changeOrderId: invoice.changeOrderId,
        })),
      payments: db
        .select()
        .from(payments)
        .where(eq(payments.orgId, orgId))
        .all()
        .map((payment) => ({ invoiceId: payment.invoiceId, status: payment.status, createdAt: payment.createdAt })),
      draws: db
        .select()
        .from(draws)
        .where(eq(draws.orgId, orgId))
        .all()
        .map((draw) => ({
          id: draw.id,
          projectId: draw.projectId,
          title: draw.title,
          amountCents: draw.amountCents,
          scheduleItemId: draw.scheduleItemId,
          dueOn: draw.dueOn,
          invoiceId: draw.invoiceId,
          changeOrderId: draw.changeOrderId,
        })),
      schedule: db
        .select()
        .from(scheduleItems)
        .where(eq(scheduleItems.orgId, orgId))
        .all()
        .map((item) => ({
          id: item.id,
          projectId: item.projectId,
          title: item.title,
          startDate: item.startDate,
          endDate: item.endDate,
          status: item.status,
        })),
      assignees: db
        .select()
        .from(scheduleAssignees)
        .where(eq(scheduleAssignees.orgId, orgId))
        .all()
        .map((row) => ({ itemId: row.itemId, userId: row.userId, name: memberName.get(row.userId) ?? "Crew" })),
      rates: db
        .select()
        .from(laborRates)
        .where(eq(laborRates.orgId, orgId))
        .all()
        .map((rate) => ({ userId: rate.userId, hourlyCostCents: rate.hourlyCostCents })),
      changes: db
        .select()
        .from(changeOrders)
        .where(eq(changeOrders.orgId, orgId))
        .all()
        .map((change) => ({
          id: change.id,
          projectId: change.projectId,
          number: change.number,
          title: change.title,
          status: change.status,
          priceDeltaCents: change.priceDeltaCents,
          approvedAt: change.approvedAt,
        })),
      bills: db
        .select()
        .from(bills)
        .where(eq(bills.orgId, orgId))
        .all()
        .map((bill) => ({
          id: bill.id,
          projectId: bill.projectId,
          number: bill.billNumber,
          status: bill.status,
          kind: bill.kind,
          amountCents: bill.amountCents,
          retainageCents: bill.retainageCents,
          dueDate: bill.dueDate,
          purchaseOrderId: bill.purchaseOrderId,
          vendorId: bill.vendorContactId,
        })),
      billLines: db
        .select()
        .from(billLines)
        .where(eq(billLines.orgId, orgId))
        .all()
        .map((row) => ({ billId: row.billId, costCode: row.costCode, amountCents: row.amountCents })),
      pos: db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.orgId, orgId))
        .all()
        .map((po) => ({
          id: po.id,
          projectId: po.projectId,
          number: po.number,
          status: po.status,
          issuedAt: po.issuedAt,
          vendorId: po.vendorContactId,
        })),
      poLines: db
        .select()
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.orgId, orgId))
        .all()
        .map((row) => ({
          purchaseOrderId: row.purchaseOrderId,
          costCode: row.costCode,
          description: row.description,
          amountCents: row.amountCents,
          expectedOn: row.expectedOn,
        })),
      proposals: proposalRows.map((proposal) => ({
        id: proposal.id,
        leadId: proposal.leadId,
        projectId: proposal.projectId,
        estimateId: proposal.estimateId,
        title: leadTitle.get(proposal.leadId) ?? "Proposal",
        status: proposal.status,
        totalCents: proposal.totalCents,
        sentAt: proposal.sentAt,
        expiresAt: proposal.expiresAt,
        contactId: leadContact.get(proposal.leadId) ?? "",
      })),
      leads: leadRows
        .filter((lead) => !lead.deletedAt)
        .map((lead) => ({
          id: lead.id,
          title: lead.title,
          status: lead.status,
          contactId: lead.contactId,
          valueCents: lead.valueEstCents ?? 0,
        })),
    },
  };
}

export function cashForecast(actor: Actor, query: CashQuery): CashBoard {
  assertCash(actor);
  const loaded = snapFor(actor, query.projected);
  const lines = forecastLines(loaded.snap).filter((row) => {
    if (query.jobId && row.jobId !== query.jobId) return false;
    if (query.customerId && row.customerId !== query.customerId) return false;
    return true;
  });
  const forecast = bucketForecast({
    today: loaded.snap.today,
    weekStartsOn: loaded.snap.weekStartsOn,
    openingCents: loaded.openingCents,
    lowCents: loaded.lowCents,
    includeProjected: query.projected,
    lines,
  });
  const jobs = loaded.snap.projects
    .map((project) => ({ id: project.id, name: project.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const customers = loaded.snap.contacts
    .map((contact) => ({ id: contact.id, name: contact.name, daysLate: contact.daysLate }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return { forecast, lines, jobs, customers, openingCents: loaded.openingCents, lowCents: loaded.lowCents };
}

export function cashCsv(actor: Actor, query: CashQuery): { filename: string; body: string } {
  const board = cashForecast(actor, query);
  return { filename: "cash-forecast.csv", body: forecastCsv(board.forecast) };
}

export function cashAlert(actor: Actor): { href: string; label: string; cents: number } | null {
  if (!canSeeCash(actor.role as Role)) return null;
  const board = cashForecast(actor, { projected: false, jobId: "", customerId: "" });
  if (!board.forecast.alert) return null;
  return { href: "/reports/cash", label: board.forecast.alert.label, cents: board.forecast.alert.cents };
}

export function saveCashSettings(
  actor: Actor,
  input: { openingCents: number; lowCents: number; contactId: string; daysLate: number | null },
) {
  assertCash(actor);
  if (!Number.isInteger(input.openingCents) || !Number.isInteger(input.lowCents)) throw new ServiceError("Enter amounts.");
  if (Math.abs(input.openingCents) > 100_000_000_00 || Math.abs(input.lowCents) > 100_000_000_00) throw new ServiceError("That amount is too large.");
  const db = getDb();
  const org = db.select().from(organizations).where(eq(organizations.id, actor.orgId)).get();
  if (!org) throw new ServiceError("This company is not on the signed-in account.");
  db.update(organizations)
    .set({ cashOpeningCents: input.openingCents, cashLowCents: input.lowCents, updatedAt: new Date().toISOString() })
    .where(eq(organizations.id, actor.orgId))
    .run();
  if (!input.contactId) return;
  const contact = db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, input.contactId), eq(contacts.orgId, actor.orgId)))
    .get();
  if (!contact) throw new ServiceError("That customer is not in your company.");
  if (input.daysLate != null && (!Number.isInteger(input.daysLate) || input.daysLate < 0 || input.daysLate > 180)) {
    throw new ServiceError("Days late is 0 to 180.");
  }
  db.update(contacts).set({ cashDaysLate: input.daysLate, updatedAt: new Date().toISOString() }).where(eq(contacts.id, contact.id)).run();
}
