import { heldCents, netPayableCents } from "@/lib/bills/retainage";
import { lineFigures } from "@/lib/bills/from-po";
import { canSeeCash, type Role } from "@/lib/permissions";
import { isWorkday, type WorkdayCalendar } from "@/lib/schedule/workdays";
import { addCalendarDays } from "@/lib/time/calendar";

export const CASH_WEEKS = 13;
const LABOR_HOURS = 8;

export type CashGroup =
  | "invoice"
  | "draw"
  | "change"
  | "retainage_in"
  | "proposal"
  | "lead"
  | "bill"
  | "po"
  | "retainage_out"
  | "labor";

export type CashLine = {
  id: string;
  group: CashGroup;
  direction: "in" | "out";
  kind: "committed" | "projected";
  cents: number;
  date: string;
  jobId: string;
  job: string;
  customerId: string;
  customer: string;
  doc: string;
  href: string;
};

export type CashColumn = { key: string; label: string; low: boolean };

export type CashCell = { cents: number; lines: CashLine[] };

export type CashRow = {
  id: string;
  label: string;
  section: "in" | "out" | "total";
  cells: CashCell[];
};

export type CashForecast = {
  columns: CashColumn[];
  rows: CashRow[];
  openingCents: number;
  lowCents: number;
  alert: { label: string; cents: number } | null;
  chart: { label: string; cents: number; low: boolean }[];
};

export type CashSnap = {
  today: string;
  weekStartsOn: number;
  termsDays: number;
  workdays: number | WorkdayCalendar;
  includeProjected: boolean;
  projects: { id: string; name: string; status: string; contactId: string; endDate: string | null }[];
  contacts: { id: string; name: string; daysLate: number | null }[];
  invoices: {
    id: string;
    projectId: string;
    number: string;
    status: string;
    type: string;
    dueDate: string;
    totalCents: number;
    amountPaidCents: number;
    retainageCents: number;
    applicationNumber: number | null;
    changeOrderId: string | null;
  }[];
  payments: { invoiceId: string; status: string; createdAt: string }[];
  draws: {
    id: string;
    projectId: string;
    title: string;
    amountCents: number;
    scheduleItemId: string | null;
    dueOn: string | null;
    invoiceId: string | null;
    changeOrderId: string | null;
  }[];
  schedule: { id: string; projectId: string; title: string; startDate: string; endDate: string; status: string }[];
  assignees: { itemId: string; userId: string; name: string }[];
  rates: { userId: string; hourlyCostCents: number }[];
  changes: {
    id: string;
    projectId: string;
    number: number;
    title: string;
    status: string;
    priceDeltaCents: number;
    approvedAt: string | null;
  }[];
  bills: {
    id: string;
    projectId: string;
    number: string;
    status: string;
    kind: string;
    amountCents: number;
    retainageCents: number;
    dueDate: string | null;
    purchaseOrderId: string | null;
    vendorId: string | null;
  }[];
  billLines: { billId: string; costCode: string; amountCents: number }[];
  pos: { id: string; projectId: string; number: string; status: string; issuedAt: string | null; vendorId: string }[];
  poLines: { purchaseOrderId: string; costCode: string; description: string | null; amountCents: number }[];
  proposals: {
    id: string;
    leadId: string;
    projectId: string | null;
    estimateId: string;
    title: string;
    status: string;
    totalCents: number;
    sentAt: string | null;
    expiresAt: string | null;
    contactId: string;
  }[];
  leads: { id: string; title: string; status: string; contactId: string; valueCents: number }[];
};

const IN_ROWS: { id: CashGroup; label: string; projected?: boolean }[] = [
  { id: "invoice", label: "Invoices" },
  { id: "draw", label: "Draws" },
  { id: "change", label: "Change orders" },
  { id: "retainage_in", label: "Retainage" },
  { id: "proposal", label: "Proposals", projected: true },
  { id: "lead", label: "Leads", projected: true },
];

const OUT_ROWS: { id: CashGroup; label: string }[] = [
  { id: "bill", label: "Bills" },
  { id: "po", label: "Purchase orders" },
  { id: "retainage_out", label: "Retainage" },
  { id: "labor", label: "Labor" },
];

const OPEN_BILL = new Set(["open", "approved"]);
const SKIP_PO = new Set(["void", "closed", "declined", "draft"]);
const SOLD = new Set(["active", "closed", "complete", "warranty"]);

export function cashAllowed(role: Role): boolean {
  return canSeeCash(role);
}

