# Fieldline

The job file for remodelers. From the first call to the last draw.

Fieldline is a CRM-first workspace for U.S. small and mid-size contractors: remodelers, specialty trades, and light general contractors. The demo company is **Rivera Remodeling & Trade** in Oakland. A second company, **Northline Electric**, exists so you can check that one org cannot see the other.

The app runs with no API keys. Stripe, Resend, Twilio, and the Vercel AI Gateway turn on when you add the variables in `.env.example`. Until then, adapters record the same outcomes against seeded data.

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

To start your own company instead of the demo, open Sign in and choose **Start a new company**. You enter an owner name, email, password, company name, trade, and state. That creates an empty office and an owner login. It does not copy Rivera or Northline. Optionally include a starter price book and edit those prices before you send anything. The demo stays available at `maya@rivera.demo` / `demo`. If Supabase Auth is configured, sign-up uses that project. When the project requires email confirmation, the page says so. Fieldline does not send a second email.

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
7. Copilot answers receivables, jobs under a margin, pipeline value, and unsigned proposals. The numbers come from the same queries as the screens.

Stable seeded links (after `npm run dev`):

- Proposal already out: [/p/demo_proposal_briggs](http://127.0.0.1:3847/p/demo_proposal_briggs)
- Client portals: [/portal/demo_portal_chen](http://127.0.0.1:3847/portal/demo_portal_chen), [/portal/demo_portal_okonkwo](http://127.0.0.1:3847/portal/demo_portal_okonkwo), [/portal/demo_portal_brooks](http://127.0.0.1:3847/portal/demo_portal_brooks), [/portal/demo_portal_diaz](http://127.0.0.1:3847/portal/demo_portal_diaz)
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
- 4 projects: Chen powder (fresh, deposit open), Okonkwo bath (mid-job, two approved change orders), Brooks addition (under the 20% margin alert), Diaz deck (complete, final invoice unpaid)
- 10 sample photos in `public/demo/photos` and 3 sample receipts in `public/demo/receipts`
- two scopes already on leads: Vasquez kitchen and Briggs deck stain

Score each scenario pass or fail, with a note and a screenshot.

1. **Kitchen remodel end to end.** Create a lead from pasted text ("Smith, 240 sq ft kitchen, gut, new cabinets, quartz, $60–80k") or open Vasquez. AI extracts contact and scope. Run the estimate with the three photos. Edit lines. Margin stays at or above the target markup. Send the proposal. Open the client link on a phone. Sign. A project appears with a budget. Pay the deposit by ACH (`110000000` / `000123456789`). Payment and the paid invoice show on the job.
2. **Change order.** On a mid-job project, add "relocate plumbing wall", price it, send it, and approve it. Contract value, budget, and the next invoice update.
3. **Job cost.** On a job, choose the Casa Tile, Harbor, or Summit sample (or paste receipt text). The reader shows vendor, amount, date, lines, and a suggested cost code. Edit if needed, then post. A low-confidence read does not post itself. Margin moves after you confirm. Brooks is already under the 20% line on Today, and Today lists receipts still waiting.
4. **CRM.** Move a deal across stages, log a call, read the timeline, assign a task, and search contacts.
5. **Follow-up.** Briggs was viewed several days ago. Today lists the draft under Follow-ups to approve. Open Follow-ups, edit it, and approve it. Nothing sends before that. A viewed proposal is drafted after 1 day; one that was never opened waits 3 days. Signing, declining, or moving the deal to won or lost clears the draft. A client reply that contains STOP opts that contact out of SMS.
6. **Copilot.** Ask "who owes me money?", "which jobs are under 20% margin?", and "what's my pipeline value?". Compare the answer to Today, Invoices, and the pipeline. They use the same queries.
7. **Mobile / PWA.** Install from the manifest (192 and 512 PNG icons, standalone). The service worker caches icons and the manifest, not pages. On a phone, take a job or estimate photo (rear camera; large shots shrink before upload). Receipts stay text. Going offline shows a banner and does not queue changes. Add a cost, and sign a proposal in a narrow viewport.
8. **Permissions and tenancy.** Sign in as Dana (`dana@rivera.demo`). Job money, estimate prices, and price-book unit costs are hidden. Sign in as Jordan (`jordan@northline.demo`) and open `/leads/lead_vasquez` or `/projects` — Rivera records are absent.
9. **Failure paths.** ACH account `000222222227` leaves the invoice open. An expired or unknown proposal token 404s. Paying twice with the same details does not create a second payment. A declined proposal cannot be signed. Signing twice fails. Editing a line after send is refused until you revise a new version.
10. **AI accuracy.** `npm run eval` prints three local drafts. For a real accuracy pass, run 10 of the tester's own past jobs and log percent error on the total. Target is within ±15%, with lines under 70% confidence flagged. The local matcher is not that study. It only prices from Rivera's book.

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
