-- ARC CRM — online signing. Run once in Supabase: SQL Editor → New query → paste all of this → Run. Safe to run again.
-- Needs setup.sql (arc_records) already done.
--
-- How it works
-- - When Orlando emails a proposal / quote / change order (or shows the QR on his phone), the CRM saves a signing
--   request here with a long random token. The email carries a link: .../arccrm/sign.html#<token>
-- - The customer's page has NO login and NO access to this table. It can only call the two functions below,
--   and only with the token: arc_sign_get (read that one document) and arc_sign_submit (sign it once).
-- - The CRM (signed in as Orlando) reads signed requests, puts the signature on the customer record, and marks it applied.
-- - Signed alerts: right after signing, the customer's page saves the signed PDF here (arc_sign_attach). Orlando's Google
--   Apps Script (apps-script/SignedAlerts.gs, runs every minute in his Google account) reads the "outbox" with a secret key,
--   files the PDF in his Google Drive customer folder and emails him at orlando.montanez@agencyroofingco.com.

create table if not exists public.arc_sign (
  token          text        primary key check (length(token) >= 32),
  owner          uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  cid            text        not null,                    -- customer id in the CRM
  kind           text        not null check (kind in ('proposal', 'quote', 'co')),
  item           text        not null default '',         -- quote / change order id ('' for the proposal)
  num            text        not null,                    -- ARC-00015, ARC-00015-Q2, ARC-00015-CO1
  doc_id         text        not null,                    -- fingerprint of scope + price when sent
  info           jsonb       not null,                    -- what the customer sees (document, summary, amount, terms)
  status         text        not null default 'open' check (status in ('open', 'signed', 'void')),
  sig            jsonb,                                   -- customer signature, written only by arc_sign_submit
  signed_at      timestamptz,
  applied        boolean     not null default false,      -- the CRM has put the signature on the customer record
  viewed_at      timestamptz,                             -- first time the customer opened the link
  last_viewed_at timestamptz,
  views          integer     not null default 0,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '45 days',
  updated_at     timestamptz not null default now()
);

alter table public.arc_sign add column if not exists pdf text;                 -- signed copy (base64 PDF) made on the customer's phone
alter table public.arc_sign add column if not exists notified_at timestamptz;  -- Orlando was emailed + Drive copy filed

create index if not exists arc_sign_owner_status on public.arc_sign (owner, status, applied);
create index if not exists arc_sign_owner_item on public.arc_sign (owner, cid, kind, item);

drop trigger if exists arc_sign_touch on public.arc_sign;
create trigger arc_sign_touch before insert or update on public.arc_sign
  for each row execute function public.arc_records_touch();

-- Orlando (signed in) sees and manages only his own requests. The public gets nothing from the table itself.
alter table public.arc_sign enable row level security;

drop policy if exists "Owner reads own sign requests" on public.arc_sign;
drop policy if exists "Owner adds own sign requests" on public.arc_sign;
drop policy if exists "Owner updates own sign requests" on public.arc_sign;
drop policy if exists "Owner deletes own sign requests" on public.arc_sign;

create policy "Owner reads own sign requests" on public.arc_sign
  for select to authenticated using (owner = (select auth.uid()));
create policy "Owner adds own sign requests" on public.arc_sign
  for insert to authenticated with check (owner = (select auth.uid()));
create policy "Owner updates own sign requests" on public.arc_sign
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "Owner deletes own sign requests" on public.arc_sign
  for delete to authenticated using (owner = (select auth.uid()));

revoke all on public.arc_sign from anon;
grant select, insert, update, delete on public.arc_sign to authenticated;


