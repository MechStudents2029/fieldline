import { and, asc, desc, eq, inArray, isNull, like, notInArray, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { officeDb } from "@/lib/db/office";
import { officeClaim } from "@/lib/db/rls-context";
import { supabaseAuthConfigured } from "@/lib/supabase/env";
import {
  activities,
  bills,
  budgetLines,
  changeOrderLines,
  changeOrders,
  contacts,
  costItems,
  documents,
  estimateSections,
  estimates,
  followUpDrafts,
  integrationConnections,
  invoiceLines,
  invoices,
  leads,
  lineItems,
  memberships,
  messageThreads,
  messages,
  organizations,
  payments,
  pipelineStages,
  priceBookItems,
  projects,
  proposals,
  signatures,
  tasks,
  testerFeedback,
  users,
} from "@/lib/db/schema";
import { marginBps, lineAmounts } from "@/lib/money";
import { assessCategories, costCodeKey, rollupCostCodes, type CategoryAssessment, type CoveringLine } from "@/lib/margin/category";
import { openCommitments } from "@/lib/services/purchase-orders";
import { canSeeMoney, type Role } from "@/lib/permissions";
import { verifyPassword } from "@/lib/auth/password";
import { daysSince } from "@/lib/format";
import { readReceiptMeta } from "@/lib/ai/receipt";
import { needsProposalNudge } from "@/lib/ai/nurture";
import { marginThresholdFromQuestion, routeCopilotQuestion, type CopilotTool } from "@/lib/ai/copilot";
import { clientDailyLogs, jobLogAnswer } from "@/lib/services/logs";
import { qboCustomersCsv as renderQboCustomers, qboImportLimitWarning, qboInvoicesCsv as renderQboInvoices } from "@/lib/export/qbo";
import type { StoredSnapshot } from "@/lib/domain/snapshot";

export type Actor = {
  userId: string;
  orgId: string;
  role: Role;
  name: string;
  email: string;
  orgName: string;
  authUserId: string | null;
};

export function listLoginChoices() {
  const db = getDb();
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      title: users.title,
      role: memberships.role,
      orgId: organizations.id,
      orgName: organizations.name,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(like(users.email, "%.demo"))
    .orderBy(asc(organizations.name), asc(users.name))
    .all();
}

export function authenticate(email: string, password: string): Actor | null {
  const db = getDb();
  const user = db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) return null;
  const membership = db.select().from(memberships).where(eq(memberships.userId, user.id)).get();
  if (!membership) return null;
  const org = db.select().from(organizations).where(eq(organizations.id, membership.orgId)).get();
  if (!org) return null;
  return {
    userId: user.id,
    orgId: org.id,
    role: membership.role as Role,
    name: user.name,
    email: user.email,
    orgName: org.name,
    authUserId: user.authUserId,
  };
}

export function actorFromIds(userId: string, orgId: string): Actor | null {
  const claim = officeClaim();
  const db = claim && supabaseAuthConfigured() ? officeDb(orgId) : getDb();
  if (!db) return null;
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  const membership = db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
    .get();
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  if (!user || !membership || !org) return null;
  if (claim && supabaseAuthConfigured() && user.authUserId !== claim.authUserId) return null;
  return {
    userId: user.id,
    orgId: org.id,
    role: membership.role as Role,
    name: user.name,
    email: user.email,
    orgName: org.name,
    authUserId: user.authUserId,
  };
}

export function getOrg(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return null;
  return db.select().from(organizations).where(eq(organizations.id, orgId)).get() ?? null;
}

export function pipelineBoard(orgId: string, filters?: { q?: string; source?: string }) {
  const db = officeDb(orgId);
  if (!db) return { stages: [], cards: [], sources: [] as string[] };
  const stages = db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.orgId, orgId))
    .orderBy(asc(pipelineStages.sortOrder))
    .all();
  const q = filters?.q?.trim();
  const rows = db
    .select({ lead: leads, contact: contacts, stage: pipelineStages })
    .from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .where(
      and(
        eq(leads.orgId, orgId),
        isNull(leads.deletedAt),
        filters?.source ? eq(leads.source, filters.source) : undefined,
        q
          ? or(like(leads.title, `%${q}%`), like(contacts.name, `%${q}%`), like(leads.source, `%${q}%`))
          : undefined,
      ),
    )
    .orderBy(desc(leads.updatedAt))
    .all();
  const sources = [
    ...new Set(
      db
        .select({ source: leads.source })
        .from(leads)
        .where(and(eq(leads.orgId, orgId), isNull(leads.deletedAt)))
        .all()
        .map((row) => row.source),
    ),
  ];
  return { stages, cards: rows, sources };
}

