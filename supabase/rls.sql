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

create or replace function public.can_manage_org(target_org text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    join public.users u on u.id = m.user_id
    where u.auth_user_id = auth.uid()::text
      and m.org_id = target_org
      and m.role in ('owner', 'admin')
  )
$$;

revoke all on function public.can_manage_org(text) from public;
grant execute on function public.can_manage_org(text) to authenticated;

alter table public.organizations enable row level security;
drop policy if exists organizations_member on public.organizations;
drop policy if exists organizations_read on public.organizations;
drop policy if exists organizations_update on public.organizations;
create policy organizations_read on public.organizations
  for select
  to authenticated
  using (id in (select public.current_org_ids()));
-- Time zone and workweek are owner/admin settings. A field member can read the company and cannot change it.
create policy organizations_update on public.organizations
  for update
  to authenticated
  using (id in (select public.current_org_ids()) and public.can_manage_org(id))
  with check (id in (select public.current_org_ids()) and public.can_manage_org(id));

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
    'bill_lines',
    'bill_events',
    'purchase_orders',
    'purchase_order_lines',
    'purchase_order_events',
    'cost_items',
    'documents',
    'message_threads',
    'messages',
    'activities',
    'ai_runs',
    'integration_connections',
    'audit_logs',
    'follow_up_drafts',
    'tester_feedback',
    'team_invites',
    'daily_log_events',
    'daily_log_photos',
    'schedule_items',
    'schedule_assignees',
    'calendar_feeds',
    'import_batches',
    'import_rows'
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

-- Field members stay on the company, but money tables are not visible to that role.
-- Job rows stay readable so field notes, photos, and tasks still work. The app also
-- strips contract dollars before render. Invite acceptance inserts the membership
-- on the owner connection, because the invitee is not a member yet.
create or replace function public.can_see_money(target_org text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    join public.users u on u.id = m.user_id
    where u.auth_user_id = auth.uid()::text
      and m.org_id = target_org
      and m.role is distinct from 'field'
  );
$$;

revoke all on function public.can_see_money(text) from public;
grant execute on function public.can_see_money(text) to authenticated;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'estimates',
    'estimate_sections',
    'line_items',
    'proposals',
    'invoices',
    'invoice_lines',
    'payments',
    'bills',
    'bill_lines',
    'bill_events',
    'purchase_orders',
    'purchase_order_lines',
    'purchase_order_events',
    'budget_lines',
    'cost_items',
    'labor_rates',
    'time_approvals'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_member', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_money', tbl);
    execute format(
      'create policy %I on public.%I for all to authenticated using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id)) with check (org_id in (select public.current_org_ids()) and public.can_see_money(org_id))',
      tbl || '_money',
      tbl
    );
  end loop;
end $$;

alter table public.labor_rates enable row level security;
alter table public.time_approvals enable row level security;

-- Time punches are visible to the worker and to anyone who can see money.
-- Rates and the posted labor amount stay on labor_rates and time_approvals.
create or replace function public.current_user_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.id from public.users u where u.auth_user_id = auth.uid()::text limit 1
$$;

revoke all on function public.current_user_id() from public;
grant execute on function public.current_user_id() to authenticated;

alter table public.time_entries enable row level security;
drop policy if exists time_entries_member on public.time_entries;
drop policy if exists time_entries_scope on public.time_entries;
create policy time_entries_scope on public.time_entries
  for all
  to authenticated
  using (
    org_id in (select public.current_org_ids())
    and (public.can_see_money(org_id) or user_id = public.current_user_id())
  )
  with check (
    org_id in (select public.current_org_ids())
    and (public.can_see_money(org_id) or user_id = public.current_user_id())
  );

alter table public.time_entry_events enable row level security;
drop policy if exists time_entry_events_member on public.time_entry_events;
drop policy if exists time_entry_events_scope on public.time_entry_events;
create policy time_entry_events_scope on public.time_entry_events
  for all
  to authenticated
  using (
    org_id in (select public.current_org_ids())
    and (
      public.can_see_money(org_id)
      or exists (
        select 1 from public.time_entries e
        where e.id = entry_id and e.org_id = time_entry_events.org_id and e.user_id = public.current_user_id()
      )
    )
  )
  with check (
    org_id in (select public.current_org_ids())
    and (
      public.can_see_money(org_id)
      or exists (
        select 1 from public.time_entries e
        where e.id = entry_id and e.org_id = time_entry_events.org_id and e.user_id = public.current_user_id()
      )
    )
  );

-- Daily logs are company records. A field member can write their own while it
-- stays internal. Client visibility is an office change, so a field WITH CHECK
-- fails if visibility is anything other than internal.
-- Offline sync receipts and clock anomalies. A field member sees their own rows.
-- The office (anyone who can see money) sees the company. No rates are stored here.
alter table public.sync_events enable row level security;
drop policy if exists sync_events_scope on public.sync_events;
create policy sync_events_scope on public.sync_events
  for all
  to authenticated
  using (
    org_id in (select public.current_org_ids())
    and (public.can_see_money(org_id) or user_id = public.current_user_id())
  )
  with check (
    org_id in (select public.current_org_ids())
    and (public.can_see_money(org_id) or user_id = public.current_user_id())
  );

alter table public.time_anomalies enable row level security;
drop policy if exists time_anomalies_scope on public.time_anomalies;
create policy time_anomalies_scope on public.time_anomalies
  for all
  to authenticated
  using (
    org_id in (select public.current_org_ids())
    and (public.can_see_money(org_id) or user_id = public.current_user_id())
  )
  with check (
    org_id in (select public.current_org_ids())
    and (public.can_see_money(org_id) or user_id = public.current_user_id())
  );

alter table public.daily_logs enable row level security;
drop policy if exists daily_logs_member on public.daily_logs;
drop policy if exists daily_logs_scope on public.daily_logs;
create policy daily_logs_scope on public.daily_logs
  for all
  to authenticated
  using (org_id in (select public.current_org_ids()))
  with check (
    org_id in (select public.current_org_ids())
    and (
      public.can_see_money(org_id)
      or (author_id = public.current_user_id() and visibility = 'internal')
    )
  );
