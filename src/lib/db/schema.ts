import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  tradeFocus: text("trade_focus"),
  city: text("city"),
  state: text("state"),
  licenseNumber: text("license_number"),
  marginAlertBps: integer("margin_alert_bps").notNull().default(2000),
  defaultMarkupBps: integer("default_markup_bps").notNull().default(3500),
  taxBps: integer("tax_bps").notNull().default(0),
  depositBps: integer("deposit_bps").notNull().default(4000),
  progressBps: integer("progress_bps").notNull().default(4000),
  finalBps: integer("final_bps").notNull().default(2000),
  cardEnabled: integer("card_enabled").notNull().default(1),
  termsVersion: text("terms_version").notNull().default("2026-09-01"),
  setupDismissedAt: text("setup_dismissed_at"),
  timeZone: text("time_zone").notNull().default("America/New_York"),
  weekStartsOn: integer("week_starts_on").notNull().default(1),
  workdaysMask: integer("workdays_mask").notNull().default(62),
  warrantyMonths: integer("warranty_months").notNull().default(12),
  vendorComplianceMode: text("vendor_compliance_mode").notNull().default("warn"),
  lienWaiverMode: text("lien_waiver_mode").notNull().default("warn"),
  inspectionGate: text("inspection_gate").notNull().default("warn"),
  vendorRequiredTypes: text("vendor_required_types").notNull().default("general_liability,workers_comp"),
  paymentTermsDays: integer("payment_terms_days").notNull().default(7),
  defaultRetainageBps: integer("default_retainage_bps").notNull().default(0),
  vendorRetainageBps: integer("vendor_retainage_bps").notNull().default(0),
  defaultDrawsJson: text("default_draws_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    title: text("title"),
    authUserId: text("auth_user_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("users_auth_user_id").on(t.authUserId)],
);

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId)],
);

export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    company: text("company"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    notes: text("notes"),
    retainageBps: integer("retainage_bps"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("contacts_org").on(t.orgId)],
);

export const consents = sqliteTable("consents", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  contactId: text("contact_id").notNull(),
  channel: text("channel").notNull(),
  status: text("status").notNull(),
  source: text("source"),
  createdAt: text("created_at").notNull(),
});

export const pipelines = sqliteTable("pipelines", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const pipelineStages = sqliteTable(
  "pipeline_stages",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    pipelineId: text("pipeline_id").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    kind: text("kind").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("stages_org").on(t.orgId)],
);

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    contactId: text("contact_id").notNull(),
    stageId: text("stage_id").notNull(),
    title: text("title").notNull(),
    source: text("source").notNull(),
    valueEstCents: integer("value_est_cents"),
    ownerUserId: text("owner_user_id"),
    status: text("status").notNull(),
    lostReason: text("lost_reason"),
    scopeText: text("scope_text"),
    sqft: integer("sqft"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("leads_org").on(t.orgId)],
);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  title: text("title").notNull(),
  assigneeUserId: text("assignee_user_id"),
  dueAt: text("due_at"),
  relatedType: text("related_type"),
  relatedId: text("related_id"),
  status: text("status").notNull(),
  notes: text("notes").notNull().default(""),
  priority: text("priority").notNull().default("normal"),
  tags: text("tags").notNull().default(""),
  scheduleItemId: text("schedule_item_id"),
  deadlineEdge: text("deadline_edge"),
  deadlineOffset: integer("deadline_offset"),
  deadlineUnlinked: integer("deadline_unlinked").notNull().default(0),
  remindDays: integer("remind_days"),
  remindedFor: text("reminded_for"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by"),
});

export const taskAssignees = sqliteTable(
  "task_assignees",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    taskId: text("task_id").notNull(),
    userId: text("user_id"),
    contactId: text("contact_id"),
  },
  (t) => [index("task_assignees_task").on(t.orgId, t.taskId)],
);

export const taskChecks = sqliteTable(
  "task_checks",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    taskId: text("task_id").notNull(),
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull(),
    status: text("status").notNull(),
    assigneeUserId: text("assignee_user_id"),
    assigneeContactId: text("assignee_contact_id"),
    dueAt: text("due_at"),
    completedAt: text("completed_at"),
    completedBy: text("completed_by"),
  },
  (t) => [index("task_checks_task").on(t.orgId, t.taskId)],
);

export const taskFiles = sqliteTable(
  "task_files",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    taskId: text("task_id").notNull(),
    checkId: text("check_id"),
    documentId: text("document_id").notNull(),
  },
  (t) => [index("task_files_task").on(t.orgId, t.taskId)],
);

export const todoAttempts = sqliteTable(
  "todo_attempts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("todo_attempts_user").on(t.orgId, t.userId, t.createdAt)],
);

export const priceBookItems = sqliteTable(
  "price_book_items",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    unit: text("unit").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    defaultMarkupBps: integer("default_markup_bps").notNull(),
    vendor: text("vendor"),
    keywords: text("keywords"),
    defaultFormula: text("default_formula"),
    defaultWasteBps: integer("default_waste_bps"),
    defaultRoundToMilli: integer("default_round_to_milli"),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [uniqueIndex("price_book_org_code").on(t.orgId, t.code)],
);

export const estimates = sqliteTable("estimates", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  leadId: text("lead_id").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  markupBps: integer("markup_bps").notNull(),
  taxBps: integer("tax_bps").notNull(),
  marginTargetBps: integer("margin_target_bps").notNull(),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by"),
});

export const estimateSections = sqliteTable("estimate_sections", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  estimateId: text("estimate_id").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const lineItems = sqliteTable("line_items", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  sectionId: text("section_id").notNull(),
  estimateId: text("estimate_id").notNull(),
  priceBookItemId: text("price_book_item_id"),
  name: text("name").notNull(),
  description: text("description"),
  qtyMilli: integer("qty_milli").notNull(),
  unit: text("unit").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(),
  markupBps: integer("markup_bps").notNull(),
  costCode: text("cost_code"),
  source: text("source").notNull(),
  aiConfidenceMilli: integer("ai_confidence_milli"),
  sourceNote: text("source_note"),
  sortOrder: integer("sort_order").notNull(),
  /** included counts. allowance counts and is labeled. optional is shown, not counted. excluded is omitted. */
  billing: text("billing").notNull().default("included"),
  qtyFormula: text("qty_formula"),
  wasteBps: integer("waste_bps").notNull().default(0),
  roundToMilli: integer("round_to_milli"),
  groupId: text("group_id"),
  qtyOverridden: integer("qty_overridden").notNull().default(0),
});

