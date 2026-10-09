# Fieldline

The job file for remodelers. From the first call to the last draw.

Fieldline is a CRM-first workspace for U.S. small and mid-size contractors: remodelers, specialty trades, and light general contractors. The demo company is **Rivera Remodeling & Trade** in Oakland. A second company, **Northline Electric**, exists so you can check that one org cannot see the other.

The app runs with no API keys. Stripe, Resend, Twilio, and the Vercel AI Gateway turn on when you add the variables in `.env.example`. Until then, adapters record the same outcomes against seeded data.

On a phone, the office opens on a tab bar: Today, Jobs, Leads, Time, and More. Colors follow the system light or dark setting. A wide window keeps the sidebar.

## Run locally in 3 minutes

```bash
git clone https://origin.cursor.com/git/adam-rouzaqui/fieldline.git
cd fieldline
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3847](http://localhost:3847). The dev server is pinned to port **3847**, not 3000. Sign in as `maya@rivera.demo` / `demo`. The first request creates `data/fieldline.db` and loads Rivera Remodeling. Leave `.env.local` empty. That is a working demo.

## Deploy to Vercel

The demo path deploys with no database service. On Vercel the filesystem is read-only except `/tmp`, so the app writes a seeded SQLite file to `/tmp/fieldline/fieldline.db` the first time a function instance handles a request. Each instance has its own copy. A cold start seeds again. Sign-ins and payments on one instance are not visible on another. That is enough to click through the demo. It is not a shared production database.

### Connect Vercel to Origin

Vercel can deploy this repo from Cursor Origin. Do not mirror it to GitHub for that.

1. Sign in to [vercel.com](https://vercel.com) with the Cursor account that can see `adam-rouzaqui/fieldline`.
2. Add New → Project → Import Git Repository.
3. Choose the **Origin** (Cursor) provider, not GitHub, and select `adam-rouzaqui/fieldline`.
4. Framework preset: **Next.js**. Root directory: the repository root. Build command: `next build` (the default).
5. Environment variables: see the table below. You can deploy with none of them set.
6. Deploy. When the deployment is Ready, open the URL and sign in as `maya@rivera.demo` / `demo`.

The Git source type is `cursor-origin`. If the dashboard does not list Origin, the Vercel account is not linked to that Cursor team. Connect it from the Vercel import screen, or from the Cursor dashboard’s Vercel connection, then retry the import. A CLI deploy from a local clone (`npx vercel`) also works and does not require GitHub.

### Environment variables

Set these in the Vercel project (Production and Preview). Empty means the stub stays on.

| Name | Demo deploy | What to put |
|---|---|---|
| `SESSION_SECRET` | Optional | A long random string. If you leave it empty, Vercel uses a signing key that is in the source, so anyone can forge a session cookie. Set this before you share the URL beyond a demo. |
| `FIELDLINE_DB` | Leave empty | A SQLite file path. On Vercel the app ignores a path under the project and uses `/tmp` unless you set this to another writable path. Do not point it at `./data`. |
| `FIELDLINE_DATA_DIR` | Leave empty | Uploads and the email/SMS outbox. Defaults to `/tmp/fieldline` on Vercel. |
| `DATABASE_URL` | Leave empty | A `postgres://` URL migrates and seeds that database on boot. Empty keeps the SQLite demo. See Durable database. |
| `AI_GATEWAY_API_KEY` | Leave empty | Vercel AI Gateway. Empty uses the local price-book matcher. |
| `AI_ESTIMATE_MODEL` | Optional | Default `anthropic/claude-sonnet-4.5`. |
| `RESEND_API_KEY`, `RESEND_FROM` | Leave empty | Empty appends mail to the outbox file on `/tmp`. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Leave empty | SMS stays off until all three are set. 10DLC is not registered. |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Leave empty | Test keys only (`sk_test_` / `pk_test_` / `whsec_`). Empty keeps the local test-number mirror. Set all three to create a PaymentIntent. Live keys are refused. |
| `CRON_SECRET` | Set this | `GET /api/cron/follow-ups` with `Authorization: Bearer ...`. Required on Vercel. Empty is local dev only. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Leave empty | Or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` instead of the anon key. Empty keeps the demo password. Set both to turn on Supabase Auth. |

`GET /api/health` reports `database: "sqlite-tmp"` on Vercel, `database: "sqlite-file"` locally, and `database: "postgres"` when `DATABASE_URL` is set.

### Durable database

Leave `DATABASE_URL` empty to keep the zero-key SQLite demo. Set it when one shared database has to survive a cold start:

1. Create a Supabase (or any Postgres) project yourself. Do not commit its keys.
2. Copy the direct connection string, or the session pooler on port 5432. The transaction pooler (port 6543) is a poor fit for this server's single connection.
3. Set `DATABASE_URL` on Vercel. On boot the app creates the tables from `drizzle/0000_init.sql` (translated to Postgres) and seeds the demo company if `app_meta.seed_version` is missing.
4. Apply `supabase/rls.sql` in the SQL editor. It matches `users.auth_user_id` to `auth.uid()`. Point `DATABASE_URL` at the database owner or service role so portal, pay, cron, and webhook routes are not blocked. The app still filters `org_id` in every query.
5. Leave the Supabase Auth keys empty to keep signing in with password `demo`. To use Supabase Auth, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Create the seeded emails in that project, then sign in with those passwords. The first success stores `users.auth_user_id` and opens the Fieldline session for that membership. `src/proxy.ts` refreshes the Supabase cookies with `getClaims()`. Set `SESSION_SECRET` before you treat the deploy as private. Keep `SUPABASE_SERVICE_ROLE_KEY` off the browser. It is not a `NEXT_PUBLIC_` variable.

## Run it

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847). The first request creates `data/fieldline.db` and loads the seed. Password for every demo user is `demo`.

To start your own company instead of the demo, open Sign in and choose **Start a new company**. You enter an owner name, email, password, company name, trade, state, time zone, and the day the week starts. The time zone starts as the browser’s zone. Monday is the default week start. That creates an empty office and an owner login. It does not copy Rivera or Northline. Optionally include a starter price book and edit those prices before you send anything. The demo stays available at `maya@rivera.demo` / `demo`. If Supabase Auth is configured, sign-up uses that project. When the project requires email confirmation, the page says so. Fieldline does not send a second email.

To add a teammate, sign in as an owner or admin and open Settings. Enter their email and a role (admin, office, or field). Fieldline does not email them. Copy the invite link, or the short message under it, into a text. The link host is `APP_URL` (local demo uses `http://127.0.0.1:3847` when that is unset). Set `APP_URL` before a production deploy or the invite button will refuse to build a link. A field login sees jobs, photos, daily notes, tasks, and receipt text. Prices, invoices, proposals, and team management stay with the office.

