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
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by"),
});

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
});

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
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("invoices_org").on(t.orgId)],
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

export const bills = sqliteTable("bills", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  projectId: text("project_id").notNull(),
  vendorContactId: text("vendor_contact_id"),
  amountCents: integer("amount_cents").notNull(),
  dueDate: text("due_date"),
  status: text("status").notNull(),
  memo: text("memo"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by"),
});

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
    uniqueIndex("time_entries_client_event").on(t.clientEventId),
  ],
);

/** Idempotency row for one offline punch or log draft. Replay returns result_json. */
export const syncEvents = sqliteTable(
  "sync_events",
  {
    clientEventId: text("client_event_id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    capturedAt: text("captured_at").notNull(),
    status: text("status").notNull(),
    resultJson: text("result_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("sync_events_org_user").on(t.orgId, t.userId)],
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
  (t) => [index("time_anomalies_org").on(t.orgId), uniqueIndex("time_anomalies_event").on(t.clientEventId)],
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

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