export const assemblies = sqliteTable(
  "assemblies",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    drive: text("drive").notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("assemblies_org").on(t.orgId)],
);

export const assemblyParts = sqliteTable(
  "assembly_parts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    assemblyId: text("assembly_id").notNull(),
    name: text("name").notNull(),
    priceBookItemId: text("price_book_item_id"),
    costCode: text("cost_code"),
    unit: text("unit").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    formula: text("formula").notNull(),
    wasteBps: integer("waste_bps").notNull().default(0),
    roundToMilli: integer("round_to_milli"),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("assembly_parts_assembly").on(t.orgId, t.assemblyId)],
);

export const estimateGroups = sqliteTable(
  "estimate_groups",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    estimateId: text("estimate_id").notNull(),
    sectionId: text("section_id").notNull(),
    assemblyId: text("assembly_id"),
    name: text("name").notNull(),
    measurementId: text("measurement_id").notNull(),
    presentAs: text("present_as").notNull().default("one"),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("estimate_groups_estimate").on(t.orgId, t.estimateId)],
);

export const estimateMeasurements = sqliteTable(
  "estimate_measurements",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    estimateId: text("estimate_id").notNull(),
    name: text("name").notNull(),
    valueMilli: integer("value_milli").notNull(),
    unit: text("unit").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [uniqueIndex("estimate_measurements_name").on(t.orgId, t.estimateId, t.name)],
);

export const proposals = sqliteTable(
  "proposals",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    estimateId: text("estimate_id").notNull(),
    leadId: text("lead_id").notNull(),
    projectId: text("project_id"),
    status: text("status").notNull(),
    publicToken: text("public_token").notNull().unique(),
    snapshotJson: text("snapshot_json").notNull(),
    paymentScheduleJson: text("payment_schedule_json").notNull(),
    termsVersion: text("terms_version").notNull(),
    totalCents: integer("total_cents").notNull(),
    sentAt: text("sent_at"),
    viewedAt: text("viewed_at"),
    signedAt: text("signed_at"),
    declinedAt: text("declined_at"),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("proposals_org").on(t.orgId)],
);

export const signatures = sqliteTable("signatures", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  proposalId: text("proposal_id"),
  changeOrderId: text("change_order_id"),
  signerName: text("signer_name").notNull(),
  signerEmail: text("signer_email"),
  typedName: text("typed_name").notNull(),
  drawnDataUrl: text("drawn_data_url"),
  signedAt: text("signed_at").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  docHash: text("doc_hash").notNull(),
  consentTextVersion: text("consent_text_version").notNull(),
  consentAccepted: integer("consent_accepted").notNull(),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    leadId: text("lead_id"),
    proposalId: text("proposal_id"),
    contactId: text("contact_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    address: text("address"),
    contractValueCents: integer("contract_value_cents").notNull(),
    originalContractCents: integer("original_contract_cents").notNull(),
    startDate: text("start_date"),
    endDate: text("end_date"),
    portalToken: text("portal_token").notNull().unique(),
    substantialAt: text("substantial_at"),
    closedAt: text("closed_at"),
    warrantyEndsOn: text("warranty_ends_on"),
    warrantyMonths: integer("warranty_months"),
    closeOverrideReason: text("close_override_reason"),
    billingMode: text("billing_mode").notNull().default("draws"),
    retainageBps: integer("retainage_bps").notNull().default(0),
    markupBps: integer("markup_bps").notNull().default(0),
    taxBps: integer("tax_bps").notNull().default(0),
    templateId: text("template_id"),
    templateVersion: integer("template_version"),
    templateName: text("template_name"),
    pmUserId: text("pm_user_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("projects_org").on(t.orgId)],
);

export const budgetLines = sqliteTable("budget_lines", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  projectId: text("project_id").notNull(),
  changeOrderId: text("change_order_id"),
  name: text("name").notNull(),
  costCode: text("cost_code"),
  budgetCostCents: integer("budget_cost_cents").notNull(),
  budgetPriceCents: integer("budget_price_cents").notNull(),
  sourceLineId: text("source_line_id"),
  createdAt: text("created_at").notNull(),
});

export const changeOrders = sqliteTable("change_orders", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  projectId: text("project_id").notNull(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  description: text("description"),
  priceDeltaCents: integer("price_delta_cents").notNull(),
  costDeltaCents: integer("cost_delta_cents").notNull(),
  publicToken: text("public_token").notNull().unique(),
  sentAt: text("sent_at"),
  approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by"),
});

export const changeOrderLines = sqliteTable("change_order_lines", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  changeOrderId: text("change_order_id").notNull(),
  name: text("name").notNull(),
  qtyMilli: integer("qty_milli").notNull(),
  unit: text("unit").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(),
  markupBps: integer("markup_bps").notNull(),
  priceCents: integer("price_cents").notNull(),
  costCode: text("cost_code"),
  sortOrder: integer("sort_order").notNull(),
});

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    changeOrderId: text("change_order_id"),
    number: text("number").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    scheduleIndex: integer("schedule_index"),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    amountPaidCents: integer("amount_paid_cents").notNull().default(0),
    payToken: text("pay_token").notNull().unique(),
    applicationNumber: integer("application_number"),
    retainageCents: integer("retainage_cents").notNull().default(0),
    presentAs: text("present_as").notNull().default("grouped"),
    markupDisplay: text("markup_display").notNull().default("baked"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("invoices_org").on(t.orgId)],
);

export const draws = sqliteTable(
  "draws",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    title: text("title").notNull(),
    basis: text("basis").notNull(),
    bps: integer("bps").notNull().default(0),
    amountCents: integer("amount_cents").notNull(),
    scheduleItemId: text("schedule_item_id"),
    dueOn: text("due_on"),
    sortOrder: integer("sort_order").notNull().default(0),
    invoiceId: text("invoice_id"),
    changeOrderId: text("change_order_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("draws_project").on(t.orgId, t.projectId)],
);

export const payAppLines = sqliteTable(
  "pay_app_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    sourceKey: text("source_key").notNull(),
    name: text("name").notNull(),
    scheduledCents: integer("scheduled_cents").notNull(),
    previousCents: integer("previous_cents").notNull(),
    thisCents: integer("this_cents").notNull(),
    percentBps: integer("percent_bps").notNull(),
    retainageCents: integer("retainage_cents").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("pay_app_lines_invoice").on(t.orgId, t.invoiceId)],
);