`npm run check` runs lint, the TypeScript check, unit tests, and `next build`. It does not download a browser.

Browser journeys use Playwright against that production build. The first run installs Chromium. Each spec resets a throwaway SQLite file (`e2e/.data`), so the demo database in `data/` is left alone. Stripe, Resend, and the AI gateway stay off for that process.

```bash
npm run build
npx playwright install chromium
npm run e2e
```

| Person | Email | Company | Role |
|---|---|---|---|
| Maya Rivera | maya@rivera.demo | Rivera Remodeling & Trade | Owner |
| Luis Ortega | luis@rivera.demo | Rivera | Estimator |
| Dana Cho | dana@rivera.demo | Rivera | Field (no prices or margins) |
| Sam Patel | sam@rivera.demo | Rivera | Admin |
| Riley Nguyen | riley@rivera.demo | Rivera | Viewer |
| Jordan Hale | jordan@northline.demo | Northline Electric | Owner |

```bash
npm test          # unit tests plus the kitchen-to-payment service flow
npm run e2e       # Playwright against next start: lead to pay, change order, follow-up
npm run smoke     # the service-level kitchen flow only
npm run eval      # print local estimate totals for three scopes
npm run seed -- --reset   # wipe data/fieldline.db and reseed
```

`data/` is gitignored. It holds the SQLite file, uploaded photos, and the outbound email/SMS log (`data/outbox/*.jsonl`).

## What you can click through

1. Sign in as Maya. Today points at the Vasquez gut kitchen.
2. Open the lead, generate an estimate from the scope and the three photos, edit a line, and send the proposal.
3. Open the client link (`/p/...`), sign, and pay the deposit with ACH routing `110000000` and account `000123456789`.
4. On Okonkwo, send a change order and approve it. Contract value, budget, and a change-order invoice update.
5. On Brooks, the job is already under the 20% margin line. On Okonkwo, read the Casa Tile sample, confirm the suggested cost code, and post it. Today lists receipts that are still waiting. Margin moves only after that confirm.
6. Follow-ups has a Briggs nudge waiting. Approving it writes a message. With no Resend key, the body also lands in `data/outbox/email.jsonl`.
7. Bills lists Harbor, Summit, Brighton, and a Casa Tile draft. Brighton’s BE-77 is overdue on Rivera’s clock. Ready to pay is the tab for bills that can be paid now. Approving a bill adds the full amount to the job cost. Marking it paid records the net and sends no money. Dana and the client portal do not see bills. Purchase orders lists Harbor’s PO-1044 and PO-1055 on Okonkwo. PO-1055 holds 10%.
8. Copilot answers receivables, jobs under a margin, pipeline value, and unsigned proposals. The numbers come from the same queries as the screens.