export function leadDetail(orgId: string, leadId: string) {
  const db = officeDb(orgId);
  if (!db) return null;
  const lead = db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId), isNull(leads.deletedAt)))
    .get();
  if (!lead) return null;
  const contact = db.select().from(contacts).where(eq(contacts.id, lead.contactId)).get();
  const stage = db.select().from(pipelineStages).where(eq(pipelineStages.id, lead.stageId)).get();
  const owner = lead.ownerUserId ? db.select().from(users).where(eq(users.id, lead.ownerUserId)).get() : null;
  const estimateRows = db
    .select()
    .from(estimates)
    .where(and(eq(estimates.leadId, leadId), eq(estimates.orgId, orgId)))
    .orderBy(desc(estimates.version))
    .all();
  const proposalRows = db
    .select()
    .from(proposals)
    .where(and(eq(proposals.leadId, leadId), eq(proposals.orgId, orgId)))
    .orderBy(desc(proposals.createdAt))
    .all();
  const timeline = db
    .select()
    .from(activities)
    .where(and(eq(activities.orgId, orgId), eq(activities.entityType, "lead"), eq(activities.entityId, leadId)))
    .orderBy(desc(activities.createdAt))
    .all();
  const taskRows = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), eq(tasks.relatedType, "lead"), eq(tasks.relatedId, leadId)))
    .all();
  const photos = db
    .select()
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.leadId, leadId), isNull(documents.deletedAt)))
    .all();
  const threads = db
    .select()
    .from(messageThreads)
    .where(and(eq(messageThreads.orgId, orgId), eq(messageThreads.leadId, leadId)))
    .all();
  const threadMessages = threads.length
    ? db
        .select()
        .from(messages)
        .where(inArray(messages.threadId, threads.map((thread) => thread.id)))
        .orderBy(asc(messages.createdAt))
        .all()
    : [];
  return { lead, contact, stage, owner, estimates: estimateRows, proposals: proposalRows, timeline, tasks: taskRows, photos, messages: threadMessages };
}

export function estimateDetail(orgId: string, estimateId: string) {
  const db = officeDb(orgId);
  if (!db) return null;
  const estimate = db
    .select()
    .from(estimates)
    .where(and(eq(estimates.id, estimateId), eq(estimates.orgId, orgId)))
    .get();
  if (!estimate) return null;
  const lead = db.select().from(leads).where(eq(leads.id, estimate.leadId)).get();
  const contact = lead ? db.select().from(contacts).where(eq(contacts.id, lead.contactId)).get() : null;
  const sections = db
    .select()
    .from(estimateSections)
    .where(eq(estimateSections.estimateId, estimateId))
    .orderBy(asc(estimateSections.sortOrder))
    .all();
  const lines = db
    .select()
    .from(lineItems)
    .where(eq(lineItems.estimateId, estimateId))
    .orderBy(asc(lineItems.sortOrder))
    .all();
  let cost = 0;
  let price = 0;
  const priced = lines.map((line) => {
    const amounts = lineAmounts(line.qtyMilli, line.unitCostCents, line.markupBps);
    cost += amounts.cost;
    price += amounts.price;
    return { ...line, costCents: amounts.cost, priceCents: amounts.price };
  });
  const proposalRows = db.select().from(proposals).where(eq(proposals.estimateId, estimateId)).all();
  const locked = proposalRows.some((row) => ["sent", "viewed", "signed", "declined"].includes(row.status));
  return {
    estimate,
    lead,
    contact,
    sections,
    lines: priced,
    costCents: cost,
    priceCents: price,
    marginBps: marginBps(price, cost),
    locked,
    proposals: proposalRows,
  };
}

export function listContacts(orgId: string, q?: string, type?: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  const query = q?.trim();
  return db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.orgId, orgId),
        isNull(contacts.deletedAt),
        type ? eq(contacts.type, type) : undefined,
        query ? or(like(contacts.name, `%${query}%`), like(contacts.company, `%${query}%`), like(contacts.email, `%${query}%`)) : undefined,
      ),
    )
    .orderBy(asc(contacts.name))
    .all();
}