export const invoiceLines = sqliteTable("invoice_lines", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  invoiceId: text("invoice_id").notNull(),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    method: text("method").notNull(),
    amountCents: integer("amount_cents").notNull(),
    feeCents: integer("fee_cents").notNull(),
    netCents: integer("net_cents").notNull(),
    status: text("status").notNull(),
    stripePaymentIntent: text("stripe_payment_intent"),
    idempotencyKey: text("idempotency_key").notNull(),
    failureReason: text("failure_reason"),
    stub: integer("stub").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("payments_idem").on(t.idempotencyKey)],
);

export const bills = sqliteTable(
  "bills",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    vendorContactId: text("vendor_contact_id"),
    billNumber: text("bill_number").notNull().default(""),
    billDate: text("bill_date"),
    amountCents: integer("amount_cents").notNull(),
    dueDate: text("due_date"),
    status: text("status").notNull(),
    memo: text("memo"),
    voidReason: text("void_reason"),
    paidAt: text("paid_at"),
    payMethod: text("pay_method"),
    payReference: text("pay_reference"),
    documentId: text("document_id"),
    purchaseOrderId: text("purchase_order_id"),
    approvedAt: text("approved_at"),
    lowConfidence: integer("low_confidence").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
    portalSubmitted: integer("portal_submitted").notNull().default(0),
    retainageCents: integer("retainage_cents").notNull().default(0),
    kind: text("kind").notNull().default("standard"),
  },
  (t) => [index("bills_org").on(t.orgId), index("bills_vendor").on(t.orgId, t.vendorContactId)],
);

export const billLines = sqliteTable(
  "bill_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    billId: text("bill_id").notNull(),
    costCode: text("cost_code").notNull(),
    description: text("description"),
    amountCents: integer("amount_cents").notNull(),
    costItemId: text("cost_item_id"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("bill_lines_bill").on(t.orgId, t.billId)],
);

export const billEvents = sqliteTable(
  "bill_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    billId: text("bill_id").notNull(),
    actorId: text("actor_id"),
    type: text("type").notNull(),
    reason: text("reason"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("bill_events_bill").on(t.orgId, t.billId)],
);

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    vendorContactId: text("vendor_contact_id").notNull(),
    changeOrderId: text("change_order_id"),
    number: text("number").notNull(),
    scope: text("scope"),
    status: text("status").notNull(),
    voidReason: text("void_reason"),
    issuedAt: text("issued_at"),
    closedAt: text("closed_at"),
    acceptedAt: text("accepted_at"),
    acceptedName: text("accepted_name"),
    declinedAt: text("declined_at"),
    declineReason: text("decline_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
    retainageBps: integer("retainage_bps").notNull().default(0),
  },
  (t) => [uniqueIndex("purchase_orders_number").on(t.orgId, t.number), index("purchase_orders_org").on(t.orgId)],
);

export const purchaseOrderLines = sqliteTable(
  "purchase_order_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    purchaseOrderId: text("purchase_order_id").notNull(),
    costCode: text("cost_code").notNull(),
    description: text("description"),
    amountCents: integer("amount_cents").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("purchase_order_lines_po").on(t.orgId, t.purchaseOrderId)],
);

export const purchaseOrderEvents = sqliteTable(
  "purchase_order_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    purchaseOrderId: text("purchase_order_id").notNull(),
    actorId: text("actor_id"),
    type: text("type").notNull(),
    reason: text("reason"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("purchase_order_events_po").on(t.orgId, t.purchaseOrderId)],
);

export const costItems = sqliteTable("cost_items", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  projectId: text("project_id").notNull(),
  budgetLineId: text("budget_line_id"),
  costCode: text("cost_code"),
  amountCents: integer("amount_cents").notNull(),
  vendorName: text("vendor_name"),
  memo: text("memo"),
  source: text("source").notNull(),
  aiExtracted: integer("ai_extracted").notNull().default(0),
  documentId: text("document_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by"),
});

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  projectId: text("project_id"),
  leadId: text("lead_id"),
  contactId: text("contact_id"),
  type: text("type").notNull(),
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(),
  metadataJson: text("metadata_json"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by"),
});

export const messageThreads = sqliteTable("message_threads", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  contactId: text("contact_id").notNull(),
  leadId: text("lead_id"),
  projectId: text("project_id"),
  subject: text("subject").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  threadId: text("thread_id").notNull(),
  channel: text("channel").notNull(),
  direction: text("direction").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull(),
  consentOk: integer("consent_ok").notNull().default(1),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by"),
});

export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    type: text("type").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    summary: text("summary").notNull(),
    payloadJson: text("payload_json"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("activities_entity").on(t.orgId, t.entityType, t.entityId)],
);

export const aiRuns = sqliteTable("ai_runs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  feature: text("feature").notNull(),
  model: text("model").notNull(),
  tokensIn: integer("tokens_in").notNull(),
  tokensOut: integer("tokens_out").notNull(),
  costCents: integer("cost_cents").notNull(),
  inputRef: text("input_ref"),
  outputJson: text("output_json"),
  latencyMs: integer("latency_ms"),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by"),
});

export const integrationConnections = sqliteTable("integration_connections", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  label: text("label"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  payloadJson: text("payload_json"),
  ip: text("ip"),
  createdAt: text("created_at").notNull(),
});

export const teamInvites = sqliteTable(
  "team_invites",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull(),
    invitedBy: text("invited_by").notNull(),
    expiresAt: text("expires_at").notNull(),
    acceptedBy: text("accepted_by"),
    acceptedAt: text("accepted_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("team_invites_token_hash").on(t.tokenHash), index("team_invites_org").on(t.orgId)],
);

/** user_id "" is the company default hourly cost. Member rows override it. */
export const laborRates = sqliteTable(
  "labor_rates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    hourlyCostCents: integer("hourly_cost_cents").notNull(),
    hourlyBillCents: integer("hourly_bill_cents"),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by"),
  },
  (t) => [uniqueIndex("labor_rates_org_user").on(t.orgId, t.userId), index("labor_rates_org").on(t.orgId)],
);