Stable seeded links (after `npm run dev`):

- Proposal already out: [/p/demo_proposal_briggs](http://127.0.0.1:3847/p/demo_proposal_briggs)
- Client portals: [/portal/demo_portal_chen](http://127.0.0.1:3847/portal/demo_portal_chen), [/portal/demo_portal_okonkwo](http://127.0.0.1:3847/portal/demo_portal_okonkwo), [/portal/demo_portal_brooks](http://127.0.0.1:3847/portal/demo_portal_brooks), [/portal/demo_portal_diaz](http://127.0.0.1:3847/portal/demo_portal_diaz)
- Harbor Plumbing vendor portal: [/v/demo_vendor_harbor_m3p8qx7k](http://127.0.0.1:3847/v/demo_vendor_harbor_m3p8qx7k)
- Okonkwo bid comparison: [/bids/bid_ok_valve](http://127.0.0.1:3847/bids/bid_ok_valve)
- Pay links: [/pay/demo_pay_chen_deposit](http://127.0.0.1:3847/pay/demo_pay_chen_deposit), [/pay/demo_pay_okonkwo_progress](http://127.0.0.1:3847/pay/demo_pay_okonkwo_progress), [/pay/demo_pay_brooks_progress](http://127.0.0.1:3847/pay/demo_pay_brooks_progress), [/pay/demo_pay_diaz_final](http://127.0.0.1:3847/pay/demo_pay_diaz_final)

Payment test numbers (local mirror of Stripe test values; nothing is charged):

| Method | Input | Result |
|---|---|---|
| ACH | routing `110000000`, account `000123456789` | Succeeds |
| ACH | account `000111111113` | Closed account |
| ACH | account `000111111116` | No account |
| ACH | account `000222222227` | Insufficient funds, invoice stays open |
| Card | `4242424242424242`, any future date, any CVC | Succeeds |
| Card | `4000000000000002` | Declined |
| Card | `4000000000009995` | Insufficient funds |

ACH fee in the ledger is 0.8% capped at $5. Card is 2.9% + $0.30. A second submit with the same details is ignored. Change the account and it tries again.

### Stripe test mode

Leave the three Stripe variables empty and the pay page stays the local mirror above. `GET /api/health` reports `mode: "demo"`.

To charge a Stripe test PaymentIntent (no live key, no platform fee, no Connect):

1. In the Stripe dashboard, copy a test secret (`sk_test_…`) and a test publishable key (`pk_test_…`).
2. Forward events: `stripe listen --forward-to http://127.0.0.1:3847/api/stripe/webhook`. Put the CLI `whsec_…` in `STRIPE_WEBHOOK_SECRET`.
3. Restart `npm run dev`. Health reports `mode: "stripe"`.
4. Open [/pay/demo_pay_chen_deposit](http://127.0.0.1:3847/pay/demo_pay_chen_deposit). The page creates one PaymentIntent for that invoice and amount. A second load reuses it.
5. Pay with bank account (ACH) first. In test mode Stripe's Financial Connections flow offers **Test Institution**. A card (`4242 4242 4242 4242`) is offered when the company allows cards.
6. ACH can stay processing. The invoice is marked paid only when a verified `payment_intent.succeeded` webhook arrives. Refresh after the CLI prints that event.

`sk_live_` and `pk_live_` are refused. If `STRIPE_SECRET_KEY` is set and Stripe or the publishable key fails, the page shows that error and does not fall back to the local test numbers. Funds land on the Stripe account that owns the key. There is no connected contractor account and no application fee. If that account cannot create `us_bank_account` PaymentIntents, the page shows Stripe's error.

## Keys and accounts

Copy `.env.example` to `.env.local`. Empty values are the supported demo. Put real values only in `.env.local`, Vercel project env, or Cursor secrets. Never commit them.

| Variable | Account | Where it goes | When you need it |
|---|---|---|---|
| `SESSION_SECRET` | You generate it | `.env.local`, Vercel, Cursor secrets | Production. Dev has a fixed fallback. |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway | same | Optional. Empty uses the local price-book matcher. |
| `AI_ESTIMATE_MODEL` | Gateway model id | same | Optional. Default `anthropic/claude-sonnet-4.5`. |
| `RESEND_API_KEY`, `RESEND_FROM` | Resend + a verified domain (SPF/DKIM/DMARC) | same | Optional. Empty writes `data/outbox/email.jsonl`. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Twilio. 10DLC brand and campaign need an EIN, website, and sample messages | same | Optional. SMS is off until all three are set. Do not send at scale. |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe **test mode** (`sk_test_`, `pk_test_`, `whsec_`) | same | Optional. Empty keeps the local test-number mirror. All three turn on a PaymentIntent plus a verified webhook. Live keys are refused. |
| `CRON_SECRET` | You generate it | Vercel cron + `.env.local` | Optional. `GET /api/cron/follow-ups` with `Authorization: Bearer ...`. |
| `DATABASE_URL` | Supabase Postgres connection string (direct or session pooler) | Vercel + Cursor secrets, not git | Leave empty for SQLite. A postgres URL migrates and seeds on boot. See Durable database. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Auth, separate dev and prod projects | Vercel + Cursor secrets, not git | Optional. Empty keeps the demo password. Both turn on email/password sign-in and session refresh. Apply `supabase/rls.sql` on that database. |
| `SUPABASE_SERVICE_ROLE_KEY` | Same project, service role | Server env only. Never `NEXT_PUBLIC_` | Portal, pay, cron, and webhooks stay on `DATABASE_URL` as owner or service role. Do not expose this key to the browser. |
| Product name, domain, legal entity, EIN, business bank | Registrar, state filing, bank | Outside this repo | Before live Stripe, Twilio 10DLC, or a public contract. |
| Attorney review | Construction / SaaS counsel | Contract template, e-sign consent | Before public launch. The in-app consent is a draft, not legal advice. |
| Intuit developer + sandbox company | developer.intuit.com | Later | No OAuth in this MVP. Download `fieldline-qbo-customers.csv`, then `fieldline-qbo-invoices.csv`, and use Settings → Import Data. About 100 invoices and 1,000 rows per file. |
| Figma file | Your team | Design only | Not required to run the demo. |
| Sentry, PostHog | Optional | Vercel | Not wired. |

This repository does not create those accounts and does not spend money.

## Stack

Next.js (App Router) and TypeScript, Tailwind, shadcn/ui. Drizzle talks to SQLite when `DATABASE_URL` is empty, so the demo needs no database server. The same queries run on Postgres when `DATABASE_URL` is a `postgres://` URL: boot applies the migration and seed. Auth is an httpOnly HMAC cookie. When the Supabase URL and anon (or publishable) key are set, sign-in goes through Supabase Auth and the cookie is issued from `users.auth_user_id`. Empty keys keep password `demo`. The AI path uses the Vercel AI SDK `gateway()` helper when a key exists. Email uses Resend when a key exists, otherwise the outbox file. SMS uses the Twilio REST API when credentials exist.

## Tester script

Setup for a person walking the product: run it locally (or on a staging host) with Stripe test mode if you have keys, Resend pointed at a sandbox domain, and SMS off or limited to one verified number. The seed is the demo org **Rivera Remodeling & Trade**:

- 5 users (owner, estimator, field, viewer, admin) plus Jordan at Northline Electric
- a price book of about 80 items (drywall, tile, framing, electrical, plumbing, paint, demo, permits)
- 25 Rivera contacts (clients, 3 subs, 3 vendors) and 12 leads across every stage
- 5 projects: Chen powder (fresh, deposit open), Okonkwo bath (mid-job, two approved change orders), Brooks addition (under the 20% margin alert), Brooks powder room (underbilled on WIP), Diaz deck (complete, final invoice unpaid)
- 10 sample photos in `public/demo/photos` and 3 sample receipts in `public/demo/receipts`
- two scopes already on leads: Vasquez kitchen and Briggs deck stain

Score each scenario pass or fail, with a note and a screenshot.

1. **Kitchen remodel end to end.** Create a lead from pasted text ("Smith, 240 sq ft kitchen, gut, new cabinets, quartz, $60–80k") or open Vasquez. AI extracts contact and scope. Run the estimate with the three photos. Vasquez already has Floor, Walls, Backsplash, and Base. Drywall, paint, tile, and base trim show an fx quantity. Change Walls and those lines and the total move. Base cabinets stay a typed quantity. The price book has Tile shower wall, Interior wall paint, and Base cabinet run. Add assembly on an estimate, pick a measurement, and the group quantity follows it. The proposal shows that group as one line unless the group is set to parts. Edit lines. Margin stays at or above the target markup. Send the proposal. The client page shows quantities, not formulas. Open the client link on a phone. Sign. A project appears with a budget. Pay the deposit by ACH (`110000000` / `000123456789`). Payment and the paid invoice show on the job.
2. **Change order.** On a mid-job project, add "relocate plumbing wall", price it, send it, and approve it. Contract value, budget, and the next invoice update.
3. **Job cost.** On a job, choose the Casa Tile, Harbor, or Summit sample (or paste receipt text). The reader shows vendor, amount, date, lines, and a suggested cost code. Edit if needed, then post. A low-confidence read does not post itself. Margin moves after you confirm. Brooks is already under the 20% line on Today, and Today lists receipts still waiting.
4. **CRM.** Move a deal across stages, log a call, read the timeline, assign a task, and search contacts.
5. **Follow-up.** Briggs was viewed several days ago. Today lists the draft under Follow-ups to approve. Open Follow-ups, edit it, and approve it. Nothing sends before that. A viewed proposal is drafted after 1 day; one that was never opened waits 3 days. Signing, declining, or moving the deal to won or lost clears the draft. A client reply that contains STOP opts that contact out of SMS.
6. **Copilot.** Ask "who owes me money?", "which jobs are under 20% margin?", and "what's my pipeline value?". Compare the answer to Today, Invoices, and the pipeline. They use the same queries.
7. **Mobile / PWA.** Install from the manifest (192 and 512 PNG icons, standalone). The service worker caches icons, the manifest, and one clock page that has no person or company on it. It does not cache office pages or API responses. On a phone, take a job or estimate photo (rear camera; large shots shrink before upload). Receipts stay text. With no signal, clock in, breaks, job switches, clock out, and daily log notes save on the phone and sync later. Photos, approvals, and manual time stay online. Add a cost, and sign a proposal in a narrow viewport.
8. **Permissions and tenancy.** Sign in as Dana (`dana@rivera.demo`). Job money, estimate prices, and price-book unit costs are hidden. Sign in as Jordan (`jordan@northline.demo`) and open `/leads/lead_vasquez` or `/projects` — Rivera records are absent.
9. **Failure paths.** ACH account `000222222227` leaves the invoice open. An expired or unknown proposal token 404s. Paying twice with the same details does not create a second payment. A declined proposal cannot be signed. Signing twice fails. Editing a line after send is refused until you revise a new version.
10. **AI accuracy.** `npm run eval` prints three local drafts. For a real accuracy pass, run 10 of the tester's own past jobs and log percent error on the total. Target is within ±15%, with lines under 70% confidence flagged. The local matcher is not that study. It only prices from Rivera's book.
11. **Time.** Sign in as Dana and open Time. Clock out the open punch, clock in on Okonkwo and a cost code, then clock out. The page shows hours and no dollar amounts. Sign in as Maya, correct the punch, and approve it. Okonkwo's job cost includes that labor. A shift still open after 12 hours shows on Today until the office acts. Payroll CSV is hours only, and only an owner or admin can download it.
12. **Daily log.** Dana’s home is My day: the job, a map link, the clock, and today’s log. Publish a note and a photo. Maya opens the job’s Logs tab and shows it on the client portal. The portal copy has the note and not the hours, delays, or safety note. Ask Copilot what happened on Okonkwo yesterday. Nothing is emailed. Weather is typed, not looked up. Rivera’s days are America/New_York, and the week starts Monday. Change either in Settings. Approved labor does not move.
13. **Bills.** Maya opens Bills. BE-77 is overdue and HP-441 is due soon. Ready to pay shows HP-510 at a net $1,800 and HP-511 with Waiver unsigned. Check HP-510, mark it paid, and request the unconditional waiver for that batch. Open a new bill, upload a text file, review the vendor and lines, save the draft, and approve it. Okonkwo’s cost moves by the full bill. Dana’s Bills link is gone, and Jordan cannot open a Rivera bill.
14. **Purchase orders.** Maya opens Purchase orders. PO-1044 is Harbor’s issued order on Okonkwo, partly billed by HP-441, so plumbing shows committed cost that is not actual yet. PO-1055 is 10% retainage. The order page shows HP-510 and HP-511, $3,000 billed and $2,000 remaining. Lines and Bills are labeled. Comments is one heading and one field. New bill starts from that remainder. Edit, Print, and the more menu stay in the header. After HP-510 is paid, Release retainage writes PO-1055-R for the $200 held. Dana does not see the page.
15. **Selections.** Maya opens Okonkwo and the Selections view. Floor tile is released against an $1,800 allowance, with one choice under, one at, and one over. Vanity is already chosen. Today lists Floor tile once, past due. Add a selection, release it, and approve a choice with a note. Draft the change order for an overage and leave it a draft. Sign in as Dana and confirm the names are there without prices. Open the Okonkwo portal, pick Honed marble, and type a name. The contract stays put.
16. **Lead form.** Maya opens Settings, then Lead form. Rivera is accepting requests. Turn it off, open the public link, and confirm the page is not taking requests. Turn it on, send a name and an email from that page, and come back to Today. New web leads shows a count. Filter Leads by Website form and open the lead. The answers are on the lead. Northline’s form is off.
17. **Punch list and warranty.** Maya opens Okonkwo. The punch strip shows open, done, and verified. Add an item, verify a done one, and mark the job substantial. Close stays blocked while punch, the final invoice, bills, purchase orders, or time are still open, unless a reason is entered. Diaz is already closed with a 12-month warranty and one request, Loose deck board. Assign it, set a visit, and resolve it with a note. Today counts warranty requests until they are resolved or declined. On a phone, Dana marks Caulk the curb done with a photo from My day. Open the Diaz portal and send a warranty request. The end date is on the page. Settings holds the company warranty months.
18. **Sub and vendor portal.** Maya opens Harbor Plumbing (Pete Alvarez). The compliance pill is Missing, general liability expires within 30 days, and workers comp is missing. Today counts that vendor under Vendor certificates. The portal is `/v/demo_vendor_harbor_m3p8qx7k`. It shows PO-1044 waiting to accept, Set the valve on the Okonkwo address, and Replace the escutcheon. Accept with a name, send a bill, and confirm it stays Draft. Today then counts Vendor bills. Upload the missing certificate from the portal or the vendor record. A new portal link on the vendor record replaces the old one. Settings can warn or block the next purchase order. Dana does not see the link or the amounts.
19. **Bid requests.** Maya opens Okonkwo, then Bids. Shower plumbing and glass is out to Harbor Plumbing, Casa Tile, and Brighton Electric, due within three days. Today counts Bids due and Bids to award. The comparison is `/bids/bid_ok_valve`. Harbor is low on plumbing and Casa is low on glass. Brighton has not priced it. Awarding a line writes a draft purchase order. The vendor portal lists the same request for Harbor only, with no other vendor's price. Dana does not see the amounts.
20. **Draws and progress billing.** Okonkwo has five draws that total $46,200. Tile set is linked to Demo, which is done, so Today shows Ready to bill $4,200. Billing it creates a draft invoice. Brooks bills by percent complete with 10% retainage. Pay application 1 is already on the framing work, and $3,440 is retained. The portal shows the draws and the application lines, and Retained when something is held. Dana does not see the amounts.
21. **RFIs.** Okonkwo has three. RFI-001 Valve height is open, assigned to Harbor Plumbing, past due, and linked to Set the valve. Today counts RFIs overdue. Harbor’s portal is `/v/demo_vendor_harbor_m3p8qx7k` and shows only that RFI. RFI-002 Vanity quartz is answered by Amara and linked to the vanity selection. The client portal shows only that one. RFI-003 Niche blocking is closed with a $1,800 cost impact and draft CO 4. The log prints at `/projects/proj_okonkwo/rfis/print` and the CSV is `/api/export/rfis?project=proj_okonkwo`. Dana can add an RFI and does not see the cost amount.
22. **Comments and Inbox.** Okonkwo RFI-001 has a thread from Luis that mentions Maya. Dana left a photo comment on yesterday's Okonkwo daily log, also mentioning Maya. Inbox starts with those two mentions plus the Client walk assignment. Open a row to land on the comment. j and k move, Enter opens. Field does not see comments on bills or estimates. The vendor and client portals do not show the thread. Mention settings are on Inbox: Mentions, or My jobs.
23. **Job from a template.** Templates lists Bathroom remodel and Kitchen remodel. New job, pick Bathroom remodel, leave the parts checked, set a start date and Maya as PM, and map Plumbing to Harbor Plumbing if you want. The job opens with a count of what was created and the subtitle Bathroom remodel v1. On the schedule, extend Demo. The sheet says how many items move before you save. Field does not see template prices. Editing the template afterward leaves this job as it was.
24. **WIP.** Maya opens Reports, then WIP. Today has an Underbilled row that opens the same list, most underbilled first. Brooks powder room is underbilled. Okonkwo and Chen are overbilled. Brooks addition is under the margin line. Set the as-of date and Show. Open Brooks powder room, set a projected cost with a note, and save. CSV and Print use that date. Dana does not see WIP. A selected row is a light teal tint, and the red underbilled amount stays red.
25. **To-dos.** Maya opens To-dos under Work. Today has one Overdue to-dos row. Pre-drywall walk on Okonkwo is tied to Tile shower, one workday before finish, with a checklist. Confirm the tile delivery is a reminder in Inbox. Photograph the Diaz punch is done. Add a to-do, type a checklist, and check the last item. Mark to-do done stays optional. Move Tile shower and the linked date moves with it. Sign in as Dana on a phone and tick Water lines capped. Harbor’s portal lists Blocking in place only. Tick it and attach a photo. Bathroom remodel and Kitchen remodel carry the same Pre-drywall walk.
26. **Saved views.** The filter row on To-dos, RFIs, Bills, and the other lists applies as you change it. Save the current filters as a view, then Pin it. The next visit opens that view. Awaiting answer is shared. My overdue is Maya’s. Click a checklist row, press Enter to keep the new title, or Esc to leave it.
27. **Submittals.** Maya opens Submittals under Work. The list starts with both open rows: Okonkwo SUB-001, the shower valve cut sheet, assigned to Harbor, past due, revision 2, and SUB-002, the tile sample, under review with Maya. The first revision carries the note to move the valve 2 inches. Overdue narrows the list to SUB-001. Today counts both the overdue row and the one waiting on you. Harbor’s portal shows only SUB-001 and can send another. The log prints at `/submittals/print` and the CSV is `/api/export/submittals`. Dana can add one on a job and does not see the office note. A photo or file control is a button.
28. **Lien waivers.** Settings, Lien waivers, holds the four wordings and the pay gate: Off, Warn, or Block. Warn is on. Bills shows HP-220 signed, HP-442 requested, and SL-1904 missing. HP-510 is signed. HP-511 is not, so Ready to pay leaves it out of the total. Check HP-441, pick the waiver type, and request it. Open Harbor’s portal and sign it. Mark HP-441 paid, then request the unconditional waiver. Print is `/waivers/{id}/print`. The CSV is `/api/export/bills` and includes Retained, Net, and Released. Vendors under the list is Billed, Paid, Outstanding, Committed, Open PO, and Retained. Harbor’s portal lists Harbor’s bills with those amounts. Dana and the client portal do not see waivers or bills.
29. **Job files.** Maya opens Okonkwo and Files. Upload is in the toolbar. Plans shows A-101 floor plan, revision 2 current (1.4 MB) and revision 1 superseded (860 KB). Select the current plan and it opens on the right, with revisions, visibility, and delete. Specs and Contracts stay Team. Photos is Client. Harbor Plumbing fits in the folder list. Harbor’s portal is `/v/demo_vendor_harbor_m3p8qx7k` and shows the current plan, not revision 1, plus Harbor’s own upload. The same plan is on the shower bid and on PO-1044. The client portal shows Photos only. Settings, Files, holds the default folders for the next job. Dana can add a photo and does not see Harbor’s folder.

Feedback: file a GitHub issue with steps, expected, actual, screenshot, and device. A useful score is "would I send this proposal today?" from 1 to 5, plus minutes to a quote versus the current process.

## Built, stubbed, and left

**Built and usable on seed data**

- Pipeline, contacts, tasks, notes, and a Today view
- Estimate drafts from scope text, photo captions, and filename words, priced only from the price book, with confidence flags. A photo-only line stays capped and is listed for review. Sending stays a human button.
- Proposals, in-house e-sign (typed or drawn, consent version, IP, user agent, SHA-256 of the public snapshot, PDF certificate)
- Deposit, progress, and final invoices, ACH-first pay page, change orders that update contract and budget
- Live margin and a 20% watch list
- Client portal, follow-up drafts that require approval, copilot v0 with four read-only answers
- QuickBooks Online Import Data CSVs for customers and invoices (one row per invoice line). Not a live Intuit connection.
- Role checks and a second org
- Crew time on a job and cost code. Approved hours post labor cost from the rate snapshot. Field logins never see that rate. No geofence and no payroll provider.
- Daily logs on a job, and a My day screen for field crew. A published log can be shown on the client portal without hours, delays, or safety notes. No weather API and no message when it is shared.
- A company time zone and workweek start. Days, logs, and week totals follow that clock. Approved labor is not rewritten.
- Sub and vendor bills. Approve to post job cost by cost code. Void or unapprove reverses it. Paid is a note, not a payment.
- Purchase orders commit cost before a bill arrives. An approved bill linked to an order reduces what is still open. The job shows budget, committed, actual, projected, cost to complete, and variance. Nothing is sent to the vendor.
- Selections on a job, optionally tied to an allowance. The homeowner chooses on the portal. The chosen cost hits that cost code. Overages become a draft change order when the office asks. Credits stay on the screen.
- A website lead form. An owner or admin turns it on in Settings and copies a link or an embed snippet. A request becomes a lead in the first stage. No message is sent.
- Punch lists on a job, a closeout count before the job is closed, and warranty requests on the client portal through the warranty end date. A visit lands on the crew schedule. No message is sent.
- A vendor portal for issued purchase orders, schedule days, punch items, draft bills, and certificates. The link is a hash. Today counts portal drafts and certificates that are expiring or expired.
- Bid requests on a job. Vendors price the lines on the same portal link. The office compares them and awards draft purchase orders, with an optional budget update. No message is sent.
- A WIP report for owner, admin, and office. One row per open job, an as-of date, a cost-code breakdown, CSV, and a print page. Field does not see it. Selected rows use a light teal tint so red figures stay readable.
- To-dos on a job and across jobs, with checklists, priorities, tags, photos, and assignees among office, field, and vendors. A deadline can follow a schedule item by workdays. Reminders stay in Inbox. Field and vendors tick only their own items. Templates can carry the list.
- Saved views on the list pages. Filters sit in one row and apply as they change. Pin a view to open it next time. Office can share one with the company.

**Stubbed until keys exist**

- AI Gateway: local keyword matcher. A key may choose codes and quantities; prices still come from the book.
- Email and SMS: JSONL outbox. Resend and Twilio send only when their variables are set.
- Stripe without keys: local decisions that copy Stripe's published test numbers. With `sk_test_` / `pk_test_` / `whsec_`, the pay page creates a test PaymentIntent and the webhook marks the invoice paid. No Connect onboarding and no platform fee. Unsigned webhooks are rejected on a public deploy unless `FIELDLINE_ALLOW_DEMO_WEBHOOK=1`.
- E-sign: in-house record, not Dropbox Sign or DocuSign. Consent copy is not attorney-reviewed.
- Auth without Supabase keys: the demo password and the HMAC cookie. With `NEXT_PUBLIC_SUPABASE_URL` and an anon or publishable key, email/password sign-in links `users.auth_user_id` and the same cookie is issued from that membership. `src/proxy.ts` calls `getClaims()` to refresh the Supabase session. Office reads and writes then run as Postgres role `authenticated` with that JWT, so `supabase/rls.sql` applies, including `WITH CHECK`. SQLite still uses the owner file after the membership check, because it cannot `SET ROLE`. Portal, pay, webhooks, cron, and seed stay on the owner connection. The database is SQLite unless `DATABASE_URL` is set, in which case Postgres is migrated and seeded on boot. Locally the file is `data/fieldline.db`. On Vercel, with no `DATABASE_URL`, it is `/tmp/fieldline/fieldline.db`, seeded per cold start. Apply `supabase/rls.sql` yourself on the hosted database. The database role must be allowed to `SET ROLE authenticated`. A service-role key must be `SUPABASE_SERVICE_ROLE_KEY`, never `NEXT_PUBLIC_`.
- File storage: `public/demo` and the writable data directory (`data/` locally, `/tmp/fieldline` on Vercel), not Supabase Storage.

**Left out of this MVP**

- QuickBooks Online OAuth sync (Import Data CSV is the stand-in), lien waivers, plan takeoff, bill pay, and cards as a product
- Twilio 10DLC registration and quiet-hours enforcement beyond storing STOP
- Supabase Storage. Hosted Postgres works when you set `DATABASE_URL`. Supabase Auth turns on with the public URL and anon or publishable key. Office screens then use a non-owner RLS session and still filter `org_id`.
- A live Stripe Connect direct charge (test PaymentIntents bill the account that owns the key)
- Attorney-reviewed home-improvement contracts and state deposit rules
- Sentry, PostHog, and a Figma file for this UI

Supabase and Figma were not used to create a project or a design file. A Vercel project, if one is listed in the latest deploy note, is a preview of this demo only. A shared database needs `DATABASE_URL`. Supabase Auth stays off until you set its URL and anon or publishable key.
