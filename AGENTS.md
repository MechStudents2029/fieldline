<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fieldline

Working name for a CRM-first job file for U.S. remodelers and specialty trades.

- Money is integer cents. Markup and tax are basis points. Quantities are milli-units (`qtyMilli`).
- Every tenant query filters `org_id`. `supabase/rls.sql` is the Postgres backstop. Do not treat RLS as a substitute for the filter.
- AI may suggest price-book codes and quantities. It must not write prices, invoices, payments, or contract values. A person confirms those.
- Validate external model output with Zod. Prices always come from `price_book_items`.
- Public proposal and portal pages strip unit cost from the snapshot the client signs.
- Do not commit `.env`, `data/`, or secrets. Document new keys in `.env.example`.
