# Changelog

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