export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    projectId: text("project_id").notNull(),
    costCode: text("cost_code").notNull(),
    status: text("status").notNull(),
    clockInAt: text("clock_in_at").notNull(),
    clockOutAt: text("clock_out_at"),
    breakMinutes: integer("break_minutes").notNull().default(0),
    breakStartedAt: text("break_started_at"),
    note: text("note"),
    clockInLatE6: integer("clock_in_lat_e6"),
    clockInLngE6: integer("clock_in_lng_e6"),
    clockOutLatE6: integer("clock_out_lat_e6"),
    clockOutLngE6: integer("clock_out_lng_e6"),
    source: text("source").notNull(),
    clientEventId: text("client_event_id"),
    syncedAt: text("synced_at"),
    anomaly: text("anomaly"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [
    index("time_entries_org").on(t.orgId),
    index("time_entries_user").on(t.orgId, t.userId),
    uniqueIndex("time_entries_client_event").on(t.orgId, t.userId, t.clientEventId),
  ],
);

/** Idempotency row for one offline punch or log draft. Replay returns result_json. */
/** One offline punch or log draft. The client id is unique per person, not globally. */
export const syncEvents = sqliteTable(
  "sync_events",
  {
    id: text("id").primaryKey(),
    clientEventId: text("client_event_id").notNull(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    capturedAt: text("captured_at").notNull(),
    status: text("status").notNull(),
    resultJson: text("result_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("sync_events_scope").on(t.orgId, t.userId, t.clientEventId), index("sync_events_org_user").on(t.orgId, t.userId)],
);

/** Office review queue for punches that synced with a clock, sequence, or job problem. */
export const timeAnomalies = sqliteTable(
  "time_anomalies",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    clientEventId: text("client_event_id").notNull(),
    kind: text("kind").notNull(),
    detail: text("detail").notNull(),
    capturedAt: text("captured_at").notNull(),
    projectId: text("project_id"),
    costCode: text("cost_code"),
    entryId: text("entry_id"),
    logId: text("log_id"),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("time_anomalies_org").on(t.orgId), uniqueIndex("time_anomalies_event").on(t.orgId, t.userId, t.clientEventId)],
);

export const timeEntryEvents = sqliteTable(
  "time_entry_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    entryId: text("entry_id").notNull(),
    actorId: text("actor_id"),
    type: text("type").notNull(),
    reason: text("reason"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("time_entry_events_entry").on(t.orgId, t.entryId)],
);

export const timeApprovals = sqliteTable(
  "time_approvals",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    entryId: text("entry_id").notNull(),
    rateCents: integer("rate_cents").notNull(),
    minutes: integer("minutes").notNull(),
    amountCents: integer("amount_cents").notNull(),
    costItemId: text("cost_item_id"),
    status: text("status").notNull(),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("time_approvals_entry").on(t.orgId, t.entryId)],
);

/** One active log per job, per UTC day, per author. Voided rows stay and free that day. */
export const dailyLogs = sqliteTable(
  "daily_logs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    authorId: text("author_id").notNull(),
    logDate: text("log_date").notNull(),
    status: text("status").notNull(),
    visibility: text("visibility").notNull(),
    notes: text("notes"),
    plannedNext: text("planned_next"),
    weatherSky: text("weather_sky"),
    weatherHighF: integer("weather_high_f"),
    weatherLowF: integer("weather_low_f"),
    weatherLostMinutes: integer("weather_lost_minutes"),
    weatherImpact: text("weather_impact"),
    delayCause: text("delay_cause"),
    delayMinutes: integer("delay_minutes"),
    deliveries: text("deliveries"),
    visitors: text("visitors"),
    safetyNote: text("safety_note"),
    publishedAt: text("published_at"),
    voidReason: text("void_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("daily_logs_one_open")
      .on(t.orgId, t.projectId, t.authorId, t.logDate)
      .where(sql`status <> 'void'`),
    index("daily_logs_project").on(t.orgId, t.projectId, t.logDate),
  ],
);

export const dailyLogEvents = sqliteTable(
  "daily_log_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    logId: text("log_id").notNull(),
    actorId: text("actor_id"),
    type: text("type").notNull(),
    reason: text("reason"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("daily_log_events_log").on(t.orgId, t.logId)],
);

export const dailyLogPhotos = sqliteTable(
  "daily_log_photos",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    logId: text("log_id").notNull(),
    documentId: text("document_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("daily_log_photos_log").on(t.orgId, t.logId)],
);

export const testerFeedback = sqliteTable(
  "tester_feedback",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    path: text("path").notNull(),
    body: text("body").notNull(),
    context: text("context"),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("tester_feedback_org").on(t.orgId)],
);

export const followUpDrafts = sqliteTable("follow_up_drafts", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  contactId: text("contact_id"),
  leadId: text("lead_id"),
  proposalId: text("proposal_id"),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** All-day crew assignment. Dates are company-local calendar days, inclusive. */
export const scheduleItems = sqliteTable(
  "schedule_items",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    title: text("title").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    startTime: text("start_time"),
    status: text("status").notNull(),
    note: text("note"),
    vendorContactId: text("vendor_contact_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("schedule_items_org").on(t.orgId, t.startDate)],
);

export const scheduleAssignees = sqliteTable(
  "schedule_assignees",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    itemId: text("item_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (t) => [uniqueIndex("schedule_assignees_slot").on(t.orgId, t.itemId, t.userId), index("schedule_assignees_user").on(t.orgId, t.userId)],
);

/** One feed per person. The URL secret is stored as a hash. Rotating replaces it. */
export const calendarFeeds = sqliteTable(
  "calendar_feeds",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("calendar_feeds_user").on(t.orgId, t.userId), uniqueIndex("calendar_feeds_hash").on(t.tokenHash)],
);

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    kind: text("kind").notNull(),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
    undoneAt: text("undone_at"),
    summaryJson: text("summary_json").notNull(),
  },
  (t) => [index("import_batches_org").on(t.orgId, t.createdAt)],
);

export const importRows = sqliteTable(
  "import_rows",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    batchId: text("batch_id").notNull(),
    rowIndex: integer("row_index").notNull(),
    action: text("action").notNull(),
    recordKind: text("record_kind").notNull(),
    recordId: text("record_id"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    undoneAt: text("undone_at"),
    undoBlock: text("undo_block"),
  },
  (t) => [index("import_rows_batch").on(t.orgId, t.batchId)],
);

export const selections = sqliteTable(
  "selections",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    title: text("title").notNull(),
    area: text("area"),
    dueDate: text("due_date"),
    status: text("status").notNull(),
    allowanceBudgetLineId: text("allowance_budget_line_id"),
    qtyMilli: integer("qty_milli").notNull().default(1000),
    chosenChoiceId: text("chosen_choice_id"),
    costItemId: text("cost_item_id"),
    changeOrderId: text("change_order_id"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("selections_org").on(t.orgId, t.projectId)],
);

export const selectionChoices = sqliteTable(
  "selection_choices",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    selectionId: text("selection_id").notNull(),
    name: text("name").notNull(),
    vendor: text("vendor"),
    sku: text("sku"),
    link: text("link"),
    photoDocumentId: text("photo_document_id"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    note: text("note"),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("selection_choices_selection").on(t.orgId, t.selectionId)],
);

export const selectionEvents = sqliteTable(
  "selection_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    selectionId: text("selection_id").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    reason: text("reason"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    signerName: text("signer_name"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    docHash: text("doc_hash"),
    consentTextVersion: text("consent_text_version"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("selection_events_selection").on(t.orgId, t.selectionId)],
);

export const leadForms = sqliteTable(
  "lead_forms",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    enabled: integer("enabled").notNull().default(0),
    token: text("token").notNull(),
    intro: text("intro").notNull().default(""),
    thanks: text("thanks").notNull(),
    fieldsJson: text("fields_json").notNull(),
    projectTypesJson: text("project_types_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("lead_forms_org").on(t.orgId), uniqueIndex("lead_forms_token").on(t.token)],
);

export const leadFormSubmissions = sqliteTable(
  "lead_form_submissions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    formId: text("form_id").notNull(),
    leadId: text("lead_id").notNull(),
    contactId: text("contact_id").notNull(),
    answersJson: text("answers_json").notNull(),
    attribution: text("attribution"),
    seenAt: text("seen_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("lead_form_submissions_org").on(t.orgId, t.seenAt), index("lead_form_submissions_lead").on(t.orgId, t.leadId)],
);

export const leadFormAttempts = sqliteTable(
  "lead_form_attempts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ip: text("ip").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("lead_form_attempts_org").on(t.orgId, t.createdAt)],
);

export const punchItems = sqliteTable(
  "punch_items",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    costCode: text("cost_code"),
    assigneeUserId: text("assignee_user_id"),
    assigneeContactId: text("assignee_contact_id"),
    dueDate: text("due_date"),
    status: text("status").notNull(),
    shared: integer("shared").notNull().default(0),
    beforeDocumentId: text("before_document_id"),
    afterDocumentId: text("after_document_id"),
    doneAt: text("done_at"),
    verifiedAt: text("verified_at"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("punch_items_org").on(t.orgId, t.projectId)],
);

export const warrantyRequests = sqliteTable(
  "warranty_requests",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    urgency: text("urgency").notNull(),
    status: text("status").notNull(),
    visitDate: text("visit_date"),
    scheduleItemId: text("schedule_item_id"),
    assigneeUserId: text("assignee_user_id"),
    costCode: text("cost_code"),
    costItemId: text("cost_item_id"),
    clientNote: text("client_note"),
    internalNote: text("internal_note"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("warranty_requests_org").on(t.orgId, t.projectId, t.status)],
);

export const warrantyPhotos = sqliteTable(
  "warranty_photos",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    requestId: text("request_id").notNull(),
    documentId: text("document_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("warranty_photos_request").on(t.orgId, t.requestId)],
);

export const warrantyAttempts = sqliteTable(
  "warranty_attempts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ip: text("ip").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("warranty_attempts_org").on(t.orgId, t.createdAt)],
);

/** One secret link per vendor. The URL token is stored as a hash. Regenerating replaces it. */
export const vendorPortals = sqliteTable(
  "vendor_portals",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    contactId: text("contact_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at").notNull(),
    rotatedAt: text("rotated_at"),
  },
  (t) => [uniqueIndex("vendor_portals_contact").on(t.orgId, t.contactId), uniqueIndex("vendor_portals_hash").on(t.tokenHash)],
);

export const vendorCertificates = sqliteTable(
  "vendor_certificates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    contactId: text("contact_id").notNull(),
    type: text("type").notNull(),
    expiresOn: text("expires_on").notNull(),
    documentId: text("document_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("vendor_certificates_type").on(t.orgId, t.contactId, t.type), index("vendor_certificates_org").on(t.orgId, t.contactId)],
);

export const vendorPortalAttempts = sqliteTable(
  "vendor_portal_attempts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ip: text("ip").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("vendor_portal_attempts_org").on(t.orgId, t.createdAt)],
);

export const bidRequests = sqliteTable(
  "bid_requests",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    title: text("title").notNull(),
    scope: text("scope"),
    dueOn: text("due_on").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
    awardedAt: text("awarded_at"),
    closedAt: text("closed_at"),
  },
  (t) => [index("bid_requests_org").on(t.orgId, t.projectId)],
);

export const bidLines = sqliteTable(
  "bid_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    bidId: text("bid_id").notNull(),
    costCode: text("cost_code").notNull(),
    description: text("description").notNull(),
    qtyMilli: integer("qty_milli").notNull(),
    unit: text("unit").notNull(),
    budgetLineId: text("budget_line_id"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("bid_lines_bid").on(t.orgId, t.bidId)],
);

export const bidFiles = sqliteTable(
  "bid_files",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    bidId: text("bid_id").notNull(),
    documentId: text("document_id").notNull(),
  },
  (t) => [index("bid_files_bid").on(t.orgId, t.bidId)],
);

export const bidInvites = sqliteTable(
  "bid_invites",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    bidId: text("bid_id").notNull(),
    contactId: text("contact_id").notNull(),
    status: text("status").notNull(),
    note: text("note"),
    submittedName: text("submitted_name"),
    submittedAt: text("submitted_at"),
    declinedAt: text("declined_at"),
    declineReason: text("decline_reason"),
    documentId: text("document_id"),
  },
  (t) => [uniqueIndex("bid_invites_vendor").on(t.orgId, t.bidId, t.contactId), index("bid_invites_contact").on(t.orgId, t.contactId)],
);

export const bidPrices = sqliteTable(
  "bid_prices",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    inviteId: text("invite_id").notNull(),
    bidLineId: text("bid_line_id").notNull(),
    unitPriceCents: integer("unit_price_cents"),
    noBid: integer("no_bid").notNull().default(0),
  },
  (t) => [uniqueIndex("bid_prices_line").on(t.orgId, t.inviteId, t.bidLineId)],
);

