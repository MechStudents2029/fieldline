# Changelog

## 2026-10-05

### Company time zone

- Each company has an IANA time zone and a workweek start day. Rivera is America/New_York. Northline is America/Los_Angeles. A new company takes the browser zone and starts the week on Monday. An owner or admin changes both in Settings. The change writes a before/after audit row and does not move stored clock times.
- Days and weeks use that clock: punches, the 40-hour flag, payroll CSV dates, daily logs, My day, and the missing-log nudge. A shift counts on the local day it clocked in. The week starts at local midnight and runs seven calendar days, so the spring-forward day is 23 hours and the fall-back day is 25. Unlocked week totals regroup. Approved labor on the job stays as it was.
- Follow-up drafts still wait a fixed number of hours after a proposal is sent or viewed. They do not snap to a local midnight. There is no overtime pay math and no weather service.

### Daily logs

- A job has one log per person per UTC day. Save a draft, then publish. The date cannot be in the future. Notes are the only required field. Weather, delays, deliveries, visitors, and safety sit behind a disclosure. Photos use the same camera capture as the job.
- Crew headcount and hours by cost code come from that day’s punches, including time the office has not approved. The log does not show rates or labor cost.
- Logs are internal until an office role marks a published log client-visible. The portal then shows the work note, what’s next, hand-entered weather, deliveries, visitors, and that log’s photos. Delays, safety notes, crew names, hours, and costs stay off the portal. Nothing is emailed. Once a log is on the portal, only the office can edit it.
- Edits after publish keep a history row. A log is voided with a reason, not deleted. Today lists jobs that had punches yesterday and no published log. Copilot answers “what happened on a job yesterday?” from published logs and cites the log. Weather is typed. There is no weather service.

### Time tracking

- A member clocks in on a job and cost code from the Time screen, switches jobs without a separate clock-out, takes a break, and clocks out with an optional note. They see today and this week. They do not see rates or labor cost.
- The office sets an hourly cost (a company default, or a rate per person), reviews pending punches, edits them, and approves them. A manual punch needs a reason. Approval posts hours times the rate at that moment onto the job budget by cost code. Unapproved time is not a cost. Approved punches are locked until someone reopens them with a reason.
- Every create, edit, approve, reopen, and void keeps who, when, before, after, and the reason. A punch is voided, not deleted. Today and the review list flag a shift still open after 12 hours, more than 40 hours in a Monday–UTC week, and overlapping punches. Nothing closes by itself.
- Location is optional, once per punch, from the browser. A denial still clocks in, and only coordinates are stored. Payroll export is a CSV of approved hours per person per day for an owner or admin. There is no wage calculation and no payroll provider.

### Team invites

- An owner or admin invites a teammate from Settings by email and role (admin, office, or field). Fieldline does not send email. The page shows a link and a short message to paste. The link is shown once.
- The token is 32 random bytes. The database stores only its SHA-256 hash, bound to the company, email, and role. Admin invites expire in 48 hours. Office and field invites expire in 7 days. Accepting is a single use, in one transaction with the membership insert. Inviting the same email again revokes the earlier pending invite. A bad, used, expired, or revoked link returns one generic error. The link host comes from `APP_URL`.
- The accept page previews the company, role, and inviter without joining. The signed-in email must match the invited email. Demo login and Supabase Auth both work. A field login can see jobs, notes, photos, tasks, and receipts, and cannot see prices, invoices, or the team controls.

### Onboarding

- Sign-in offers Start a new company. That creates an empty org, an owner, and a sales pipeline. The Rivera demo login is unchanged, and the new company does not see Rivera rows.
- An optional starter price book (kitchen and bath, deck, roofing, or general) is inserted only for that company and marked starter, edit your prices. The same choice is on an empty price book.
- Today shows a setup checklist derived from the license, price book, leads, estimates, and sent proposals. Hide it there, and bring it back from Settings or More. Send proposal stays a button. Nothing is emailed.
- Empty office lists say what belongs there and link to the action that fills them. The seeded demo still shows its jobs, leads, and invoices.

## 2026-10-04

### Tester readiness

- Playwright (Chromium) runs the kitchen job, a change order, and a follow-up draft against `next start` on a throwaway seeded database. `npm run e2e` is separate from `npm run check`.
- Approving a follow-up keeps the “sent” note on the page after the draft leaves the list.
- Send feedback stores a note, the page path, and optional context on the company. An owner or admin can read them. Nothing is emailed.
- A crash in the office, portal, proposal, or pay page shows Try again and a short reference. The same id is written to the server log. There is no error-tracking account.

### Mobile / PWA

- Install icons are 192 and 512 PNG, plus the SVG mark and an Apple touch icon. The manifest stays standalone and starts at `/`.
- The service worker caches that shell and content-hashed `/_next/static` files. Pages, server payloads, and API routes stay on the network. There is no offline outbox.
- Job and estimate photos open the rear camera. A large shot is reduced in the browser before upload. Receipts stay text files. No image is sent to a vision service.
- The office shows a small banner while the browser is offline and clears it when the connection returns.

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

### Follow-up timing

- A proposal the client opened is drafted after 1 day. One that was never opened waits 3 days. The two drafts read differently. Both stay pending until someone approves them.
- Signing, declining, or moving the deal to won or lost dismisses the pending proposal and quiet-lead drafts. The follow-up scan does the same if a draft is still open.
- Today lists drafts waiting for approval and links to Follow-ups. It does not send them.
- After an approved nudge, a still-open proposal gets an office call task (4 days if viewed, 7 if never opened). That task is not a second client email.

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
