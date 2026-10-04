# Changelog

## 2026-10-04

### Photo context

- Drafting reads each photo caption and the words in the file name, not the raw filename alone.
- A line that only a photo triggered stays at 56% confidence and says it needs a site check. A caption that agrees with the written scope scores higher.
- Quantities still come from dimensions in the scope. A guessed quantity says it needs a site measure.
- The estimate review page lists photo-driven and low-confidence lines. Sending the proposal stays a button.
- When `AI_GATEWAY_API_KEY` is set, the prompt includes those captions. Unknown codes are dropped, and a failed call uses the local matcher. No image bytes are sent.

### QuickBooks CSV

- Customers download as `fieldline-qbo-customers.csv` with DisplayName, name, email, phone, and billing address columns for Import Data.
- Invoices download as `fieldline-qbo-invoices.csv`, one row per positive line, repeating InvoiceNo. Tax code is NON. Zero and negative lines are omitted.
- Import customers first. Customer must match DisplayName. QuickBooks Online accepts about 100 invoices and 1,000 rows per file. There is no Intuit connection.

### Office RLS

- When Supabase Auth is on, `getClaims()` must verify the member before contacts, pipeline, jobs, invoices, or the signed-in company are read. On Postgres those queries run as role `authenticated` with the user's JWT, not as the table owner.
- Portal, pay, Stripe webhooks, follow-up cron, and seed still use the owner connection. Empty Supabase env keeps the demo cookie and `getDb()`.
- A service-role JWT placed in `NEXT_PUBLIC_SUPABASE_ANON_KEY` is ignored.

### Receipt review

- A receipt read now picks up a purchase date and priced lines when the text has them, plus the vendor and total. Demo samples still resolve Casa Tile, Harbor Plumbing, and Summit Lumber.
- The suggested cost code comes from this company's price book and past costs. If several codes match, the field stays blank. Nothing outside that list is invented.
- Reading a receipt shows a review form. Posting is a separate button. A low-confidence read cannot skip that. Today lists receipts that are not on a job yet.

### Office RLS (remaining)

- Job detail, estimates, the price book, tasks, activity, and copilot sources use the same verified-claim session as the office lists. Queries still filter `org_id`.
- Office creates and updates (contacts, leads, estimates, costs, change orders, invoices, tasks, settings) use that session when Auth is on, so `WITH CHECK` applies. Sending a proposal or change order stays a button.
- Portal, pay, Stripe webhooks, follow-up cron, and seed stay on the owner connection. The first sign-in still writes `auth_user_id` there, before a member JWT exists. SQLite cannot `SET ROLE`; the claim check still blocks the other company, and the authenticated role is Postgres.

## 2026-10-03

### Security and money

- Production and Vercel require `CRON_SECRET` before `/api/cron/follow-ups` can scan companies.
- Unsigned Stripe webhooks are rejected on a public deploy unless `FIELDLINE_ALLOW_DEMO_WEBHOOK=1`.
- File downloads return 404 for another company, stay inside the data directory, and do not serve active SVG as a page.
- Estimate lines, costs, and typed dollar amounts reject negatives and amounts over $10,000,000. Field staff cannot download the invoice CSV.
- Estimate photos are limited to the signed-in company.

### Postgres

- `DATABASE_URL` migrates and seeds Postgres on boot. An empty URL still uses the SQLite demo.
- Foreign keys are applied after the tables exist. Tests run the same seed against in-memory Postgres.

### Main flow

- Proposal, invoice, and portal routes have a loading skeleton and a retry state.
- The office shell has a skip link and marks the current section. Pay, pipeline, contacts, and change orders name their fields.

### CI

- `npm run check` runs lint, `tsc --noEmit`, tests, and `next build`.

### Stripe test mode

- With `sk_test_` and `pk_test_`, the pay page creates one PaymentIntent per invoice and amount (ACH first, card optional) and stores the id on the payment row.
- A verified `payment_intent.succeeded` webhook marks the invoice paid once. Processing and failed events do not.
- Empty Stripe keys keep the local test-number mirror. Live keys are refused. Connect and platform fees are not wired.

### Supabase Auth

- `NEXT_PUBLIC_SUPABASE_URL` plus an anon or publishable key signs in through Supabase and stores `users.auth_user_id` on the matching membership. `src/proxy.ts` refreshes that session with `getClaims()`.
- Empty Supabase env keeps the demo password and the HMAC cookie. `SUPABASE_SERVICE_ROLE_KEY` is server-only.

### Margin watch

- Open jobs warn when a cost code reaches 80% of its budget, and again when spend passes that budget.
- An overrun with no draft, sent, or approved change order offers a one-click draft. The draft is not sent to the client.
- Today and the job page list the code, percent, and overage. Copilot mentions the same codes on margin questions.
