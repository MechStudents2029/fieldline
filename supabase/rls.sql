-- Fieldline production tenancy backstop for Supabase Postgres.
-- The running app uses SQLite and does not execute this file.
-- Apply it yourself on a project you create. Do not store the service role key in the repo.
--
-- Portal, pay, Stripe webhooks, follow-up cron, seed, and migrations use
-- DATABASE_URL as the database owner or service role, so these policies do not
-- block them. Office reads and writes, after getClaims() verifies the member, run as role
-- `authenticated` with that JWT so auth.uid(), current_org_ids(), and WITH CHECK apply.
-- The browser and the session refresh use the anon or publishable key only.
-- users.auth_user_id stores auth.uid() as text so SQLite and Postgres share one column.
-- App-level org_id checks stay in the query layer even after these policies exist.

alter table public.users add column if not exists auth_user_id text;
create unique index if not exists users_auth_user_id on public.users (auth_user_id);

create or replace function public.current_org_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select m.org_id
  from public.memberships m
  join public.users u on u.id = m.user_id
  where u.auth_user_id = auth.uid()::text
$$;

revoke all on function public.current_org_ids() from public;
grant execute on function public.current_org_ids() to authenticated;

alter table public.organizations enable row level security;
drop policy if exists organizations_member on public.organizations;
create policy organizations_member on public.organizations
  for all
  to authenticated
  using (id in (select public.current_org_ids()))
  with check (id in (select public.current_org_ids()));

alter table public.users enable row level security;
drop policy if exists users_self_or_org on public.users;
create policy users_self_or_org on public.users
  for select
  to authenticated
  using (
    auth_user_id = auth.uid()::text
    or id in (
      select m.user_id
      from public.memberships m
      where m.org_id in (select public.current_org_ids())
    )
  );

alter table public.memberships enable row level security;
drop policy if exists memberships_member on public.memberships;
create policy memberships_member on public.memberships
  for all
  to authenticated
  using (org_id in (select public.current_org_ids()))
  with check (org_id in (select public.current_org_ids()));

-- Tables that carry org_id. app_meta is operational and stays service-role only.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'contacts',
    'consents',
    'pipelines',
    'pipeline_stages',
    'leads',
    'tasks',
    'price_book_items',
    'estimates',
    'estimate_sections',
    'line_items',
    'proposals',
    'signatures',
    'projects',
    'budget_lines',
    'change_orders',
    'change_order_lines',
    'invoices',
    'invoice_lines',
    'payments',
    'bills',
    'cost_items',
    'documents',
    'message_threads',
    'messages',
    'activities',
    'ai_runs',
    'integration_connections',
    'audit_logs',
    'follow_up_drafts',
    'tester_feedback'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_member', tbl);
    execute format(
      'create policy %I on public.%I for all to authenticated using (org_id in (select public.current_org_ids())) with check (org_id in (select public.current_org_ids()))',
      tbl || '_member',
      tbl
    );
  end loop;
end $$;
