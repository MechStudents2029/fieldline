CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`summary` text NOT NULL,
	`payload_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activities_entity` ON `activities` (`org_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`feature` text NOT NULL,
	`model` text NOT NULL,
	`tokens_in` integer NOT NULL,
	`tokens_out` integer NOT NULL,
	`cost_cents` integer NOT NULL,
	`input_ref` text,
	`output_json` text,
	`latency_ms` integer,
	`created_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`payload_json` text,
	`ip` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bills` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`project_id` text NOT NULL,
	`vendor_contact_id` text,
	`amount_cents` integer NOT NULL,
	`due_date` text,
	`status` text NOT NULL,
	`memo` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE TABLE `budget_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`project_id` text NOT NULL,
	`change_order_id` text,
	`name` text NOT NULL,
	`cost_code` text,
	`budget_cost_cents` integer NOT NULL,
	`budget_price_cents` integer NOT NULL,
	`source_line_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `change_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`change_order_id` text NOT NULL,
	`name` text NOT NULL,
	`qty_milli` integer NOT NULL,
	`unit` text NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`markup_bps` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`cost_code` text,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `change_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`description` text,
	`price_delta_cents` integer NOT NULL,
	`cost_delta_cents` integer NOT NULL,
	`public_token` text NOT NULL,
	`sent_at` text,
	`approved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `change_orders_public_token_unique` ON `change_orders` (`public_token`);--> statement-breakpoint
CREATE TABLE `consents` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`source` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`company` text,
	`email` text,
	`phone` text,
	`address` text,
	`city` text,
	`state` text,
	`zip` text,
	`notes` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE INDEX `contacts_org` ON `contacts` (`org_id`);--> statement-breakpoint
CREATE TABLE `cost_items` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`project_id` text NOT NULL,
	`budget_line_id` text,
	`cost_code` text,
	`amount_cents` integer NOT NULL,
	`vendor_name` text,
	`memo` text,
	`source` text NOT NULL,
	`ai_extracted` integer DEFAULT 0 NOT NULL,
	`document_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`project_id` text,
	`lead_id` text,
	`contact_id` text,
	`type` text NOT NULL,
	`filename` text NOT NULL,
	`storage_path` text NOT NULL,
	`metadata_json` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE TABLE `estimate_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`estimate_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `estimates` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`markup_bps` integer NOT NULL,
	`tax_bps` integer NOT NULL,
	`margin_target_bps` integer NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE TABLE `follow_up_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`contact_id` text,
	`lead_id` text,
	`proposal_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`label` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`project_id` text NOT NULL,
	`change_order_id` text,
	`number` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`schedule_index` integer,
	`issue_date` text NOT NULL,
	`due_date` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`amount_paid_cents` integer DEFAULT 0 NOT NULL,
	`pay_token` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_pay_token_unique` ON `invoices` (`pay_token`);--> statement-breakpoint
CREATE INDEX `invoices_org` ON `invoices` (`org_id`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`title` text NOT NULL,
	`source` text NOT NULL,
	`value_est_cents` integer,
	`owner_user_id` text,
	`status` text NOT NULL,
	`lost_reason` text,
	`scope_text` text,
	`sqft` integer,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE INDEX `leads_org` ON `leads` (`org_id`);--> statement-breakpoint
CREATE TABLE `line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`section_id` text NOT NULL,
	`estimate_id` text NOT NULL,
	`price_book_item_id` text,
	`name` text NOT NULL,
	`description` text,
	`qty_milli` integer NOT NULL,
	`unit` text NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`markup_bps` integer NOT NULL,
	`cost_code` text,
	`source` text NOT NULL,
	`ai_confidence_milli` integer,
	`source_note` text,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_org_user` ON `memberships` (`org_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `message_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`lead_id` text,
	`project_id` text,
	`subject` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`channel` text NOT NULL,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`consent_ok` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`trade_focus` text,
	`city` text,
	`state` text,
	`license_number` text,
	`margin_alert_bps` integer DEFAULT 2000 NOT NULL,
	`default_markup_bps` integer DEFAULT 3500 NOT NULL,
	`tax_bps` integer DEFAULT 0 NOT NULL,
	`deposit_bps` integer DEFAULT 4000 NOT NULL,
	`progress_bps` integer DEFAULT 4000 NOT NULL,
	`final_bps` integer DEFAULT 2000 NOT NULL,
	`card_enabled` integer DEFAULT 1 NOT NULL,
	`terms_version` text DEFAULT '2026-09-01' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`method` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`fee_cents` integer NOT NULL,
	`net_cents` integer NOT NULL,
	`status` text NOT NULL,
	`stripe_payment_intent` text,
	`idempotency_key` text NOT NULL,
	`failure_reason` text,
	`stub` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_idem` ON `payments` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `pipeline_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`pipeline_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stages_org` ON `pipeline_stages` (`org_id`);--> statement-breakpoint
CREATE TABLE `pipelines` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_book_items` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`unit` text NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`default_markup_bps` integer NOT NULL,
	`vendor` text,
	`keywords` text,
	`last_used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_book_org_code` ON `price_book_items` (`org_id`,`code`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`lead_id` text,
	`proposal_id` text,
	`contact_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`address` text,
	`contract_value_cents` integer NOT NULL,
	`original_contract_cents` integer NOT NULL,
	`start_date` text,
	`end_date` text,
	`portal_token` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_portal_token_unique` ON `projects` (`portal_token`);--> statement-breakpoint
CREATE INDEX `projects_org` ON `projects` (`org_id`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`estimate_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`project_id` text,
	`status` text NOT NULL,
	`public_token` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`payment_schedule_json` text NOT NULL,
	`terms_version` text NOT NULL,
	`total_cents` integer NOT NULL,
	`sent_at` text,
	`viewed_at` text,
	`signed_at` text,
	`declined_at` text,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposals_public_token_unique` ON `proposals` (`public_token`);--> statement-breakpoint
CREATE INDEX `proposals_org` ON `proposals` (`org_id`);--> statement-breakpoint
CREATE TABLE `signatures` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`proposal_id` text,
	`change_order_id` text,
	`signer_name` text NOT NULL,
	`signer_email` text,
	`typed_name` text NOT NULL,
	`drawn_data_url` text,
	`signed_at` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`doc_hash` text NOT NULL,
	`consent_text_version` text NOT NULL,
	`consent_accepted` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`title` text NOT NULL,
	`assignee_user_id` text,
	`due_at` text,
	`related_type` text,
	`related_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`title` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);