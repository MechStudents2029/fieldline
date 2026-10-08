# Changelog

## 2026-10-08

### Lists

- To-dos, RFIs, Bills, Purchase orders, WIP, Clients, Leads, Jobs, and Inbox share one filter row. Each control shows its current value, such as Assignee: Any, and the list updates when it changes. Clear removes them. On a phone the row sits behind Filter.
- A saved view stores that list’s filters for one person. Pin makes it the default. Office can share a view with the company. Maya has My overdue and Awaiting answer. Dana has This week and High.
- A checklist row shows the item, the person, and the date. Click the row to edit it. Enter saves and Esc cancels. Move and Delete sit in the row menu. Checks on a to-do list shows the first items under the title.
- Dates read Oct 7 this year, Oct 7, 2025 in another year, and 2:30 PM for a time.
- A selected table row stays a light teal tint, and a job name truncates instead of wrapping.

## 2026-10-07

### To-dos

- A to-do has a title, notes, priority, tags, assignees, photos, and a checklist. Each checklist item can have its own person and date. The row shows progress, such as 3/7. Checking the last item offers Mark to-do done. Unchecking an item on a done to-do opens it again. Every completion is on the audit log.
- The deadline is a date, or a number of workdays before or after a schedule item’s start or finish. Moving that item, including a cascade, moves the to-do. The Moves count includes those to-dos. Deleting the schedule item keeps the last date and shows it unlinked.
- A reminder of N days before the deadline lands in Inbox for the assigned people. Nothing is emailed or texted. Today shows one Overdue to-dos row with the count.
- Field sees and ticks only items assigned to them. A vendor portal shows only that vendor’s items, and they can tick one and attach a photo. They do not see money or another job. Office filters the list by assignee, job, priority, due, and status, sorts by due date, and can complete several at once.
- Bathroom remodel and Kitchen remodel include a Pre-drywall walk checklist tied to rough plumbing. A new job can copy those to-dos with the schedule.

### Work in progress

- Reports holds a WIP page for the owner, an admin, and office. Field does not see it. One row per open job, plus a total. The as-of date rebuilds the month from records dated on or before that day. Filter by PM or status. A row opens that job’s cost codes. A projected-cost override needs a note and shows on the row.
- CSV downloads the rows on screen. The filename carries the as-of date. Print is a landscape page. Today lists Underbilled with the count and the dollars. A selected row uses a light teal tint so a red underbilled amount stays readable.

### Job templates

- A schedule item can depend on another item finishing first, with a lag in company workdays. Moving or extending that item shifts the items that follow. A loop is refused. The count shows before the save, as in Moves 4 items. An RFI schedule impact uses the same shift. The change is on the audit log.
- Templates live under Work. A template holds a schedule with offsets and trades, estimate lines, a draw schedule in percent, selections with allowances, and a punch list. It does not keep a client, a vendor price, or a photo. Saving a job as a template asks which parts, with a count on each, and drops the client, the dates, the actuals, and the statuses.
- A new job picks a template, the parts, a start date, a PM, and a vendor for each trade. Dates land on workdays. Draws are rescaled so they match the contract to the cent. An empty template is refused. Importing into a job only adds rows. The job keeps the template name and version it was made from. Later edits to the template do not change that job. Field does not see template money. Office manages templates. Writes are rate limited and audited.

### Comments and Inbox

- A job, estimate, change order, purchase order, bill, RFI, punch item, daily log, or schedule item can hold an internal comment thread. Text keeps line breaks. A photo uses the same upload check as the rest of the app. The author can edit for 15 minutes and can delete their own comment. Both are on the audit log. Posting is rate limited. Client and vendor portals do not show these comments. Field can comment on jobs they can see, and cannot see comments on estimates, change orders, purchase orders, or bills.
- Typing @ opens the people who can see that record, plus Office, Field, and Admins. A mention is stored as a person or a role, and it shows as a neutral pill. Mentioning someone who cannot see the record is refused. A person named and included by role gets one notice. The author is not notified.
- Inbox sits in the sidebar with the unread count. A row shows who, the job and record (RFI-001, CO-3), a one-line snippet, and the age. Notices are created for a mention, a reply in a thread you joined, an assignment on an RFI, punch item, or schedule item, and a vendor or client answer on an RFI you asked. Opening a row marks it read. Mark all read, and filter Unread, Mentions, or All. j and k move, Enter opens the record at the comment. Today has one Mentions count that opens Inbox. Each person can take mentions only, or all activity on their jobs. Nothing is emailed or texted.
- Number, date, age, and money columns stay on one line with tabular figures. Portal photo and file controls are a button that shows the chosen file name and a remove control.

