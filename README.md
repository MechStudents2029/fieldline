# Fieldline

The job file for remodelers. From the first call to the last draw.

Fieldline is a CRM-first workspace for U.S. small and mid-size contractors: remodelers, specialty trades, and light general contractors. The demo company is **Rivera Remodeling & Trade** in Oakland. A second company, **Northline Electric**, exists so you can check that one org cannot see the other.

The local app runs with no API keys. Postgres row-level security, Stripe Connect, Resend, Twilio, and the Vercel AI Gateway turn on when you add the variables in `.env.example`. Until then, adapters record the same outcomes against seeded data.

## Run it

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847). The first request creates `data/fieldline.db` and loads the seed. Password for every demo user is `demo`.

| Person | Email | Company | Role |
|---|---|---|---|
| Maya Rivera | maya@rivera.demo | Rivera Remodeling & Trade | Owner |
| Luis Ortega | luis@rivera.demo | Rivera | Estimator |
| Dana Cho | dana@rivera.demo | Rivera | Field (no prices or margins) |
| Sam Patel | sam@rivera.demo | Rivera | Admin |
| Riley Nguyen | riley@rivera.demo | Rivera | Viewer |
| Jordan Hale | jordan@northline.demo | Northline Electric | Owner |

```bash
npm test          # unit tests plus the kitchen-to-payment smoke flow
npm run smoke     # the end-to-end service test only
npm run eval      # print local estimate totals for three scopes
npm run seed -- --reset   # wipe data/fieldline.db and reseed
```

`data/` is gitignored. It holds the SQLite file, uploaded photos, and the outbound email/SMS log (`data/outbox/*.jsonl`).

## What you can click through

1. Sign in as Maya. Today points at the Vasquez gut kitchen.
2. Open the lead, generate an estimate from the scope and the three photos, edit a line, and send the proposal.
3. Open the client link (`/p/...`), sign, and pay the deposit with ACH routing `110000000` and account `000123456789`.
4. On Okonkwo, send a change order and approve it. Contract value, budget, and a change-order invoice update.
5. On Brooks, the job is already under the 20% margin line. Post the Casa Tile sample receipt (`public/demo/receipts/casa-tile.svg`) onto Okonkwo or another cost to watch margin move.
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

## Keys and accounts

Copy `.env.example` to `.env.local`. Empty values are the supported demo. Put real values only in `.env.local`, Vercel project env, or Cursor secrets. Never commit them.