export const bidAwards = sqliteTable(
  "bid_awards",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    bidId: text("bid_id").notNull(),
    bidLineId: text("bid_line_id").notNull(),
    inviteId: text("invite_id").notNull(),
    purchaseOrderId: text("purchase_order_id"),
    amountCents: integer("amount_cents").notNull(),
  },
  (t) => [uniqueIndex("bid_awards_line").on(t.orgId, t.bidLineId), index("bid_awards_bid").on(t.orgId, t.bidId)],
);

/** Job questions. Cost cents stay on the row; the app strips them for field, vendors, and clients. */
export const rfis = sqliteTable(
  "rfis",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    question: text("question").notNull(),
    dueOn: text("due_on"),
    status: text("status").notNull(),
    assigneeKind: text("assignee_kind").notNull(),
    assigneeUserId: text("assignee_user_id"),
    assigneeContactId: text("assignee_contact_id"),
    relatedType: text("related_type"),
    relatedId: text("related_id"),
    internalNote: text("internal_note"),
    costImpact: integer("cost_impact").notNull().default(0),
    costImpactCents: integer("cost_impact_cents"),
    scheduleImpactDays: integer("schedule_impact_days"),
    changeOrderId: text("change_order_id"),
    scheduleShiftedAt: text("schedule_shifted_at"),
    answeredAt: text("answered_at"),
    closedAt: text("closed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [uniqueIndex("rfis_number").on(t.orgId, t.projectId, t.number), index("rfis_org").on(t.orgId, t.projectId)],
);

export const rfiMessages = sqliteTable(
  "rfi_messages",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    rfiId: text("rfi_id").notNull(),
    body: text("body").notNull(),
    authorKind: text("author_kind").notNull(),
    authorUserId: text("author_user_id"),
    authorName: text("author_name").notNull(),
    internal: integer("internal").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("rfi_messages_rfi").on(t.orgId, t.rfiId)],
);

