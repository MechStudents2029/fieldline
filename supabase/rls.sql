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
    'import_rows',
    'selections',
    'selection_choices',
    'selection_events',
    'lead_forms',
    'lead_form_submissions',
    'lead_form_attempts',
    'punch_items',
    'warranty_requests',
    'warranty_photos',
    'warranty_attempts',
    'vendor_portals',
    'vendor_certificates',
    'vendor_portal_attempts',
    'bid_requests',
    'bid_lines',
    'bid_files',
    'bid_invites',
    'bid_prices',
    'bid_awards',
    'draws',
    'pay_app_lines',
    'rfis',
    'rfi_messages',
    'rfi_files',
    'rfi_attempts'
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
    'time_approvals',
    'bid_prices',
    'bid_awards',
    'draws',
    'pay_app_lines'
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

-- Comments stay inside the company. Money records stay off the field role.
-- Notifications belong to one user.
alter table public.comments enable row level security;
drop policy if exists comments_member on public.comments;
drop policy if exists comments_scope on public.comments;
create policy comments_scope on public.comments
  for all
  to authenticated
  using (
    org_id in (select public.current_org_ids())
    and (
      entity_type not in ('estimate', 'change_order', 'purchase_order', 'bill')
      or public.can_see_money(org_id)
    )
  )
  with check (
    org_id in (select public.current_org_ids())
    and (
      entity_type not in ('estimate', 'change_order', 'purchase_order', 'bill')
      or public.can_see_money(org_id)
    )
  );

alter table public.comment_mentions enable row level security;
drop policy if exists comment_mentions_member on public.comment_mentions;
drop policy if exists comment_mentions_scope on public.comment_mentions;
create policy comment_mentions_scope on public.comment_mentions
  for all
  to authenticated
  using (
    org_id in (select public.current_org_ids())
    and exists (
      select 1 from public.comments c
      where c.id = comment_id
        and c.org_id = comment_mentions.org_id
        and (
          c.entity_type not in ('estimate', 'change_order', 'purchase_order', 'bill')
          or public.can_see_money(c.org_id)
        )
    )
  )
  with check (
    org_id in (select public.current_org_ids())
    and exists (
      select 1 from public.comments c
      where c.id = comment_id
        and c.org_id = comment_mentions.org_id
        and (
          c.entity_type not in ('estimate', 'change_order', 'purchase_order', 'bill')
          or public.can_see_money(c.org_id)
        )
    )
  );

alter table public.comment_files enable row level security;
drop policy if exists comment_files_member on public.comment_files;
drop policy if exists comment_files_scope on public.comment_files;
create policy comment_files_scope on public.comment_files
  for all
  to authenticated
  using (
    org_id in (select public.current_org_ids())
    and exists (
      select 1 from public.comments c
      where c.id = comment_id
        and c.org_id = comment_files.org_id
        and (
          c.entity_type not in ('estimate', 'change_order', 'purchase_order', 'bill')
          or public.can_see_money(c.org_id)
        )
    )
  )
  with check (
    org_id in (select public.current_org_ids())
    and exists (
      select 1 from public.comments c
      where c.id = comment_id
        and c.org_id = comment_files.org_id
        and (
          c.entity_type not in ('estimate', 'change_order', 'purchase_order', 'bill')
          or public.can_see_money(c.org_id)
        )
    )
  );

alter table public.notifications enable row level security;
drop policy if exists notifications_member on public.notifications;
drop policy if exists notifications_scope on public.notifications;
create policy notifications_scope on public.notifications
  for all
  to authenticated
  using (org_id in (select public.current_org_ids()) and user_id = public.current_user_id())
  with check (org_id in (select public.current_org_ids()) and user_id = public.current_user_id());