| Variable | Account | Where it goes | When you need it |
|---|---|---|---|
| `SESSION_SECRET` | You generate it | `.env.local`, Vercel, Cursor secrets | Production. Dev has a fixed fallback. |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway | same | Optional. Empty uses the local price-book matcher. |
| `AI_ESTIMATE_MODEL` | Gateway model id | same | Optional. Default `anthropic/claude-sonnet-4.5`. |
| `RESEND_API_KEY`, `RESEND_FROM` | Resend + a verified domain (SPF/DKIM/DMARC) | same | Optional. Empty writes `data/outbox/email.jsonl`. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Twilio. 10DLC brand and campaign need an EIN, website, and sample messages | same | Optional. SMS is off until all three are set. Do not send at scale. |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe Connect platform, **test mode only** | same | Optional. Charges stay on the local test-number mirror. The webhook verifies signatures only when the secret is set. |
| `CRON_SECRET` | You generate it | Vercel cron + `.env.local` | Optional. `GET /api/cron/follow-ups` with `Authorization: Bearer ...`. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` | Supabase org, separate dev and prod projects | Vercel + Cursor secrets, not git | Not read by this build. Apply `supabase/rls.sql` when you move the schema to Postgres. |
| Product name, domain, legal entity, EIN, business bank | Registrar, state filing, bank | Outside this repo | Before live Stripe, Twilio 10DLC, or a public contract. |
| Attorney review | Construction / SaaS counsel | Contract template, e-sign consent | Before public launch. The in-app consent is a draft, not legal advice. |
| Intuit developer + sandbox company | developer.intuit.com | Later | QuickBooks sync is out of this MVP. Invoices and contacts export as CSV. |
| Figma file | Your team | Design only | Not required to run the demo. |
| Sentry, PostHog | Optional | Vercel | Not wired. |

This repository does not create those accounts and does not spend money.

## Stack

Next.js (App Router) and TypeScript, Tailwind, shadcn/ui. Drizzle talks to SQLite locally so the demo needs no database server. The schema matches the Postgres shape in `supabase/rls.sql`. Auth is an httpOnly HMAC cookie for the demo; production is intended to be Supabase Auth with the same roles. The AI path uses the Vercel AI SDK `gateway()` helper when a key exists. Email uses Resend when a key exists, otherwise the outbox file. SMS uses the Twilio REST API when credentials exist.

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
3. **Job cost.** Upload `public/demo/receipts/casa-tile.svg` (or the Harbor or Summit samples). The reader pulls vendor and amount. Assign a cost code and post. Margin moves. Brooks is already under the 20% line on Today.
4. **CRM.** Move a deal across stages, log a call, read the timeline, assign a task, and search contacts.
5. **Follow-up.** Briggs was viewed several days ago. A nudge draft is waiting. Edit it, approve it, and confirm it shows on the contact. A client reply that contains STOP opts that contact out of SMS.
6. **Copilot.** Ask "who owes me money?", "which jobs are under 20% margin?", and "what's my pipeline value?". Compare the answer to Today, Invoices, and the pipeline. They use the same queries.
7. **Mobile / PWA.** The manifest is installable. The service worker does not cache pages. Add a photo note on a job, add a cost, and sign a proposal in a narrow viewport.
8. **Permissions and tenancy.** Sign in as Dana (`dana@rivera.demo`). Job money, estimate prices, and price-book unit costs are hidden. Sign in as Jordan (`jordan@northline.demo`) and open `/leads/lead_vasquez` or `/projects` — Rivera records are absent.
9. **Failure paths.** ACH account `000222222227` leaves the invoice open. An expired or unknown proposal token 404s. Paying twice with the same details does not create a second payment. A declined proposal cannot be signed. Signing twice fails. Editing a line after send is refused until you revise a new version.
10. **AI accuracy.** `npm run eval` prints three local drafts. For a real accuracy pass, run 10 of the tester's own past jobs and log percent error on the total. Target is within ±15%, with lines under 70% confidence flagged. The local matcher is not that study. It only prices from Rivera's book.

Feedback: file a GitHub issue with steps, expected, actual, screenshot, and device. A useful score is "would I send this proposal today?" from 1 to 5, plus minutes to a quote versus the current process.

## Built, stubbed, and left

**Built and usable on seed data**

- Pipeline, contacts, tasks, notes, and a Today view
- Estimate drafts from scope text and photo filenames, priced only from the price book, with confidence flags
- Proposals, in-house e-sign (typed or drawn, consent version, IP, user agent, SHA-256 of the public snapshot, PDF certificate)
- Deposit, progress, and final invoices, ACH-first pay page, change orders that update contract and budget
- Live margin and a 20% watch list
- Client portal, follow-up drafts that require approval, copilot v0 with four read-only answers
- CSV export for invoices and contacts
- Role checks and a second org

**Stubbed until keys exist**

- AI Gateway: local keyword matcher. A key may choose codes and quantities; prices still come from the book.
- Email and SMS: JSONL outbox. Resend and Twilio send only when their variables are set.
- Stripe: local decisions that copy Stripe's published test numbers. No Connect onboarding, no real PaymentIntent, no platform fee. Webhook signature checks turn on with `STRIPE_WEBHOOK_SECRET`.
- E-sign: in-house record, not Dropbox Sign or DocuSign. Consent copy is not attorney-reviewed.
- Auth and database: SQLite plus a cookie session. `supabase/rls.sql` is ready to apply; this process does not connect to Supabase.
- File storage: `public/demo` and `data/uploads`, not Supabase Storage.

**Left out of this MVP**

- QuickBooks sync (CSV is the stand-in), lien waivers, plan takeoff, bill pay, and cards as a product
- Twilio 10DLC registration and quiet-hours enforcement beyond storing STOP
- Production Supabase Auth, hosted Postgres, and storage
- A live Stripe Connect direct charge
- Attorney-reviewed home-improvement contracts and state deposit rules
- Sentry, PostHog, and a Figma file for this UI

Figma, Vercel, and Supabase connectors were not used to create projects, deployments, or design files. Doing that would create accounts or spend money. When you want them: a Supabase dev project for `supabase/rls.sql`, a Vercel project for hosting and the AI Gateway key, and a Figma file if you want the screens redrawn there.