export function contactDetail(orgId: string, contactId: string) {
  const db = officeDb(orgId);
  if (!db) return null;
  const contact = db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId), isNull(contacts.deletedAt)))
    .get();
  if (!contact) return null;
  const leadRows = db.select().from(leads).where(and(eq(leads.contactId, contactId), eq(leads.orgId, orgId))).all();
  const projectRows = db.select().from(projects).where(and(eq(projects.contactId, contactId), eq(projects.orgId, orgId))).all();
  const threads = db.select().from(messageThreads).where(and(eq(messageThreads.contactId, contactId), eq(messageThreads.orgId, orgId))).all();
  const threadMessages = threads.length
    ? db.select().from(messages).where(inArray(messages.threadId, threads.map((thread) => thread.id))).orderBy(asc(messages.createdAt)).all()
    : [];
  const timeline = db
    .select()
    .from(activities)
    .where(and(eq(activities.orgId, orgId), eq(activities.entityType, "contact"), eq(activities.entityId, contactId)))
    .orderBy(desc(activities.createdAt))
    .all();
  return { contact, leads: leadRows, projects: projectRows, messages: threadMessages, timeline };
}

export function listProjects(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  const rows = db.select().from(projects).where(eq(projects.orgId, orgId)).orderBy(desc(projects.updatedAt)).all();
  const costs = db.select().from(costItems).where(eq(costItems.orgId, orgId)).all();
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  return rows.map((project) => {
    const actual = costs.filter((cost) => cost.projectId === project.id).reduce((sum, cost) => sum + cost.amountCents, 0);
    const bps = marginBps(project.contractValueCents, actual);
    return {
      project,
      actualCents: actual,
      marginBps: bps,
      alert: bps != null && org != null && bps < org.marginAlertBps,
    };
  });
}

export function projectDetail(orgId: string, projectId: string, role: Role) {
  const db = officeDb(orgId);
  if (!db) return null;
  const project = db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).get();
  if (!project) return null;
  const contact = db.select().from(contacts).where(eq(contacts.id, project.contactId)).get();
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get()!;
  const budget = db.select().from(budgetLines).where(eq(budgetLines.projectId, projectId)).all();
  const costs = db.select().from(costItems).where(eq(costItems.projectId, projectId)).all();
  const orders = db.select().from(changeOrders).where(eq(changeOrders.projectId, projectId)).orderBy(asc(changeOrders.number)).all();
  const orderLines = orders.length
    ? db.select().from(changeOrderLines).where(inArray(changeOrderLines.changeOrderId, orders.map((order) => order.id))).all()
    : [];
  const invoiceRows = db.select().from(invoices).where(eq(invoices.projectId, projectId)).orderBy(asc(invoices.createdAt)).all();
  const photos = db
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)))
    .all();
  const proposal = project.proposalId ? db.select().from(proposals).where(eq(proposals.id, project.proposalId)).get() : null;
  const lead = project.leadId ? db.select().from(leads).where(and(eq(leads.id, project.leadId), eq(leads.orgId, orgId))).get() : null;
  const owner = lead?.ownerUserId ? db.select().from(users).where(eq(users.id, lead.ownerUserId)).get() : null;
  const timeline = db
    .select()
    .from(activities)
    .where(and(eq(activities.orgId, orgId), eq(activities.entityType, "project"), eq(activities.entityId, projectId)))
    .orderBy(desc(activities.createdAt))
    .all();
  const actual = costs.reduce((sum, cost) => sum + cost.amountCents, 0);
  const bps = marginBps(project.contractValueCents, actual);
  const byCode = assessCategories(
    rollupCostCodes(budget, costs, openCommitments(orgId, [projectId])),
    coverLines(orders, orderLines, budget),
  );
  const money = canSeeMoney(role);
  return {
    project: money ? project : { ...project, contractValueCents: 0, originalContractCents: 0 },
    money,
    contact,
    org,
    budget: money ? budget : [],
    costs: money ? costs : [],
    orders: orders.map((order) => ({
      ...order,
      priceDeltaCents: money ? order.priceDeltaCents : 0,
      costDeltaCents: money ? order.costDeltaCents : 0,
      lines: orderLines.filter((line) => line.changeOrderId === order.id),
    })),
    invoices: money ? invoiceRows : [],
    photos,
    proposal,
    ownerName: owner?.name ?? null,
    timeline,
    financials: money
      ? {
          contractCents: project.contractValueCents,
          actualCents: actual,
          profitCents: project.contractValueCents - actual,
          marginBps: bps,
          alert: bps != null && bps < org.marginAlertBps,
          thresholdBps: org.marginAlertBps,
          byCode,
        }
      : null,
  };
}