export const rfiFiles = sqliteTable(
  "rfi_files",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    rfiId: text("rfi_id").notNull(),
    messageId: text("message_id"),
    documentId: text("document_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("rfi_files_rfi").on(t.orgId, t.rfiId)],
);

export const rfiAttempts = sqliteTable(
  "rfi_attempts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ip: text("ip").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("rfi_attempts_org").on(t.orgId, t.createdAt)],
);

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    projectId: text("project_id"),
    authorId: text("author_id").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
    editedAt: text("edited_at"),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("comments_entity").on(t.orgId, t.entityType, t.entityId)],
);

export const commentMentions = sqliteTable(
  "comment_mentions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    commentId: text("comment_id").notNull(),
    kind: text("kind").notNull(),
    userId: text("user_id"),
    role: text("role"),
  },
  (t) => [index("comment_mentions_comment").on(t.orgId, t.commentId)],
);

export const commentFiles = sqliteTable(
  "comment_files",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    commentId: text("comment_id").notNull(),
    documentId: text("document_id").notNull(),
  },
  (t) => [index("comment_files_comment").on(t.orgId, t.commentId)],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    commentId: text("comment_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    projectId: text("project_id"),
    actorId: text("actor_id"),
    actorName: text("actor_name").notNull(),
    snippet: text("snippet").notNull(),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("notifications_user").on(t.orgId, t.userId, t.createdAt)],
);

export const notificationSettings = sqliteTable("notification_settings", {
  userId: text("user_id").primaryKey(),
  orgId: text("org_id").notNull(),
  mode: text("mode").notNull(),
});

export const commentAttempts = sqliteTable(
  "comment_attempts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("comment_attempts_user").on(t.orgId, t.userId, t.createdAt)],
);

/** Finish-to-start link. Lag is workdays after the predecessor finish. */
export const scheduleLinks = sqliteTable(
  "schedule_links",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    itemId: text("item_id").notNull(),
    predecessorId: text("predecessor_id").notNull(),
    lagWorkdays: integer("lag_workdays").notNull().default(0),
  },
  (t) => [uniqueIndex("schedule_links_edge").on(t.orgId, t.itemId, t.predecessorId), index("schedule_links_project").on(t.orgId, t.projectId)],
);

/** Company rows have a null project. Job rows override the company for that job. kind is off or work. */
export const workdayExceptions = sqliteTable(
  "workday_exceptions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id"),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    yearly: integer("yearly").notNull().default(0),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("workday_exceptions_org").on(t.orgId, t.startDate)],
);

/** current = 1 is the baseline the schedule compares against. Older rows stay as history. */
export const scheduleBaselines = sqliteTable(
  "schedule_baselines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    finishDate: text("finish_date").notNull(),
    current: integer("current").notNull().default(0),
    setAt: text("set_at").notNull(),
    setBy: text("set_by"),
  },
  (t) => [index("schedule_baselines_project").on(t.orgId, t.projectId, t.current)],
);

export const scheduleBaselineItems = sqliteTable(
  "schedule_baseline_items",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    baselineId: text("baseline_id").notNull(),
    itemId: text("item_id").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
  },
  (t) => [index("schedule_baseline_items_base").on(t.orgId, t.baselineId)],
);

/** Internal. One row per slip of a root item. Cascades do not add a row per successor. */
export const scheduleDelays = sqliteTable(
  "schedule_delays",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    itemId: text("item_id").notNull(),
    days: integer("days").notNull(),
    reason: text("reason").notNull(),
    note: text("note"),
    actorId: text("actor_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("schedule_delays_project").on(t.orgId, t.projectId)],
);

export const jobTemplates = sqliteTable(
  "job_templates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    jobType: text("job_type").notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("job_templates_org").on(t.orgId, t.name)],
);

export const templateTasks = sqliteTable(
  "template_tasks",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    templateId: text("template_id").notNull(),
    itemKey: text("item_key").notNull(),
    title: text("title").notNull(),
    phase: text("phase"),
    startOffset: integer("start_offset").notNull(),
    durationWorkdays: integer("duration_workdays").notNull(),
    trade: text("trade"),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("template_tasks_template").on(t.orgId, t.templateId)],
);

export const templateTodos = sqliteTable(
  "template_todos",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    templateId: text("template_id").notNull(),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    priority: text("priority").notNull().default("normal"),
    tags: text("tags").notNull().default(""),
    remindDays: integer("remind_days"),
    scheduleKey: text("schedule_key"),
    deadlineEdge: text("deadline_edge"),
    deadlineOffset: integer("deadline_offset"),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("template_todos_template").on(t.orgId, t.templateId)],
);

export const templateTodoChecks = sqliteTable(
  "template_todo_checks",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    templateId: text("template_id").notNull(),
    todoId: text("todo_id").notNull(),
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("template_todo_checks_todo").on(t.orgId, t.todoId)],
);

