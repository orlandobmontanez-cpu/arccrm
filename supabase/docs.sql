-- ARC CRM — run once in Supabase: SQL Editor → New query → paste all of this → Run. Safe to run again.
-- Adds the sync tables for Job Costing (arc_costs) and Invoices (arc_docs). Needs setup.sql (arc_records) already done.
-- Each row is locked to its owner by Row Level Security, same as arc_records.

-- ── Job costing ──

create table if not exists public.arc_costs (
  owner      uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  key        text        not null,                -- customer id
  value      jsonb,                               -- { list: [expenses] }
  mod        bigint      not null default 0,      -- device edit time (ms); newest edit wins
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),  -- set by the server; used to fetch changes
  primary key (owner, key)
);

create index if not exists arc_costs_owner_updated on public.arc_costs (owner, updated_at);

drop trigger if exists arc_costs_touch on public.arc_costs;
create trigger arc_costs_touch before insert or update on public.arc_costs
  for each row execute function public.arc_records_touch();

alter table public.arc_costs enable row level security;

drop policy if exists "Owner reads own costs" on public.arc_costs;
drop policy if exists "Owner adds own costs" on public.arc_costs;
drop policy if exists "Owner updates own costs" on public.arc_costs;
drop policy if exists "Owner deletes own costs" on public.arc_costs;

create policy "Owner reads own costs" on public.arc_costs
  for select to authenticated using (owner = (select auth.uid()));
create policy "Owner adds own costs" on public.arc_costs
  for insert to authenticated with check (owner = (select auth.uid()));
create policy "Owner updates own costs" on public.arc_costs
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "Owner deletes own costs" on public.arc_costs
  for delete to authenticated using (owner = (select auth.uid()));

revoke all on public.arc_costs from anon;
grant select, insert, update, delete on public.arc_costs to authenticated;


-- ── Invoices (companies, invoices, payments) and future document types ──

create table if not exists public.arc_docs (
  owner      uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  key        text        not null,                -- record key: co:<id> company, inv:<id> invoice, billing-seq
  value      jsonb,                               -- the record
  mod        bigint      not null default 0,      -- device edit time (ms); newest edit wins
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),  -- set by the server; used to fetch changes
  primary key (owner, key)
);

create index if not exists arc_docs_owner_updated on public.arc_docs (owner, updated_at);

drop trigger if exists arc_docs_touch on public.arc_docs;
create trigger arc_docs_touch before insert or update on public.arc_docs
  for each row execute function public.arc_records_touch();

alter table public.arc_docs enable row level security;

drop policy if exists "Owner reads own docs" on public.arc_docs;
drop policy if exists "Owner adds own docs" on public.arc_docs;
drop policy if exists "Owner updates own docs" on public.arc_docs;
drop policy if exists "Owner deletes own docs" on public.arc_docs;

create policy "Owner reads own docs" on public.arc_docs
  for select to authenticated using (owner = (select auth.uid()));
create policy "Owner adds own docs" on public.arc_docs
  for insert to authenticated with check (owner = (select auth.uid()));
create policy "Owner updates own docs" on public.arc_docs
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "Owner deletes own docs" on public.arc_docs
  for delete to authenticated using (owner = (select auth.uid()));

revoke all on public.arc_docs from anon;
grant select, insert, update, delete on public.arc_docs to authenticated;