export function listEstimates(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  const rows = db
    .select({ estimate: estimates, lead: leads, contact: contacts })
    .from(estimates)
    .innerJoin(leads, eq(leads.id, estimates.leadId))
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .where(eq(estimates.orgId, orgId))
    .orderBy(desc(estimates.updatedAt))
    .all();
  const ids = rows.map((row) => row.estimate.id);
  const lines = ids.length
    ? db.select().from(lineItems).where(and(eq(lineItems.orgId, orgId), inArray(lineItems.estimateId, ids))).all()
    : [];
  return rows.map((row) => {
    const priceCents = lines
      .filter((line) => line.estimateId === row.estimate.id)
      .reduce((sum, line) => sum + lineAmounts(line.qtyMilli, line.unitCostCents, line.markupBps).price, 0);
    return { ...row, priceCents };
  });
}

export type OfficeChrome = {
  leadCount: number;
  estimateCount: number;
  invoiceCount: number;
  billCount: number;
  clientCount: number;
  pins: { id: string; name: string }[];
  jobs: { id: string; name: string }[];
  estimates: { id: string; title: string; status: string }[];
  clients: { id: string; name: string }[];
};

export function officeChrome(orgId: string): OfficeChrome {
  const db = officeDb(orgId);
  const projectRows = listProjects(orgId);
  const estimateRows = listEstimates(orgId);
  const invoiceRows = listInvoices(orgId);
  const clientRows = listContacts(orgId).filter((contact) => contact.type === "client");
  const openLeads = pipelineBoard(orgId).cards.filter((card) => card.stage.kind === "open");
  return {
    leadCount: openLeads.length,
    estimateCount: estimateRows.length,
    invoiceCount: invoiceRows.length,
    billCount: db ? db.select().from(bills).where(eq(bills.orgId, orgId)).all().length : 0,
    clientCount: clientRows.length,
    pins: projectRows
      .filter((row) => row.project.status === "active")
      .slice(0, 3)
      .map((row) => ({ id: row.project.id, name: row.project.name })),
    jobs: projectRows.map((row) => ({ id: row.project.id, name: row.project.name })),
    estimates: estimateRows.map((row) => ({ id: row.estimate.id, title: row.estimate.title, status: row.estimate.status })),
    clients: clientRows.map((contact) => ({ id: contact.id, name: contact.name })),
  };
}

export function listInvoices(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  return db
    .select({ invoice: invoices, project: projects, contact: contacts })
    .from(invoices)
    .innerJoin(projects, eq(projects.id, invoices.projectId))
    .innerJoin(contacts, eq(contacts.id, projects.contactId))
    .where(eq(invoices.orgId, orgId))
    .orderBy(desc(invoices.createdAt))
    .all();
}