export const templateTaskLinks = sqliteTable(
  "template_task_links",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    templateId: text("template_id").notNull(),
    itemKey: text("item_key").notNull(),
    predecessorKey: text("predecessor_key").notNull(),
    lagWorkdays: integer("lag_workdays").notNull().default(0),
  },
  (t) => [index("template_task_links_template").on(t.orgId, t.templateId)],
);

export const templateLines = sqliteTable(
  "template_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    templateId: text("template_id").notNull(),
    name: text("name").notNull(),
    costCode: text("cost_code"),
    qtyMilli: integer("qty_milli").notNull(),
    unit: text("unit").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    sortOrder: integer("sort_order").notNull(),
    qtyFormula: text("qty_formula"),
    wasteBps: integer("waste_bps").notNull().default(0),
    roundToMilli: integer("round_to_milli"),
  },
  (t) => [index("template_lines_template").on(t.orgId, t.templateId)],
);

export const templateDraws = sqliteTable(
  "template_draws",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    templateId: text("template_id").notNull(),
    title: text("title").notNull(),
    bps: integer("bps").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("template_draws_template").on(t.orgId, t.templateId)],
);

export const templateSelections = sqliteTable(
  "template_selections",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    templateId: text("template_id").notNull(),
    title: text("title").notNull(),
    area: text("area"),
    allowanceCents: integer("allowance_cents").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("template_selections_template").on(t.orgId, t.templateId)],
);

export const templateChecks = sqliteTable(
  "template_checks",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    templateId: text("template_id").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("template_checks_template").on(t.orgId, t.templateId)],
);

export const templateAttempts = sqliteTable(
  "template_attempts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("template_attempts_user").on(t.orgId, t.userId, t.createdAt)],
);

/** One forecast per job. Null means the report uses the cost-code formula. */
export const wipOverrides = sqliteTable(
  "wip_overrides",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    note: text("note").notNull(),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by"),
  },
  (t) => [uniqueIndex("wip_overrides_project").on(t.orgId, t.projectId)],
);

export const wipAttempts = sqliteTable(
  "wip_attempts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("wip_attempts_user").on(t.orgId, t.userId, t.createdAt)],
);

export const savedViews = sqliteTable(
  "saved_views",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    listKey: text("list_key").notNull(),
    name: text("name").notNull(),
    queryJson: text("query_json").notNull(),
    sortKey: text("sort_key"),
    sortDir: text("sort_dir"),
    shared: integer("shared").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("saved_views_org_list").on(t.orgId, t.listKey)],
);

export const submittals = sqliteTable(
  "submittals",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    specNote: text("spec_note").notNull(),
    division: text("division"),
    status: text("status").notNull(),
    dueOn: text("due_on"),
    assigneeKind: text("assignee_kind").notNull(),
    assigneeUserId: text("assignee_user_id"),
    assigneeContactId: text("assignee_contact_id"),
    relatedType: text("related_type"),
    relatedId: text("related_id"),
    internalNote: text("internal_note"),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [uniqueIndex("submittals_number").on(t.orgId, t.projectId, t.number), index("submittals_org").on(t.orgId, t.projectId)],
);

export const submittalRevisions = sqliteTable(
  "submittal_revisions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    submittalId: text("submittal_id").notNull(),
    revision: integer("revision").notNull(),
    note: text("note").notNull().default(""),
    reviewNote: text("review_note"),
    authorName: text("author_name").notNull(),
    reviewerName: text("reviewer_name"),
    createdAt: text("created_at").notNull(),
    reviewedAt: text("reviewed_at"),
  },
  (t) => [uniqueIndex("submittal_revisions_rev").on(t.orgId, t.submittalId, t.revision)],
);

export const submittalFiles = sqliteTable(
  "submittal_files",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    submittalId: text("submittal_id").notNull(),
    revisionId: text("revision_id").notNull(),
    documentId: text("document_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("submittal_files_sub").on(t.orgId, t.submittalId)],
);

export const submittalAttempts = sqliteTable(
  "submittal_attempts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ip: text("ip").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("submittal_attempts_org").on(t.orgId, t.createdAt)],
);

export const lienWaiverTemplates = sqliteTable(
  "lien_waiver_templates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    type: text("type").notNull(),
    body: text("body").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("lien_waiver_templates_org_type").on(t.orgId, t.type)],
);

export const lienWaivers = sqliteTable(
  "lien_waivers",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    billId: text("bill_id").notNull(),
    projectId: text("project_id").notNull(),
    vendorContactId: text("vendor_contact_id").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    amountCents: integer("amount_cents").notNull(),
    throughDate: text("through_date").notNull(),
    body: text("body").notNull(),
    signedName: text("signed_name"),
    signedAt: text("signed_at"),
    signedText: text("signed_text"),
    documentId: text("document_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("lien_waivers_org_bill").on(t.orgId, t.billId), index("lien_waivers_vendor").on(t.orgId, t.vendorContactId)],
);

export const lienWaiverAttempts = sqliteTable(
  "lien_waiver_attempts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ip: text("ip").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("lien_waiver_attempts_org").on(t.orgId, t.createdAt)],
);

export const fileFolderDefaults = sqliteTable(
  "file_folder_defaults",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    visibility: text("visibility").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: text("archived_at"),
  },
  (t) => [index("file_folder_defaults_org").on(t.orgId, t.sortOrder)],
);

export const fileFolders = sqliteTable(
  "file_folders",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    visibility: text("visibility").notNull(),
    vendorContactId: text("vendor_contact_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("file_folders_project").on(t.orgId, t.projectId)],
);

export const jobFiles = sqliteTable(
  "job_files",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    folderId: text("folder_id").notNull(),
    documentId: text("document_id").notNull(),
    name: text("name").notNull(),
    revisionGroupId: text("revision_group_id").notNull(),
    revision: integer("revision").notNull(),
    isCurrent: integer("is_current").notNull().default(1),
    visibilityOverride: text("visibility_override"),
    shareHistory: integer("share_history").notNull().default(0),
    byteSize: integer("byte_size").notNull().default(0),
    uploadedByName: text("uploaded_by_name").notNull(),
    uploadedByUserId: text("uploaded_by_user_id"),
    uploadedByContactId: text("uploaded_by_contact_id"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("job_files_project").on(t.orgId, t.projectId), index("job_files_group").on(t.orgId, t.revisionGroupId)],
);

export const planRefs = sqliteTable(
  "plan_refs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    revisionGroupId: text("revision_group_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("plan_refs_target").on(t.orgId, t.targetType, t.targetId, t.revisionGroupId)],
);