### Requests for information

- A job can hold an RFI: a short title, the question, a due date, and an assignee. The assignee is a teammate, a vendor already on the job, or the client. It can point at a schedule item, selection, purchase order, bid, punch item, or change order, and it can carry a photo. Numbers run RFI-001, RFI-002, and so on for that job. A voided number is not reused. Status is Open, Answered, Closed, or Void. Field can add one from the job on a phone.
- The assignee answers in the office, on the vendor portal, or on the client portal. A vendor sees only the RFIs assigned to them. A client sees only the RFIs assigned to them. An answer can include a photo. The office closes it after review. No email or text goes out. Portal answers share the same request limit as the other portal forms.
- On the way to an answer or a close, the office can mark a cost impact, a schedule impact in days, or both. Cost impact can draft a change order from the question and link it back. Schedule impact moves the linked schedule item by those days and keeps its length. Create, answer, close, and impact are on the audit log. Field does not see the cost amount. Vendors and clients do not see another party's RFIs or internal notes.
- The job shows a table with number, title, assignee, due date, age in days, status, and impact. Linked items list their RFIs. Today counts RFIs overdue and RFIs awaiting your answer. A schedule item with an open RFI past due shows a small RFI mark. The company list filters by job, assignee, status, and overdue. Each job has a print log and a CSV.

### Draws and progress billing

- A signed job gets a draw schedule from the company defaults in Settings. Each draw is a percent or a fixed amount, optionally tied to a schedule item. The due date is that item’s end plus the company terms, or a date. The rows have to equal the contract, including approved change orders, to the cent. An invoiced draw cannot be edited. When the linked item is done or its date has passed, the draw is Ready to bill. Today counts those draws and the dollars. Billing creates a draft invoice and a pay link. No email goes out.
- An approved change order is its own draw, already invoiced, or it can be rolled into the next open draw. It is not billed twice.
- A job can bill by percent complete instead. The schedule of values is the signed budget plus approved change orders. The office enters a percent or a dollar amount for this period. The columns are scheduled value, previous, this period, total to date, percent, balance, and retainage. A line cannot go past 100%. Each application freezes the previous column. Voiding the latest one restores it. Retainage defaults to 0, is set per job, and is released after closeout.
- The client portal lists the draws and the pay application lines. It does not show cost or margin. The number strip adds Retained when retainage is held. The job summary shows billed to date, percent billed, percent complete, and an underbilled or overbilled amount. The jobs list has a Billed column. A pay application has a print page with those columns. The QuickBooks invoice CSV includes the draft draw and progress invoices.

### Bid requests

- The office can ask two or more subs to price the same scope on a job. Lines come from the job budget, with a quantity and a unit. The vendor portal shows the request. No email or text goes out.
- A vendor enters a unit price or marks a line no bid, types a name, and can attach a photo. They can change it until the due date or until the office awards the work. After that the request is read-only. They can decline the whole request. They do not see another vendor's price, the budget, or the client price.
- The comparison is a table: lines down, vendors across, the low price marked, and a variance against the budget. Award one vendor or split lines. Award writes a draft purchase order for each winner and can update those budget lines. The others are marked lost. Changing the lines after a price comes in asks the vendors to bid again. Today counts bids due in the next three days and bids waiting on an award. A company set to block cannot award a vendor whose required certificate is expired or missing.

### Sub and vendor portal

- A sub or vendor has one portal link. The office creates it from the vendor record, and a new link replaces the old one. The secret is stored as a hash. The link is shown to copy. No email or text goes out.
- The portal lists that vendor's issued purchase orders, schedule days, punch items, and bills. Draft and void orders stay off it. Accept takes a typed name. Decline takes a reason. Both are on the audit log. A bill from the portal is always a draft, with the same duplicate bill number check and the same over-order warning. Today counts those drafts until the office reviews them.
- Certificates are general liability, workers comp, license, W-9, or other, each with an expiration date and a file. The vendor or the office can replace one. The vendor list shows Current, Expires in N days, Expired, or Missing. Settings can warn or block a new purchase order when a required certificate is expired or missing. Warn is the default. Today counts vendors with a certificate expiring within 30 days or already expired.

### Punch list and warranty

