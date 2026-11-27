-- ARC CRM — Six-month thank-you email (Good Neighbors referral program).
-- Run once in Supabase: SQL Editor → New query → paste → Run. Needs supabase/sign.sql run first (it makes the ARC_KEY).
-- The Apps Script "ARC Six-Month Thanks" (apps-script/SixMonthThanks.gs) asks for who is due and records each send here,
-- so every Closed job gets the email once. Nothing on the phone changes; the CRM's records are only read.

create table if not exists public.arc_thanks (
  owner    uuid        not null references auth.users(id) on delete cascade,
  cid      text        not null,                  -- customer id (the CRM's c.id)
  email    text        not null default '',       -- where it went
  status   text        not null default 'sent',   -- sent | failed
  note     text        not null default '',       -- error text when it failed
  sent_at  timestamptz not null default now(),
  primary key (owner, cid)
);

alter table public.arc_thanks enable row level security;
drop policy if exists "Owner reads own thanks" on public.arc_thanks;
create policy "Owner reads own thanks" on public.arc_thanks
  for select to authenticated using (owner = (select auth.uid()));
revoke all on public.arc_thanks from anon;
grant select on public.arc_thanks to authenticated;

-- Closed jobs whose close date is 6+ months ago (Albuquerque date), with an email, not switched off, not sent yet.
-- Close date = closedAt (set when the job reaches Closed), else completedAt. Jobs with neither are skipped.
create or replace function public.arc_thanks_due(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_key is null or not exists (select 1 from public.arc_secret where name = 'alerts' and value = p_key) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'owner', d.owner, 'cid', d.cid, 'first', d.first, 'last', d.last, 'email', d.email,
      'address', d.address, 'closed_at', d.closed_at) order by d.closed_at)
    from (
      select r.owner,
             r.value->'v3'->>'id' as cid,
             trim(coalesce(r.value->'v3'->>'first', '')) as first,
             trim(coalesce(r.value->'v3'->>'last', '')) as last,
             trim(coalesce(r.value->'v3'->>'email', '')) as email,
             trim(coalesce(r.value->'v3'->>'address', '')) as address,
             coalesce(nullif(r.value->'ext'->>'closedAt', ''), nullif(r.value->'v3'->>'closedAt', ''),
                      nullif(r.value->'ext'->>'completedAt', ''), nullif(r.value->'v3'->>'completedAt', '')) as closed_at,
             coalesce(r.value->'ext'->>'noThanksMail', '') = 'true' as off
      from public.arc_records r
      where r.key like 'c:%' and not r.deleted and r.value ? 'v3'
        and r.value->'v3'->>'stage' = 'Closed'
    ) d
    where d.cid is not null and d.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and not d.off
      and case when d.closed_at ~ '^\d{4}-\d{2}-\d{2}$'
               then (d.closed_at::date + interval '6 months')::date <= (now() at time zone 'America/Denver')::date
               else false end
      and not exists (select 1 from public.arc_thanks t where t.owner = d.owner and t.cid = d.cid)
  ), '[]'::jsonb);
end $$;

create or replace function public.arc_thanks_sent(p_key text, p_owner uuid, p_cid text, p_email text, p_status text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_key is null or not exists (select 1 from public.arc_secret where name = 'alerts' and value = p_key) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.arc_thanks (owner, cid, email, status, note)
    values (p_owner, p_cid, coalesce(p_email, ''), case when p_status = 'failed' then 'failed' else 'sent' end, left(coalesce(p_note, ''), 500))
    on conflict (owner, cid) do nothing;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.arc_thanks_due(text) from public;
revoke all on function public.arc_thanks_sent(text, uuid, text, text, text, text) from public;
grant execute on function public.arc_thanks_due(text) to anon, authenticated;
grant execute on function public.arc_thanks_sent(text, uuid, text, text, text, text) to anon, authenticated;