export function weekStartOn(day: string, weekStartsOn: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, (month ?? 1) - 1, date ?? 1)).getUTCDay();
  const startDow = ((weekStartsOn % 7) + 7) % 7;
  return addCalendarDays(day, -((weekday - startDow + 7) % 7));
}

export function weekLabel(start: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${start}T12:00:00Z`));
}

export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T12:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/** Paid-late days only. Early payments count as zero. */
export function averageDaysLate(gaps: number[]): number {
  if (gaps.length === 0) return 0;
  const late = gaps.map((gap) => Math.max(0, gap));
  return Math.round(late.reduce((sum, gap) => sum + gap, 0) / late.length);
}

export function openInvoiceCents(status: string, totalCents: number, amountPaidCents: number): number | null {
  if (status === "void" || status === "paid" || status === "draft") return null;
  const cents = Math.max(0, Math.round(totalCents) - Math.max(0, Math.round(amountPaidCents)));
  return cents > 0 ? cents : null;
}

export function drawDueDate(
  draw: { scheduleItemId: string | null; dueOn: string | null },
  item: { endDate: string } | undefined,
  termsDays: number,
): string | null {
  if (item) return addCalendarDays(item.endDate, termsDays);
  return draw.dueOn ? draw.dueOn.slice(0, 10) : null;
}

function day(value: string | null | undefined): string {
  return (value ?? "").slice(0, 10);
}

function shift(date: string, days: number): string {
  if (!days) return date;
  return addCalendarDays(date, days);
}

function lagFor(contactId: string, contacts: Map<string, number | null>, history: Map<string, number>): number {
  const override = contacts.get(contactId);
  if (override != null) return Math.max(0, Math.min(180, override));
  return history.get(contactId) ?? 0;
}

function historyLag(snap: CashSnap, projectContact: Map<string, string>): Map<string, number> {
  const invoiceById = new Map(snap.invoices.map((invoice) => [invoice.id, invoice]));
  const gaps = new Map<string, number[]>();
  for (const payment of snap.payments) {
    if (payment.status !== "succeeded") continue;
    const invoice = invoiceById.get(payment.invoiceId);
    if (!invoice || invoice.status === "void") continue;
    const contactId = projectContact.get(invoice.projectId);
    if (!contactId) continue;
    const list = gaps.get(contactId) ?? [];
    list.push(Math.max(0, daysBetween(day(invoice.dueDate), day(payment.createdAt))));
    gaps.set(contactId, list);
  }
  const averages = new Map<string, number>();
  for (const [id, list] of gaps) averages.set(id, averageDaysLate(list));
  return averages;
}

function line(partial: CashLine): CashLine {
  return partial;
}

export function forecastLines(snap: CashSnap): CashLine[] {
  const projects = new Map(snap.projects.map((project) => [project.id, project]));
  const names = new Map(snap.contacts.map((contact) => [contact.id, contact.name]));
  const overrides = new Map(snap.contacts.map((contact) => [contact.id, contact.daysLate]));
  const projectContact = new Map(snap.projects.map((project) => [project.id, project.contactId]));
  const history = historyLag(snap, projectContact);
  const schedule = new Map(snap.schedule.map((item) => [item.id, item]));
  const invoicesByProject = new Map<string, CashSnap["invoices"]>();
  for (const invoice of snap.invoices) {
    const list = invoicesByProject.get(invoice.projectId) ?? [];
    list.push(invoice);
    invoicesByProject.set(invoice.projectId, list);
  }
  const invoiceById = new Map(snap.invoices.map((invoice) => [invoice.id, invoice]));
  const lines: CashLine[] = [];

  const jobOf = (projectId: string) => {
    const project = projects.get(projectId);
    const customerId = project?.contactId ?? "";
    return {
      jobId: projectId,
      job: project?.name ?? "",
      customerId,
      customer: names.get(customerId) ?? "",
      late: lagFor(customerId, overrides, history),
    };
  };

  for (const invoice of snap.invoices) {
    const cents = openInvoiceCents(invoice.status, invoice.totalCents, invoice.amountPaidCents);
    if (cents == null) continue;
    const job = jobOf(invoice.projectId);
    lines.push(
      line({
        id: invoice.id,
        group: "invoice",
        direction: "in",
        kind: "committed",
        cents,
        date: shift(day(invoice.dueDate), job.late),
        jobId: job.jobId,
        job: job.job,
        customerId: job.customerId,
        customer: job.customer,
        doc: invoice.number,
        href: `/projects/${invoice.projectId}/invoices/${invoice.id}`,
      }),
    );
  }

  for (const draw of snap.draws) {
    const invoice = draw.invoiceId ? invoiceById.get(draw.invoiceId) : undefined;
    if (invoice && invoice.status !== "void") continue;
    const item = draw.scheduleItemId ? schedule.get(draw.scheduleItemId) : undefined;
    const due = drawDueDate(draw, item, snap.termsDays);
    if (!due || draw.amountCents <= 0) continue;
    const job = jobOf(draw.projectId);
    lines.push(
      line({
        id: draw.id,
        group: "draw",
        direction: "in",
        kind: "committed",
        cents: draw.amountCents,
        date: shift(due, job.late),
        jobId: job.jobId,
        job: job.job,
        customerId: job.customerId,
        customer: job.customer,
        doc: draw.title,
        href: `/projects/${draw.projectId}`,
      }),
    );
  }

  const drawn = new Set(
    snap.draws
      .filter((draw) => {
        if (!draw.changeOrderId) return false;
        const linked = draw.invoiceId ? invoiceById.get(draw.invoiceId) : undefined;
        return !linked || linked.status === "void";
      })
      .map((draw) => draw.changeOrderId),
  );
  for (const change of snap.changes) {
    if (change.status !== "approved" || change.priceDeltaCents <= 0) continue;
    const billed = (invoicesByProject.get(change.projectId) ?? []).some((invoice) => invoice.changeOrderId === change.id && invoice.status !== "void");
    if (billed || drawn.has(change.id)) continue;
    const job = jobOf(change.projectId);
    const approved = day(change.approvedAt) || snap.today;
    lines.push(
      line({
        id: change.id,
        group: "change",
        direction: "in",
        kind: "committed",
        cents: change.priceDeltaCents,
        date: shift(approved, job.late),
        jobId: job.jobId,
        job: job.job,
        customerId: job.customerId,
        customer: job.customer,
        doc: `${change.number} ${change.title}`.trim(),
        href: `/projects/${change.projectId}`,
      }),
    );
  }

  for (const project of snap.projects) {
    if (!SOLD.has(project.status)) continue;
    const rows = invoicesByProject.get(project.id) ?? [];
    const held = rows.filter((invoice) => invoice.status !== "void" && invoice.applicationNumber != null).reduce((sum, invoice) => sum + invoice.retainageCents, 0);
    const released = rows.filter((invoice) => invoice.status !== "void" && invoice.type === "retainage").reduce((sum, invoice) => sum + invoice.totalCents, 0);
    const cents = Math.max(0, held - released);
    if (cents <= 0) continue;
    const ends = snap.schedule.filter((item) => item.projectId === project.id).map((item) => item.endDate);
    const end = project.endDate || ends.reduce((max, value) => (value > max ? value : max), "");
    const due = end ? addCalendarDays(end, snap.termsDays) : addCalendarDays(snap.today, 30);
    const job = jobOf(project.id);
    lines.push(
      line({
        id: `ret_in_${project.id}`,
        group: "retainage_in",
        direction: "in",
        kind: "committed",
        cents,
        date: shift(due, job.late),
        jobId: job.jobId,
        job: job.job,
        customerId: job.customerId,
        customer: job.customer,
        doc: "Retainage",
        href: `/projects/${project.id}`,
      }),
    );
  }

  if (snap.includeProjected) {
    const covered = new Set(snap.proposals.filter((proposal) => ["sent", "viewed", "signed"].includes(proposal.status)).map((proposal) => proposal.leadId));
    for (const proposal of snap.proposals) {
      if (proposal.status !== "sent" && proposal.status !== "viewed") continue;
      const project = proposal.projectId ? projects.get(proposal.projectId) : undefined;
      if (project && SOLD.has(project.status)) continue;
      const contactId = proposal.contactId;
      const late = lagFor(contactId, overrides, history);
      const raw = day(proposal.expiresAt) || (proposal.sentAt ? addCalendarDays(day(proposal.sentAt), 30) : addCalendarDays(snap.today, 21));
      lines.push(
        line({
          id: proposal.id,
          group: "proposal",
          direction: "in",
          kind: "projected",
          cents: proposal.totalCents,
          date: shift(raw, late),
          jobId: proposal.projectId ?? "",
          job: proposal.title,
          customerId: contactId,
          customer: names.get(contactId) ?? "",
          doc: proposal.title,
          href: `/estimates/${proposal.estimateId}`,
        }),
      );
    }
    for (const lead of snap.leads) {
      if (lead.status !== "open" || lead.valueCents <= 0 || covered.has(lead.id)) continue;
      const late = lagFor(lead.contactId, overrides, history);
      lines.push(
        line({
          id: lead.id,
          group: "lead",
          direction: "in",
          kind: "projected",
          cents: lead.valueCents,
          date: shift(addCalendarDays(snap.today, 21), late),
          jobId: "",
          job: lead.title,
          customerId: lead.contactId,
          customer: names.get(lead.contactId) ?? "",
          doc: lead.title,
          href: `/leads/${lead.id}`,
        }),
      );
    }
  }

  for (const bill of snap.bills) {
    if (!OPEN_BILL.has(bill.status)) continue;
    const kind = bill.kind === "release" ? "release" : "standard";
    const cents = netPayableCents(bill.amountCents, bill.retainageCents, kind);
    if (cents <= 0) continue;
    const job = jobOf(bill.projectId);
    lines.push(
      line({
        id: bill.id,
        group: kind === "release" ? "retainage_out" : "bill",
        direction: "out",
        kind: "committed",
        cents,
        date: day(bill.dueDate) || snap.today,
        jobId: job.jobId,
        job: job.job,
        customerId: job.customerId,
        customer: job.customer,
        doc: bill.number || "Bill",
        href: `/bills/${bill.id}`,
      }),
    );
  }

  const billsByPo = new Map<string, CashSnap["bills"]>();
  for (const bill of snap.bills) {
    if (!bill.purchaseOrderId || bill.status === "void" || bill.status === "draft") continue;
    if (bill.status !== "approved" && bill.status !== "paid" && bill.status !== "open") continue;
    const list = billsByPo.get(bill.purchaseOrderId) ?? [];
    list.push(bill);
    billsByPo.set(bill.purchaseOrderId, list);
  }
  const linesByBill = new Map<string, CashSnap["billLines"]>();
  for (const row of snap.billLines) {
    const list = linesByBill.get(row.billId) ?? [];
    list.push(row);
    linesByBill.set(row.billId, list);
  }
  for (const po of snap.pos) {
    if (SKIP_PO.has(po.status)) continue;
    const billed = (billsByPo.get(po.id) ?? []).flatMap((bill) => linesByBill.get(bill.id) ?? []);
    const remaining = lineFigures(
      snap.poLines.filter((row) => row.purchaseOrderId === po.id),
      billed.map((row) => ({ costCode: row.costCode, amountCents: row.amountCents })),
    ).reduce((sum, row) => sum + row.remainingCents, 0);
    if (remaining <= 0) continue;
    const job = jobOf(po.projectId);
    lines.push(
      line({
        id: po.id,
        group: "po",
        direction: "out",
        kind: "committed",
        cents: remaining,
        date: day(po.issuedAt) || snap.today,
        jobId: job.jobId,
        job: job.job,
        customerId: job.customerId,
        customer: job.customer,
        doc: po.number,
        href: `/projects/${po.projectId}`,
      }),
    );
  }

  const heldByProject = new Map<string, { retained: number; released: number }>();
  for (const bill of snap.bills) {
    if (bill.status === "void" || bill.status === "draft") continue;
    const bucket = heldByProject.get(bill.projectId) ?? { retained: 0, released: 0 };
    if (bill.kind === "release") bucket.released += Math.max(0, bill.amountCents);
    else if (bill.status === "paid") bucket.retained += Math.max(0, bill.retainageCents);
    heldByProject.set(bill.projectId, bucket);
  }
  for (const [projectId, bucket] of heldByProject) {
    const cents = heldCents(bucket.retained, bucket.released);
    if (cents <= 0) continue;
    const project = projects.get(projectId);
    const ends = snap.schedule.filter((item) => item.projectId === projectId).map((item) => item.endDate);
    const end = project?.endDate || ends.reduce((max, value) => (value > max ? value : max), "");
    const job = jobOf(projectId);
    lines.push(
      line({
        id: `ret_out_${projectId}`,
        group: "retainage_out",
        direction: "out",
        kind: "committed",
        cents,
        date: end ? addCalendarDays(end, snap.termsDays) : addCalendarDays(snap.today, 30),
        jobId: job.jobId,
        job: job.job,
        customerId: job.customerId,
        customer: job.customer,
        doc: "Retainage",
        href: `/projects/${projectId}`,
      }),
    );
  }

  const rateFor = (userId: string) => {
    const own = snap.rates.find((rate) => rate.userId === userId);
    if (own) return own.hourlyCostCents;
    return snap.rates.find((rate) => rate.userId === "")?.hourlyCostCents ?? 0;
  };
  const crew = new Map<string, { userId: string; name: string }[]>();
  for (const assignee of snap.assignees) {
    const list = crew.get(assignee.itemId) ?? [];
    list.push({ userId: assignee.userId, name: assignee.name });
    crew.set(assignee.itemId, list);
  }
  for (const item of snap.schedule) {
    if (item.status === "done" || item.status === "cancelled") continue;
    const people = crew.get(item.id) ?? [];
    if (people.length === 0) continue;
    const job = jobOf(item.projectId);
    for (let cursor = item.startDate > snap.today ? item.startDate : snap.today; cursor <= item.endDate; cursor = addCalendarDays(cursor, 1)) {
      if (!isWorkday(cursor, snap.workdays)) continue;
      for (const person of people) {
        const cents = rateFor(person.userId) * LABOR_HOURS;
        if (cents <= 0) continue;
        lines.push(
          line({
            id: `${item.id}:${person.userId}:${cursor}`,
            group: "labor",
            direction: "out",
            kind: "committed",
            cents,
            date: cursor,
            jobId: job.jobId,
            job: job.job,
            customerId: job.customerId,
            customer: job.customer,
            doc: `${item.title} · ${person.name}`,
            href: `/schedule/items/${item.id}`,
          }),
        );
      }
    }
  }

  return lines.filter((row) => row.cents > 0 && row.date);
}

function emptyCells(count: number): CashCell[] {
  return Array.from({ length: count }, () => ({ cents: 0, lines: [] }));
}

export function bucketForecast(input: {
  today: string;
  weekStartsOn: number;
  openingCents: number;
  lowCents: number;
  includeProjected: boolean;
  lines: CashLine[];
}): CashForecast {
  const first = weekStartOn(input.today, input.weekStartsOn);
  const starts = Array.from({ length: CASH_WEEKS }, (_, index) => addCalendarDays(first, index * 7));
  const columns: CashColumn[] = [
    { key: "past", label: "Past due", low: false },
    ...starts.map((start) => ({ key: start, label: weekLabel(start), low: false })),
  ];
  const last = addCalendarDays(starts[CASH_WEEKS - 1]!, 6);
  const indexFor = (date: string) => {
    const value = date.slice(0, 10);
    if (value < input.today) return 0;
    if (value > last) return -1;
    for (let index = 0; index < starts.length; index += 1) {
      const end = addCalendarDays(starts[index]!, 6);
      if (value >= starts[index]! && value <= end) return index + 1;
    }
    return -1;
  };
  const visible = input.lines.filter((row) => input.includeProjected || row.kind === "committed");
  const groups = [
    ...IN_ROWS.filter((row) => input.includeProjected || !row.projected).map((row) => ({ ...row, section: "in" as const })),
    ...OUT_ROWS.map((row) => ({ ...row, section: "out" as const })),
  ];
  const rows: CashRow[] = groups.map((group) => ({ id: group.id, label: group.label, section: group.section, cells: emptyCells(columns.length) }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const entry of visible) {
    const index = indexFor(entry.date);
    const target = byId.get(entry.group);
    if (index < 0 || !target) continue;
    const cell = target.cells[index]!;
    cell.cents += entry.cents;
    cell.lines.push(entry);
  }
  const net: CashRow = { id: "net", label: "Net", section: "total", cells: emptyCells(columns.length) };
  const balance: CashRow = { id: "balance", label: "Balance", section: "total", cells: emptyCells(columns.length) };
  let running = input.openingCents;
  for (let index = 0; index < columns.length; index += 1) {
    const inn = rows.filter((row) => row.section === "in").reduce((sum, row) => sum + row.cells[index]!.cents, 0);
    const out = rows.filter((row) => row.section === "out").reduce((sum, row) => sum + row.cells[index]!.cents, 0);
    net.cells[index] = {
      cents: inn - out,
      lines: rows.flatMap((row) => row.cells[index]!.lines),
    };
    running += inn - out;
    balance.cells[index] = { cents: running, lines: [] };
    if (index > 0 && running < input.lowCents) columns[index]!.low = true;
  }
  rows.push(net, balance);
  const alertColumn = columns.find((column, index) => index > 0 && column.low);
  const alertIndex = alertColumn ? columns.indexOf(alertColumn) : -1;
  return {
    columns,
    rows,
    openingCents: input.openingCents,
    lowCents: input.lowCents,
    alert: alertColumn ? { label: alertColumn.label, cents: balance.cells[alertIndex]!.cents } : null,
    chart: columns.map((column, index) => ({ label: column.label, cents: balance.cells[index]!.cents, low: column.low })),
  };
}

export function forecastCsv(forecast: CashForecast): string {
  const header = ["Row", ...forecast.columns.map((column) => column.label)];
  const body = forecast.rows.map((row) => [row.label, ...row.cells.map((cell) => (cell.cents / 100).toFixed(2))]);
  return [header, ...body].map((cells) => cells.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
}