- A job has a punch list. Each item has a title, a room, an optional cost code, a crew member or a vendor, a due date, and a status of open, done, or verified. Before and after photos use the same rules as job photos. The office can verify an item and share it with the homeowner. The job page shows open, done, and verified counts.
- Field can add an item and mark one done with a photo from My day. That stays online. The office marks a job substantially complete, then sees a closeout count for punch still open, a missing or draft final invoice, draft change orders, draft bills, issued purchase orders, and unapproved time. Close is allowed when those counts are zero, or with a reason that is stored on the audit log. Closing sets the warranty end from the company default, and that default is editable per job. Reopen is on the audit log too.
- A closed job inside the warranty window accepts a request on the client portal: title, description, urgency, and up to three photos. The homeowner sees status and the end date. Outside the window the form is hidden and the end date stays. The office assigns a visit, which shows on the crew schedule, then resolves or declines with a note the client can read. An optional cost code posts job cost. Today counts open warranty requests. No email or text goes out. A visit note is there to copy.

### Lead form

- Settings has a lead form for an owner or admin. Turn it on, choose the fields, and set a short intro and thank-you line. Name is required, plus an email or a phone. Address, project type, budget, timeline, description, and up to three photos are optional. The page shows the public link and an embed snippet. A new link replaces the old one.
- The public page uses the company name. A request creates a contact and a lead in the first stage, source Website form. An email or phone that already belongs to a contact in that company reuses the contact. The description is read for project type, size, and value hints. Photos follow the same rules as job photos. Today counts new web leads until someone opens them. The lead shows the answers. The pipeline can filter by source.
- A hidden field, a short wait, and per-address and per-company limits sit on the form. A form that is off says it is not taking requests. One company's link cannot write into another company. No email or text goes out.

### Selections

- A job can hold selections, each with two or more choices and an optional allowance from the signed budget. Release puts it on the client portal. The homeowner picks one and types their name. The office can approve on their behalf, reset it, or lock it.
- The chosen cost posts to that allowance’s cost code. An overage can become a draft change order. A credit is shown and left alone. An unlinked choice becomes a draft change order only when the office asks for one. The contract does not move until a change order is approved.
- Field sees the name and the chosen item. The client sees prices, not cost. Another company gets a 404. Release, choose, approve, reset, and lock are on the audit log.

### Import

- An owner or admin can import contacts, subs and vendors, or price book items from a CSV or a pasted spreadsheet. Templates are on the import screen. Common headers map themselves, including a QuickBooks customer export and a contacts export with address columns. Each column can be remapped before anything is saved.
- The review step counts new, update, duplicate, and error rows. A bad email, a missing name, a negative amount, an amount over $10,000,000, or an unknown unit stays on the row. A match on email, phone, or name can be skipped or used to update. A price row with cost and margin fills in the other side. An unknown cost code is created under General, or mapped to one that already exists.
- The import is one batch. Undo removes rows that import created and puts back fields it changed. A row already used on an estimate or a job is left in place. Field and portal logins do not get the screen. A new company sees a four-step list until the first proposal is sent.

### Schedule

- Schedule is a week grid of crew against days. An empty cell adds an item. A chip opens the same sheet to edit the job, the title, the days, and who is on it. Drag a chip, or move it with the arrow keys and save with Command-Return. Week and two weeks share the company calendar.
- A person on two different jobs the same day shows a conflict on the chip and in the count. The item still saves. The job page lists that job’s items and adds from the same sheet. My day shows today and tomorrow for the signed-in person. Field can look, not edit.
- Settings can create a calendar link for the signed-in person. The link is a secret stored as a hash. A new link replaces the old one. The feed is a read-only calendar of that person’s items.

### Client portal polish

- The homeowner portal opens with the company, the job, and the address, then Contract, Paid, and Balance. Contract is the signed proposal plus approved change orders. A Needs you row appears only for a change order waiting on approval, or an open invoice, with one Approve or Pay button.
- Progress lists only the dates that exist: signed, deposit paid, first shared log, a later shared log, and a final invoice. Change orders show a signed amount and a sentence-case status. Shared logs show the date, notes, next step, and photos. A photo opens in a lightbox that closes with Escape. Messages stay at the bottom, and a photo can be attached.
- The proposal page leads with the company, the title, who it is for, the price, the deposit, and the scope. Optional lines and allowances stay labeled. Sign and decline behave as before. The pay page uses the same header.

### Mac time review