alter table public.notification_settings enable row level security;
drop policy if exists notification_settings_member on public.notification_settings;
drop policy if exists notification_settings_scope on public.notification_settings;
create policy notification_settings_scope on public.notification_settings
  for all
  to authenticated
  using (org_id in (select public.current_org_ids()) and user_id = public.current_user_id())
  with check (org_id in (select public.current_org_ids()) and user_id = public.current_user_id());

alter table public.comment_attempts enable row level security;
drop policy if exists comment_attempts_member on public.comment_attempts;
drop policy if exists comment_attempts_scope on public.comment_attempts;
create policy comment_attempts_scope on public.comment_attempts
  for all
  to authenticated
  using (org_id in (select public.current_org_ids()) and user_id = public.current_user_id())
  with check (org_id in (select public.current_org_ids()) and user_id = public.current_user_id());

alter table public.schedule_links enable row level security;
drop policy if exists schedule_links_scope on public.schedule_links;
create policy schedule_links_scope on public.schedule_links
  for all to authenticated
  using (org_id in (select public.current_org_ids()))
  with check (org_id in (select public.current_org_ids()));

alter table public.job_templates enable row level security;
drop policy if exists job_templates_scope on public.job_templates;
create policy job_templates_scope on public.job_templates
  for all to authenticated
  using (org_id in (select public.current_org_ids()))
  with check (org_id in (select public.current_org_ids()));

alter table public.template_tasks enable row level security;
drop policy if exists template_tasks_scope on public.template_tasks;
create policy template_tasks_scope on public.template_tasks
  for all to authenticated
  using (org_id in (select public.current_org_ids()))
  with check (org_id in (select public.current_org_ids()));

alter table public.template_task_links enable row level security;
drop policy if exists template_task_links_scope on public.template_task_links;
create policy template_task_links_scope on public.template_task_links
  for all to authenticated
  using (org_id in (select public.current_org_ids()))
  with check (org_id in (select public.current_org_ids()));

alter table public.template_checks enable row level security;
drop policy if exists template_checks_scope on public.template_checks;
create policy template_checks_scope on public.template_checks
  for all to authenticated
  using (org_id in (select public.current_org_ids()))
  with check (org_id in (select public.current_org_ids()));

alter table public.template_lines enable row level security;
drop policy if exists template_lines_scope on public.template_lines;
create policy template_lines_scope on public.template_lines
  for all to authenticated
  using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id))
  with check (org_id in (select public.current_org_ids()) and public.can_see_money(org_id));

alter table public.template_draws enable row level security;
drop policy if exists template_draws_scope on public.template_draws;
create policy template_draws_scope on public.template_draws
  for all to authenticated
  using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id))
  with check (org_id in (select public.current_org_ids()) and public.can_see_money(org_id));

alter table public.template_selections enable row level security;
drop policy if exists template_selections_scope on public.template_selections;
create policy template_selections_scope on public.template_selections
  for all to authenticated
  using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id))
  with check (org_id in (select public.current_org_ids()) and public.can_see_money(org_id));

alter table public.template_attempts enable row level security;
drop policy if exists template_attempts_scope on public.template_attempts;
create policy template_attempts_scope on public.template_attempts
  for all to authenticated
  using (org_id in (select public.current_org_ids()) and user_id = public.current_user_id())
  with check (org_id in (select public.current_org_ids()) and user_id = public.current_user_id());

alter table public.wip_overrides enable row level security;
drop policy if exists wip_overrides_scope on public.wip_overrides;
create policy wip_overrides_scope on public.wip_overrides
  for all to authenticated
  using (org_id in (select public.current_org_ids()) and public.can_see_money(org_id))
  with check (org_id in (select public.current_org_ids()) and public.can_see_money(org_id));

alter table public.wip_attempts enable row level security;
drop policy if exists wip_attempts_scope on public.wip_attempts;
create policy wip_attempts_scope on public.wip_attempts
  for all to authenticated
  using (org_id in (select public.current_org_ids()) and user_id = public.current_user_id())
  with check (org_id in (select public.current_org_ids()) and user_id = public.current_user_id());