export function listPriceBook(orgId: string, q?: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  const query = q?.trim();
  return db
    .select()
    .from(priceBookItems)
    .where(
      and(
        eq(priceBookItems.orgId, orgId),
        query
          ? or(
              like(priceBookItems.name, `%${query}%`),
              like(priceBookItems.code, `%${query}%`),
              like(priceBookItems.category, `%${query}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(priceBookItems.category), asc(priceBookItems.name))
    .all();
}

export function listTesterFeedback(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  return db
    .select({
      id: testerFeedback.id,
      path: testerFeedback.path,
      body: testerFeedback.body,
      context: testerFeedback.context,
      createdAt: testerFeedback.createdAt,
      author: users.name,
    })
    .from(testerFeedback)
    .leftJoin(users, eq(users.id, testerFeedback.userId))
    .where(eq(testerFeedback.orgId, orgId))
    .orderBy(desc(testerFeedback.createdAt))
    .all();
}

export function listDrafts(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  return db
    .select()
    .from(followUpDrafts)
    .where(eq(followUpDrafts.orgId, orgId))
    .orderBy(desc(followUpDrafts.createdAt))
    .all();
}

export function listTasks(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  return db.select().from(tasks).where(eq(tasks.orgId, orgId)).orderBy(asc(tasks.dueAt)).all();
}

export function integrations(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  return db.select().from(integrationConnections).where(eq(integrationConnections.orgId, orgId)).all();
}

export function dashboard(orgId: string) {
  const db = officeDb(orgId);
  if (!db) {
    return {
      org: undefined,
      pipelineCents: 0,
      openLeadCount: 0,
      receivableCents: 0,
      openInvoiceCount: 0,
      marginAlerts: [],
      categoryAlerts: [] as CategoryAlert[],
      unsigned: [],
      drafts: [],
      tasks: [],
    };
  }
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
  const openLeads = db
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, orgId), eq(leads.status, "open"), isNull(leads.deletedAt)))
    .all();
  const pipelineCents = openLeads.reduce((sum, lead) => sum + (lead.valueEstCents ?? 0), 0);
  const openInvoices = db.select().from(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.status, "open"))).all();
  const receivableCents = openInvoices.reduce((sum, invoice) => sum + (invoice.totalCents - invoice.amountPaidCents), 0);
  const margins = listProjects(orgId).filter((row) => row.alert);
  const unsigned = db
    .select()
    .from(proposals)
    .where(and(eq(proposals.orgId, orgId), inArray(proposals.status, ["sent", "viewed"])))
    .all()
    .filter((proposal) => needsProposalNudge(proposal.status, proposal.sentAt, Date.now(), proposal.viewedAt));
  const drafts = db
    .select()
    .from(followUpDrafts)
    .where(and(eq(followUpDrafts.orgId, orgId), eq(followUpDrafts.status, "pending")))
    .all();
  const taskRows = db.select().from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.status, "open"))).all();
  return {
    org,
    pipelineCents,
    openLeadCount: openLeads.length,
    receivableCents,
    openInvoiceCount: openInvoices.length,
    marginAlerts: margins,
    categoryAlerts: listCategoryAlerts(orgId),
    unsigned,
    drafts,
    tasks: taskRows,
  };
}

export type CategoryAlert = CategoryAssessment & { projectId: string; projectName: string };

export function listCategoryAlerts(orgId: string): CategoryAlert[] {
  const db = officeDb(orgId);
  if (!db) return [];
  const open = db
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, orgId), notInArray(projects.status, ["complete", "cancelled"])))
    .all();
  if (open.length === 0) return [];
  const ids = open.map((project) => project.id);
  const budget = db.select().from(budgetLines).where(and(eq(budgetLines.orgId, orgId), inArray(budgetLines.projectId, ids))).all();
  const costs = db.select().from(costItems).where(and(eq(costItems.orgId, orgId), inArray(costItems.projectId, ids))).all();
  const orders = db.select().from(changeOrders).where(and(eq(changeOrders.orgId, orgId), inArray(changeOrders.projectId, ids))).all();
  const lines = orders.length
    ? db.select().from(changeOrderLines).where(and(eq(changeOrderLines.orgId, orgId), inArray(changeOrderLines.changeOrderId, orders.map((order) => order.id)))).all()
    : [];
  const commitments = openCommitments(orgId, ids);
  const alerts: CategoryAlert[] = [];
  for (const project of open) {
    const projectBudget = budget.filter((line) => line.projectId === project.id);
    const projectCosts = costs.filter((cost) => cost.projectId === project.id);
    const projectOrders = orders.filter((order) => order.projectId === project.id);
    const projectCommitments = commitments.filter((row) => row.projectId === project.id);
    const assessed = assessCategories(rollupCostCodes(projectBudget, projectCosts, projectCommitments), coverLines(projectOrders, lines, projectBudget));
    for (const row of assessed) {
      if (row.level === "ok") continue;
      alerts.push({ ...row, projectId: project.id, projectName: project.name });
    }
  }
  return alerts.sort((a, b) => b.overageCents - a.overageCents || (b.percentOfBudget ?? 0) - (a.percentOfBudget ?? 0));
}

function coverLines(
  orders: { id: string; status: string }[],
  lines: { changeOrderId: string; costCode: string | null; qtyMilli: number; unitCostCents: number; markupBps: number }[],
  budget: { changeOrderId: string | null; costCode: string | null }[],
): CoveringLine[] {
  const covers: CoveringLine[] = [];
  for (const order of orders) {
    if (order.status !== "draft" && order.status !== "sent" && order.status !== "approved") continue;
    for (const line of lines.filter((item) => item.changeOrderId === order.id)) {
      const alreadyBudgeted =
        order.status === "approved" &&
        budget.some((item) => item.changeOrderId === order.id && costCodeKey(item.costCode) === costCodeKey(line.costCode));
      if (alreadyBudgeted) continue;
      covers.push({
        status: order.status,
        costCode: line.costCode,
        costCents: lineAmounts(line.qtyMilli, line.unitCostCents, line.markupBps).cost,
      });
    }
  }
  return covers;
}

export function receivables(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  return db
    .select({ invoice: invoices, project: projects, contact: contacts })
    .from(invoices)
    .innerJoin(projects, eq(projects.id, invoices.projectId))
    .innerJoin(contacts, eq(contacts.id, projects.contactId))
    .where(and(eq(invoices.orgId, orgId), eq(invoices.status, "open")))
    .all();
}

export function overdueProposals(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  return db
    .select({ proposal: proposals, lead: leads, contact: contacts })
    .from(proposals)
    .innerJoin(leads, eq(leads.id, proposals.leadId))
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .where(and(eq(proposals.orgId, orgId), inArray(proposals.status, ["sent", "viewed"])))
    .all()
    .filter((row) => needsProposalNudge(row.proposal.status, row.proposal.sentAt, Date.now(), row.proposal.viewedAt));
}

export function askCopilot(orgId: string, question: string, role: Role = "owner") {
  if (!canSeeMoney(role)) {
    return {
      tool: null as CopilotTool | null,
      answer: "Pricing is hidden for this role.",
      rows: [] as { label: string; amountCents: number | null; detail: string }[],
    };
  }
  const tool = routeCopilotQuestion(question);
  if (tool === "job_log") {
    const log = jobLogAnswer(orgId, question);
    return { tool, answer: log.answer, rows: log.rows };
  }
  if (!tool) {
    return {
      tool: null as CopilotTool | null,
      answer:
        "I can answer who owes you, which jobs are under a margin, what the open pipeline is worth, which proposals are unsigned, and what happened on a job yesterday. Try one of those.",
      rows: [] as { label: string; amountCents: number | null; detail: string }[],
    };
  }
  if (tool === "receivables") {
    const rows = receivables(orgId);
    const total = rows.reduce((sum, row) => sum + row.invoice.totalCents - row.invoice.amountPaidCents, 0);
    return {
      tool,
      answer:
        rows.length === 0
          ? "Nobody has an open invoice."
          : `${rows.length} open invoice${rows.length === 1 ? "" : "s"} total ${formatAnswer(total)}.`,
      rows: rows.map((row) => ({
        label: row.contact?.name ?? row.project.name,
        amountCents: row.invoice.totalCents - row.invoice.amountPaidCents,
        detail: `${row.invoice.number} · ${row.project.name}`,
      })),
    };
  }
  if (tool === "pipeline") {
    const board = pipelineBoard(orgId);
    const open = board.cards.filter((card) => card.lead.status === "open");
    const total = open.reduce((sum, card) => sum + (card.lead.valueEstCents ?? 0), 0);
    return {
      tool,
      answer: `${open.length} open deals, ${formatAnswer(total)} of estimated value.`,
      rows: open.map((card) => ({
        label: card.lead.title,
        amountCents: card.lead.valueEstCents,
        detail: `${card.stage.name} · ${card.lead.source}`,
      })),
    };
  }
  if (tool === "overdue_proposals") {
    const rows = overdueProposals(orgId);
    return {
      tool,
      answer:
        rows.length === 0
          ? "No proposals are past the follow-up window."
          : `${rows.length} proposal${rows.length === 1 ? "" : "s"} past the follow-up window. A viewed proposal is due after 1 day. One that was never opened is due after 3.`,
      rows: rows.map((row) => ({
        label: row.lead.title,
        amountCents: row.proposal.totalCents,
        detail: `${row.contact.name} · sent ${row.proposal.sentAt ? daysSince(row.proposal.sentAt) : "?"} days ago`,
      })),
    };
  }
  const org = getOrg(orgId);
  const threshold = marginThresholdFromQuestion(question, org?.marginAlertBps ?? 2000);
  const rows = listProjects(orgId).filter((row) => row.marginBps != null && row.marginBps < threshold);
  const categories = listCategoryAlerts(orgId);
  const uncovered = categories.filter((row) => row.suggestDraft);
  const jobSentence =
    rows.length === 0
      ? `No active jobs are under ${(threshold / 100).toFixed(1)}% margin.`
      : `${rows.length} job${rows.length === 1 ? "" : "s"} under ${(threshold / 100).toFixed(1)}% margin.`;
  const categorySentence =
    categories.length === 0
      ? ""
      : ` ${categories.length} cost code${categories.length === 1 ? "" : "s"} at or above 80% of budget.${
          uncovered.length
            ? ` ${uncovered.length} ${uncovered.length === 1 ? "is" : "are"} over budget without a change order: ${uncovered
                .map((row) => `${row.projectName} ${row.code}`)
                .join(", ")}.`
            : ""
        }`;
  return {
    tool,
    answer: `${jobSentence}${categorySentence}`,
    rows: [
      ...rows.map((row) => ({
        label: row.project.name,
        amountCents: row.project.contractValueCents - row.actualCents,
        detail: `${((row.marginBps ?? 0) / 100).toFixed(1)}% margin · cost ${formatAnswer(row.actualCents)}`,
      })),
      ...categories.map((row) => ({
        label: `${row.projectName} · ${row.code}`,
        amountCents: row.overageCents,
        detail: `${row.percentOfBudget}% of budget${row.suggestDraft ? " · draft a change order" : row.covered ? " · change order covers it" : ""}`,
      })),
    ],
  };
}

function formatAnswer(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** Public token routes. These stay on the owner connection; there is no member JWT. */
export function proposalByToken(token: string) {
  const db = getDb();
  const proposal = db.select().from(proposals).where(eq(proposals.publicToken, token)).get();
  if (!proposal) return null;
  const org = db.select().from(organizations).where(eq(organizations.id, proposal.orgId)).get();
  const lead = db.select().from(leads).where(eq(leads.id, proposal.leadId)).get();
  const contact = lead ? db.select().from(contacts).where(eq(contacts.id, lead.contactId)).get() : null;
  const signature = db.select().from(signatures).where(eq(signatures.proposalId, proposal.id)).get();
  const snapshot = JSON.parse(proposal.snapshotJson) as StoredSnapshot;
  const expired = Boolean(proposal.expiresAt && new Date(proposal.expiresAt).getTime() < Date.now());
  return { proposal, org, contact, signature, snapshot, expired };
}

export function invoiceByPayToken(token: string) {
  const db = getDb();
  const invoice = db.select().from(invoices).where(eq(invoices.payToken, token)).get();
  if (!invoice) return null;
  const project = db.select().from(projects).where(eq(projects.id, invoice.projectId)).get();
  const contact = project ? db.select().from(contacts).where(eq(contacts.id, project.contactId)).get() : null;
  const org = db.select().from(organizations).where(eq(organizations.id, invoice.orgId)).get();
  const lines = db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id)).all();
  const paymentRows = db.select().from(payments).where(eq(payments.invoiceId, invoice.id)).orderBy(desc(payments.createdAt)).all();
  return { invoice, project, contact, org, lines, payments: paymentRows };
}

export function portalByToken(token: string) {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.portalToken, token)).get();
  if (!project) return null;
  const contact = db.select().from(contacts).where(eq(contacts.id, project.contactId)).get();
  const org = db.select().from(organizations).where(eq(organizations.id, project.orgId)).get();
  const proposal = project.proposalId ? db.select().from(proposals).where(eq(proposals.id, project.proposalId)).get() : null;
  const orders = db.select().from(changeOrders).where(eq(changeOrders.projectId, project.id)).orderBy(asc(changeOrders.number)).all();
  const invoiceRows = db.select().from(invoices).where(eq(invoices.projectId, project.id)).all();
  const photos = db
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, project.id), eq(documents.type, "photo"), isNull(documents.deletedAt)))
    .all();
  const threads = db.select().from(messageThreads).where(eq(messageThreads.projectId, project.id)).all();
  const threadMessages = threads.length
    ? db.select().from(messages).where(inArray(messages.threadId, threads.map((thread) => thread.id))).orderBy(asc(messages.createdAt)).all()
    : [];
  return {
    project,
    contact,
    org,
    proposal,
    snapshot: proposal ? (JSON.parse(proposal.snapshotJson) as StoredSnapshot) : null,
    orders,
    invoices: invoiceRows,
    photos,
    messages: threadMessages,
    logs: clientDailyLogs(project.id),
  };
}

export function pendingReceipts(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  const docs = db
    .select()
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.type, "receipt"), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt))
    .all();
  const posted = new Set(
    db
      .select({ documentId: costItems.documentId })
      .from(costItems)
      .where(eq(costItems.orgId, orgId))
      .all()
      .map((row) => row.documentId)
      .filter((value): value is string => Boolean(value)),
  );
  const projectRows = db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, orgId)).all();
  const names = new Map(projectRows.map((row) => [row.id, row.name]));
  return docs
    .filter((doc) => doc.projectId && !posted.has(doc.id) && readReceiptMeta(doc.metadataJson).posted !== true)
    .slice(0, 8)
    .map((doc) => {
      const meta = readReceiptMeta(doc.metadataJson);
      return {
        documentId: doc.id,
        projectId: doc.projectId as string,
        projectName: names.get(doc.projectId as string) ?? "Job",
        vendor: meta.vendor ?? null,
        amountCents: meta.amountCents ?? null,
        confidence: meta.confidence ?? null,
        createdAt: doc.createdAt,
      };
    });
}

export function captionFromMetadata(metadataJson: string | null): string {
  if (!metadataJson) return "";
  try {
    const parsed = JSON.parse(metadataJson) as { caption?: unknown };
    return typeof parsed.caption === "string" ? parsed.caption.trim() : "";
  } catch {
    return "";
  }
}

export function leadPhotoCues(orgId: string, leadId: string): { filename: string; caption: string }[] {
  const db = officeDb(orgId);
  if (!db) return [];
  return db
    .select({ filename: documents.filename, metadataJson: documents.metadataJson })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.leadId, leadId), eq(documents.type, "photo"), isNull(documents.deletedAt)))
    .all()
    .map((row) => ({ filename: row.filename, caption: captionFromMetadata(row.metadataJson) }));
}

export function leadPhotoNames(orgId: string, leadId: string): string[] {
  return leadPhotoCues(orgId, leadId).map((photo) => photo.filename);
}

export function qboInvoicesExport(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return renderQboInvoices([]);
  const invoiceRows = listInvoices(orgId);
  const ids = invoiceRows.map((row) => row.invoice.id);
  const lineRows =
    ids.length === 0
      ? []
      : db
          .select()
          .from(invoiceLines)
          .where(and(eq(invoiceLines.orgId, orgId), inArray(invoiceLines.invoiceId, ids)))
          .all();
  const linesByInvoice = new Map<string, { description: string; amountCents: number; sortOrder: number }[]>();
  for (const line of lineRows) {
    const list = linesByInvoice.get(line.invoiceId) ?? [];
    list.push({ description: line.description, amountCents: line.amountCents, sortOrder: line.sortOrder });
    linesByInvoice.set(line.invoiceId, list);
  }
  return renderQboInvoices(
    invoiceRows.map(({ invoice, contact }) => ({
      number: invoice.number,
      customer: contact.name,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalCents: invoice.totalCents,
      type: invoice.type,
      lines: linesByInvoice.get(invoice.id) ?? [],
    })),
  );
}

export function qboInvoicesCsv(orgId: string): string {
  return qboInvoicesExport(orgId).csv;
}

export function invoicesCsv(orgId: string): string {
  return qboInvoicesCsv(orgId);
}

export function qboCustomersCsv(orgId: string): string {
  return renderQboCustomers(listContacts(orgId, undefined, "client"));
}

export function contactsCsv(orgId: string): string {
  return qboCustomersCsv(orgId);
}

export { qboImportLimitWarning };

export function staff(orgId: string) {
  const db = officeDb(orgId);
  if (!db) return [];
  return db
    .select({ id: users.id, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .all();
}
