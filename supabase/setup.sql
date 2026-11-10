-- ARC CRM cloud sync — run once in Supabase: SQL Editor → New query → paste → Run.
-- One row per synced record (customer, settings, signature, receipt draft), locked to its owner.

create table if not exists public.arc_records (
  owner      uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  key        text        not null,
  value      jsonb,
  mod        bigint      not null default 0,      -- device edit time (ms); newest edit wins
  deleted    boolean     not null default false,  -- true = deleted on a device
  updated_at timestamptz not null default now(), -- set by the server; used to fetch changes
  primary key (owner, key)
);

create index if not exists arc_records_owner_updated on public.arc_records (owner, updated_at);

-- Server sets updated_at on every write (devices' clocks never matter for fetching)
create or replace function public.arc_records_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists arc_records_touch on public.arc_records;
create trigger arc_records_touch before insert or update on public.arc_records
  for each row execute function public.arc_records_touch();

-- Row Level Security: a signed-in user can only see and change their own rows. Nobody else can.
alter table public.arc_records enable row level security;

drop policy if exists "Owner reads own records" on public.arc_records;
drop policy if exists "Owner adds own records" on public.arc_records;
drop policy if exists "Owner updates own records" on public.arc_records;
drop policy if exists "Owner deletes own records" on public.arc_records;

create policy "Owner reads own records" on public.arc_records
  for select to authenticated using (owner = (select auth.uid()));
create policy "Owner adds own records" on public.arc_records
  for insert to authenticated with check (owner = (select auth.uid()));
create policy "Owner updates own records" on public.arc_records
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "Owner deletes own records" on public.arc_records
  for delete to authenticated using (owner = (select auth.uid()));

revoke all on public.arc_records from anon;
grant select, insert, update, delete on public.arc_records to authenticated;