export const jobFileAttempts = sqliteTable(
  "job_file_attempts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ip: text("ip").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("job_file_attempts_org").on(t.orgId, t.createdAt)],
);

export const savedViewPins = sqliteTable(
  "saved_view_pins",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    listKey: text("list_key").notNull(),
    viewId: text("view_id").notNull(),
  },
  (t) => [uniqueIndex("saved_view_pins_user_list").on(t.orgId, t.userId, t.listKey)],
);

export const clientUpdates = sqliteTable(
  "client_updates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    rangeStart: text("range_start").notNull(),
    rangeEnd: text("range_end").notNull(),
    status: text("status").notNull(),
    body: text("body").notNull(),
    sourcesJson: text("sources_json").notNull(),
    photoIdsJson: text("photo_ids_json").notNull(),
    publishedAt: text("published_at"),
    viewedAt: text("viewed_at"),
    unpublishedAt: text("unpublished_at"),
    unpublishReason: text("unpublish_reason"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("client_updates_project").on(t.orgId, t.projectId)],
);

/** Per cost-code markup on a cost-plus job. Missing codes use the job default. */
export const costCodeMarkups = sqliteTable(
  "cost_code_markups",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    costCode: text("cost_code").notNull(),
    markupBps: integer("markup_bps").notNull(),
  },
  (t) => [uniqueIndex("cost_code_markups_code").on(t.orgId, t.projectId, t.costCode)],
);

/** One row ties a bill line, receipt, or time entry to a single invoice, or marks it non-billable. */
export const invoiceCosts = sqliteTable(
  "invoice_costs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    invoiceId: text("invoice_id"),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    costCode: text("cost_code").notNull(),
    label: text("label").notNull(),
    occurredOn: text("occurred_on").notNull(),
    costCents: integer("cost_cents").notNull(),
    markupBps: integer("markup_bps").notNull(),
    markupCents: integer("markup_cents").notNull(),
    priceCents: integer("price_cents").notNull(),
    nonBillable: integer("non_billable").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("invoice_costs_source").on(t.orgId, t.sourceKind, t.sourceId), index("invoice_costs_invoice").on(t.orgId, t.invoiceId)],
);

export const clientUpdateVersions = sqliteTable(
  "client_update_versions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    updateId: text("update_id").notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    sourcesJson: text("sources_json").notNull(),
    photoIdsJson: text("photo_ids_json").notNull(),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("client_update_versions_update").on(t.orgId, t.updateId)],
);

export const permits = sqliteTable(
  "permits",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    permitType: text("permit_type").notNull(),
    number: text("number").notNull().default(""),
    jurisdiction: text("jurisdiction").notNull().default(""),
    status: text("status").notNull(),
    appliedOn: text("applied_on"),
    issuedOn: text("issued_on"),
    expiresOn: text("expires_on"),
    feeCents: integer("fee_cents"),
    costCode: text("cost_code"),
    costItemId: text("cost_item_id"),
    showPassed: integer("show_passed").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("permits_project").on(t.orgId, t.projectId)],
);

export const inspections = sqliteTable(
  "inspections",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    permitId: text("permit_id").notNull(),
    rootId: text("root_id").notNull(),
    attempt: integer("attempt").notNull(),
    name: text("name").notNull(),
    scheduleItemId: text("schedule_item_id"),
    requestedOn: text("requested_on"),
    scheduledOn: text("scheduled_on"),
    inspector: text("inspector"),
    result: text("result").notNull(),
    resultOn: text("result_on"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("inspections_permit").on(t.orgId, t.permitId), index("inspections_project").on(t.orgId, t.projectId)],
);

export const inspectionGates = sqliteTable(
  "inspection_gates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    inspectionId: text("inspection_id").notNull(),
    scheduleItemId: text("schedule_item_id").notNull(),
  },
  (t) => [uniqueIndex("inspection_gates_item").on(t.orgId, t.inspectionId, t.scheduleItemId)],
);

export const recordFiles = sqliteTable(
  "record_files",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    jobFileId: text("job_file_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("record_files_target").on(t.orgId, t.targetType, t.targetId, t.jobFileId)],
);

export const templatePermits = sqliteTable(
  "template_permits",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    templateId: text("template_id").notNull(),
    itemKey: text("item_key").notNull(),
    permitType: text("permit_type").notNull(),
    jurisdiction: text("jurisdiction").notNull().default(""),
  },
  (t) => [index("template_permits_template").on(t.orgId, t.templateId)],
);

export const templateInspections = sqliteTable(
  "template_inspections",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    templateId: text("template_id").notNull(),
    itemKey: text("item_key").notNull(),
    permitKey: text("permit_key").notNull(),
    name: text("name").notNull(),
    offsetWorkdays: integer("offset_workdays").notNull(),
    scheduleKey: text("schedule_key"),
  },
  (t) => [index("template_inspections_template").on(t.orgId, t.templateId)],
);

export const templateInspectionGates = sqliteTable(
  "template_inspection_gates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    templateId: text("template_id").notNull(),
    inspectionKey: text("inspection_key").notNull(),
    taskKey: text("task_key").notNull(),
  },
  (t) => [index("template_inspection_gates_template").on(t.orgId, t.templateId)],
);

/** One current drawing layer per photo or plan page. The source document stays as uploaded. */
export const markups = sqliteTable(
  "markups",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    sourceDocumentId: text("source_document_id").notNull(),
    page: integer("page").notNull().default(1),
    layerJson: text("layer_json").notNull(),
    flatDocumentId: text("flat_document_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
  },
  (t) => [uniqueIndex("markups_target").on(t.orgId, t.targetType, t.targetId, t.page)],
);

/** Numbered pin on a plan revision. copiedFromId is set when a new revision carries the pin forward. */
export const planPins = sqliteTable(
  "plan_pins",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    jobFileId: text("job_file_id").notNull(),
    number: integer("number").notNull(),
    xMilli: integer("x_milli").notNull(),
    yMilli: integer("y_milli").notNull(),
    linkType: text("link_type").notNull(),
    linkId: text("link_id").notNull(),
    note: text("note").notNull().default(""),
    cropDocumentId: text("crop_document_id"),
    copiedFromId: text("copied_from_id"),
    reviewed: integer("reviewed").notNull().default(1),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("plan_pins_file").on(t.orgId, t.jobFileId)],
);