-- ── Customer page: read one document by its token ──
create or replace function public.arc_sign_get(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.arc_sign;
begin
  if p_token is null or length(p_token) < 32 then return jsonb_build_object('status', 'missing'); end if;
  select * into r from public.arc_sign where token = p_token;
  if not found then return jsonb_build_object('status', 'missing'); end if;
  if r.status = 'void' then
    return jsonb_build_object('status', 'void', 'num', r.num, 'info', jsonb_build_object('phone', r.info->'phone', 'first', r.info->'first'));
  end if;
  if r.status = 'open' and r.expires_at < now() then
    return jsonb_build_object('status', 'expired', 'num', r.num, 'info', jsonb_build_object('phone', r.info->'phone', 'first', r.info->'first'));
  end if;
  if r.status = 'open' then
    update public.arc_sign set viewed_at = coalesce(viewed_at, now()), last_viewed_at = now(), views = views + 1 where token = p_token;
  end if;
  return jsonb_build_object(
    'status', r.status, 'num', r.num, 'kind', r.kind, 'info', r.info,
    'signed', case when r.status = 'signed'
      then jsonb_build_object('name', r.sig->>'name', 'at', r.sig->>'at', 'img', r.sig->>'img') end);
end $$;

-- ── Customer page: sign it (once) ──
create or replace function public.arc_sign_submit(p_token text, p_name text, p_img text, p_ack text, p_tz text, p_ua text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.arc_sign;
  nm text := btrim(coalesce(p_name, ''));
  hdr jsonb;
  ip text;
  at text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_token is null or length(p_token) < 32 then return jsonb_build_object('ok', false, 'why', 'missing'); end if;
  select * into r from public.arc_sign where token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'missing'); end if;
  if r.status = 'signed' then return jsonb_build_object('ok', false, 'why', 'signed', 'name', r.sig->>'name', 'at', r.sig->>'at'); end if;
  if r.status = 'void' then return jsonb_build_object('ok', false, 'why', 'void'); end if;
  if r.expires_at < now() then return jsonb_build_object('ok', false, 'why', 'expired'); end if;
  if length(nm) < 2 or length(nm) > 120 then return jsonb_build_object('ok', false, 'why', 'name'); end if;
  if p_img is null or left(p_img, 22) <> 'data:image/png;base64,' or length(p_img) > 400000 or length(p_img) < 200 then
    return jsonb_build_object('ok', false, 'why', 'image');
  end if;
  if nullif(r.info->>'ack', '') is not null and p_ack is distinct from (r.info->>'ack') then
    return jsonb_build_object('ok', false, 'why', 'ack');
  end if;

  begin hdr := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then hdr := null; end;
  ip := btrim(split_part(coalesce(hdr->>'x-forwarded-for', hdr->>'x-real-ip', ''), ',', 1));

  update public.arc_sign set
    status = 'signed',
    signed_at = now(),
    sig = jsonb_build_object(
      'name', nm, 'img', p_img, 'at', at, 'tz', left(coalesce(p_tz, ''), 60), 'consent', true,
      'ackRead', nullif(p_ack, ''), 'method', 'Signed online', 'ip', nullif(ip, ''), 'ua', left(coalesce(p_ua, ''), 300))
  where token = p_token;
  return jsonb_build_object('ok', true, 'name', nm, 'at', at, 'ip', nullif(ip, ''));
end $$;

-- ── Customer page: save the signed PDF it just made (once, within 30 minutes of signing) ──
create or replace function public.arc_sign_attach(p_token text, p_pdf text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.arc_sign;
begin
  if p_token is null or length(p_token) < 32 then return jsonb_build_object('ok', false, 'why', 'missing'); end if;
  select * into r from public.arc_sign where token = p_token for update;
  if not found or r.status <> 'signed' then return jsonb_build_object('ok', false, 'why', 'not-signed'); end if;
  if r.pdf is not null then return jsonb_build_object('ok', false, 'why', 'already'); end if;
  if r.signed_at < now() - interval '30 minutes' then return jsonb_build_object('ok', false, 'why', 'late'); end if;
  if p_pdf is null or left(p_pdf, 5) <> 'JVBER' or length(p_pdf) > 12000000 then return jsonb_build_object('ok', false, 'why', 'bad'); end if;
  update public.arc_sign set pdf = p_pdf where token = p_token;
  return jsonb_build_object('ok', true);
end $$;

-- ── Signed alerts (Apps Script) — locked by a secret key that only Orlando's script knows ──
create table if not exists public.arc_secret (name text primary key, value text not null);
alter table public.arc_secret enable row level security;   -- no policies: nobody reads it through the API
revoke all on public.arc_secret from anon, authenticated;
insert into public.arc_secret (name, value)
  values ('alerts', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  on conflict (name) do nothing;

-- Signed documents not yet emailed. Waits up to 3 minutes for the customer's phone to save the PDF.
create or replace function public.arc_sign_outbox(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_key is null or not exists (select 1 from public.arc_secret where name = 'alerts' and value = p_key) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'token', s.token, 'cid', s.cid, 'kind', s.kind, 'num', s.num, 'signed_at', s.signed_at,
      'name', s.sig->>'name', 'at', s.sig->>'at', 'ip', s.sig->>'ip',
      'info', s.info - 'html' - 'sigTpl', 'pdf', s.pdf) order by s.signed_at)
    from (select * from public.arc_sign
          where status = 'signed' and notified_at is null
            and (pdf is not null or signed_at < now() - interval '3 minutes')
          order by signed_at limit 5) s), '[]'::jsonb);
end $$;

create or replace function public.arc_sign_notified(p_key text, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_key is null or not exists (select 1 from public.arc_secret where name = 'alerts' and value = p_key) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.arc_sign set notified_at = now() where token = p_token and status = 'signed';
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.arc_sign_get(text) from public;
revoke all on function public.arc_sign_attach(text, text) from public;
revoke all on function public.arc_sign_outbox(text) from public;
revoke all on function public.arc_sign_notified(text, text) from public;
grant execute on function public.arc_sign_attach(text, text) to anon, authenticated;
grant execute on function public.arc_sign_outbox(text) to anon, authenticated;
grant execute on function public.arc_sign_notified(text, text) to anon, authenticated;
revoke all on function public.arc_sign_submit(text, text, text, text, text, text) from public;
grant execute on function public.arc_sign_get(text) to anon, authenticated;
grant execute on function public.arc_sign_submit(text, text, text, text, text, text) to anon, authenticated;

-- Your Apps Script key (shows below after Run). Paste it into the script's setup, see apps-script/SignedAlerts.gs.
select value as "ARC_KEY — copy this into Apps Script" from public.arc_secret where name = 'alerts';