- On a laptop, Time is a week grid. The office steps through the company workweek, switches day, week, or pay period, and approves every submitted punch from one button. Hours over 40 show in amber. Labor cost is the approved snapshot only. Field logins do not see rates or cost.
- Someone on site shows with the job, the clock-in, and a running duration. The office can clock them out with a reason. A selected person opens their entries. Check the ones to approve, or edit the times and save them approved in one step. Approved time stays locked. Command-Z reopens the last approval.
- The phone clock is unchanged.

### Mac estimate builder

- On a laptop, an estimate opens as a dense grid beside a live client preview. Tab, Enter, and Esc move through cells. Command-Enter or Control-Enter adds a line. Backspace on an empty row removes it, and Undo puts it back. Groups collapse, and lines move by drag or option-arrow. The totals bar shows cost, price, and margin. A target margin reprices the job, or one group, after a preview. Optional lines and allowances show on the preview and the proposal. Optional and excluded lines stay out of the total. The phone keeps the simple line list.

## 2026-10-05

### iOS shell

- The phone shell uses a Deep Teal accent, the iOS grouped background, and the SF system font. Light and dark follow the system color scheme. A blurred tab bar sits on Today, Jobs, Leads, Time, and More. Field logins get My day, Jobs, Time, and More, and still open the pipeline from More. The large title collapses to an inline title while the page scrolls. Touch targets are at least 44 points, presses scale unless motion is reduced, and the layout uses the safe area.
- Today and the jobs list use grouped inset rows and status pills. Desktop keeps the sidebar.

### Purchase orders

- An owner, admin, or office user can write a purchase order for a sub or vendor on a job. The number is assigned automatically and stays unique in the company, including after a void. A draft does not commit cost. Issuing it does. Closing it releases whatever has not been billed. Voiding it needs a reason. Revising an issued order keeps the previous lines in the history. Nothing is emailed.
- A bill can be linked to an issued or closed order. An approved or paid bill reduces that order’s open commitment on the same cost code, and the remainder never goes below zero. A bill that runs past the order is saved anyway, with a warning.
- Each cost code on the job shows budget, open commitment, actual, projected, cost to complete, and variance. Projected is the greater of the budget and actual plus open commitment. The 80% watch and the overrun change-order draft use actual plus open commitment, so a promise with no bill still counts, and a code that is only 80% spent still warns. A change order that already covers the overrun does not suggest a second draft.
- Vendor totals include the issued purchase-order amount and what is still open. Today lists issued orders with no bill after 30 days on the company clock.
- Field logins and the client portal do not see purchase orders or amounts. Another company gets a clean miss.

### Sub and vendor bills

- An owner, admin, or office user can enter a sub or vendor bill on a job: bill number, dates, and one or more cost-code lines. A text file can be read with the same local receipt reader. A low-confidence read stays a draft until someone confirms it. Nothing is approved by the reader.
- Approving a bill posts each line to that job’s cost once. Unapproving or voiding (with a reason) takes those costs back off and writes a history row. Marking a bill paid records the date, method, and reference only. No payment is sent.
- The same 80% budget warning and overrun change-order draft use those posted costs. The same vendor and bill number in one company is flagged before save. Due and overdue follow the company time zone. Today lists bills due within seven days and bills that are overdue.
- Field logins do not see bills or amounts. The client portal does not either. Another company gets a clean miss. A phone punch id is matched only for that person and company, so a reused id cannot reveal or block someone else’s punch.

### Offline time clock

- A crew member who opened My day or Time while online can clock in, start or end a break, switch job and cost code, and clock out with no signal. Each punch is written to IndexedDB at the moment of the tap, with a client id and the phone's clock. The screen says it is saved on the phone and will sync. A dropped punch is not silent.
- When the phone can reach Fieldline again, the oldest punches go up in a batch. The server keeps the capture time as the punch time and stores a separate sync time. Sending the same batch twice does not create a second punch. A phone clock more than two minutes off, a future time, or a punch older than seven days is kept and listed under Time anomalies for the office. So is a clock-out with no open punch, an overlapping clock-in, a punch inside approved time, or a job or cost code that was removed before sync.
- If the session expired or the person can no longer clock in, the phone keeps the queue and asks them to sign in again. It will not sync those punches under a different person or company. Signing out warns when punches are still only on the phone, then clears that person's queue.
- Daily log notes autosave on the phone while offline and post as a draft later. Photos, manual time, approvals, and office edits stay online. The offline banner says which of those work. The cached clock page has no names, rates, or another company's data. The service worker still does not cache API responses or office pages.

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
