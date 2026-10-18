-- Pocket Money sync box (schema pocket_money). Written once, then left alone.
-- The tables are not reachable from the internet directly. The app only calls the
-- pm_* functions below, and each one checks the device's secret key first.
-- The box stores JSON and never interprets entries, so app changes need no change here.

create schema if not exists pocket_money;
revoke all on schema pocket_money from public, anon, authenticated;

create table pocket_money.families (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- People in a family: parent 1, child 1, later more
create table pocket_money.members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references pocket_money.families(id) on delete cascade,
  role text not null check (role in ('parent', 'kid')),
  name text not null default '',
  created_at timestamptz not null default now()
);

-- Phones. Only a hash of each secret key is stored.
create table pocket_money.devices (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references pocket_money.members(id) on delete cascade,
  token_hash bytea not null unique,
  label text not null default '',
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- One-time pairing codes (valid 7 days)
create table pocket_money.invites (
  code_hash bytea primary key,
  member_id uuid not null references pocket_money.members(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz
);

-- What the kid's app last sent: balances, settings, everything (read-only for the parent)
create table pocket_money.kid_state (
  member_id uuid primary key references pocket_money.members(id) on delete cascade,
  data jsonb not null,
  app_version text,
  updated_at timestamptz not null default now()
);

-- Every entry ever logged, deleted ones too. Approval and note belong to the parent.
create table pocket_money.entries (
  member_id uuid not null references pocket_money.members(id) on delete cascade,
  id text not null,
  data jsonb not null,
  status text not null default 'active',
  approved boolean not null default false,
  parent_note text not null default '',
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (member_id, id)
);

-- What the parent manages for a kid: debts now, rules later
create table pocket_money.parent_doc (
  member_id uuid primary key references pocket_money.members(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create index on pocket_money.members(family_id);
create index on pocket_money.devices(member_id);
create index on pocket_money.invites(member_id);

alter table pocket_money.families enable row level security;
alter table pocket_money.members enable row level security;
alter table pocket_money.devices enable row level security;
alter table pocket_money.invites enable row level security;
alter table pocket_money.kid_state enable row level security;
alter table pocket_money.entries enable row level security;
alter table pocket_money.parent_doc enable row level security;
revoke all on all tables in schema pocket_money from public, anon, authenticated;

-- ---------- helpers (not callable from outside) ----------
create or replace function pocket_money.hash(t text) returns bytea
language sql immutable set search_path = '' as $$ select extensions.digest(t, 'sha256') $$;

create or replace function pocket_money.new_secret(n int) returns text
language sql volatile set search_path = '' as $$ select encode(extensions.gen_random_bytes(n), 'hex') $$;

-- Returns the member behind a device key, or raises
create or replace function pocket_money.me(p_token text)
returns pocket_money.members
language plpgsql security definer set search_path = '' as $$
declare m pocket_money.members; d uuid;
begin
  select dv.id, mb.* into d, m.id, m.family_id, m.role, m.name, m.created_at
  from pocket_money.devices dv join pocket_money.members mb on mb.id = dv.member_id
  where dv.token_hash = pocket_money.hash(coalesce(p_token, ''));
  if d is null then raise exception 'not_paired' using errcode = 'P0001'; end if;
  update pocket_money.devices set last_seen = now() where id = d;
  return m;
end $$;

create or replace function pocket_money.new_device(p_member uuid, p_label text)
returns text language plpgsql security definer set search_path = '' as $$
declare tok text := pocket_money.new_secret(32);
begin
  insert into pocket_money.devices(member_id, token_hash, label) values (p_member, pocket_money.hash(tok), left(coalesce(p_label, ''), 60));
  return tok;
end $$;

create or replace function pocket_money.new_invite(p_member uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare code text := upper(pocket_money.new_secret(6));
begin
  insert into pocket_money.invites(code_hash, member_id) values (pocket_money.hash(code), p_member);
  return code;
end $$;

-- What a kid's app needs back: approvals and the parent's debts
create or replace function pocket_money.kid_reply(p_member uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ok', true,
    'approvals', coalesce((select jsonb_object_agg(id, jsonb_build_object('a', approved, 'n', parent_note))
                           from pocket_money.entries where member_id = p_member and (approved or parent_note <> '')), '{}'::jsonb),
    'parent', (select data from pocket_money.parent_doc where member_id = p_member)
  )
$$;

-- ---------- what the app calls ----------

-- Parent 1 starts a family with child 1. Returns the parent's key and a pairing code for the child.
create or replace function public.pm_create_family(p_parent_name text, p_kid_name text, p_label text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid; p uuid; k uuid; tok text;
begin
  insert into pocket_money.families default values returning id into f;
  insert into pocket_money.members(family_id, role, name) values (f, 'parent', left(coalesce(p_parent_name, ''), 40)) returning id into p;
  insert into pocket_money.members(family_id, role, name) values (f, 'kid', left(coalesce(p_kid_name, ''), 40)) returning id into k;
  tok := pocket_money.new_device(p, p_label);
  return jsonb_build_object('token', tok, 'role', 'parent', 'member', p, 'kid', k, 'code', pocket_money.new_invite(k));
end $$;

-- A phone joins with a pairing code (child's phone, a new phone, or a second parent)
create or replace function public.pm_redeem(p_code text, p_label text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare inv pocket_money.invites; m pocket_money.members;
begin
  select * into inv from pocket_money.invites
   where code_hash = pocket_money.hash(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')))
     and used_at is null and expires_at > now()
   for update;
  if inv.code_hash is null then raise exception 'bad_code' using errcode = 'P0001'; end if;
  update pocket_money.invites set used_at = now() where code_hash = inv.code_hash;
  select * into m from pocket_money.members where id = inv.member_id;
  return jsonb_build_object('token', pocket_money.new_device(m.id, p_label), 'role', m.role, 'member', m.id, 'name', m.name);
end $$;

-- Parent: new pairing code for a family member (default: the first child)
create or replace function public.pm_invite(p_token text, p_member uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me pocket_money.members := pocket_money.me(p_token); target uuid;
begin
  if me.role <> 'parent' then raise exception 'parents_only' using errcode = 'P0001'; end if;
  select id into target from pocket_money.members
   where family_id = me.family_id and (id = p_member or (p_member is null and role = 'kid'))
   order by created_at limit 1;
  if target is null then raise exception 'no_member' using errcode = 'P0001'; end if;
  return jsonb_build_object('code', pocket_money.new_invite(target), 'member', target);
end $$;

-- Kid: send state and all entries (active and deleted), get approvals and debts back
create or replace function public.pm_kid_sync(p_token text, p_state jsonb, p_entries jsonb, p_version text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me pocket_money.members := pocket_money.me(p_token); e jsonb; seen text[] := '{}';
begin
  if me.role <> 'kid' then raise exception 'kids_only' using errcode = 'P0001'; end if;
  if p_state is not null then
    insert into pocket_money.kid_state(member_id, data, app_version) values (me.id, p_state, p_version)
    on conflict (member_id) do update set data = excluded.data, app_version = excluded.app_version, updated_at = now();
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    continue when coalesce(e->>'id', '') = '';
    seen := seen || (e->>'id');
    insert into pocket_money.entries(member_id, id, data, status)
    values (me.id, e->>'id', e, coalesce(e->>'_status', 'active'))
    on conflict (member_id, id) do update set data = excluded.data, status = excluded.status, updated_at = now()
      where pocket_money.entries.data is distinct from excluded.data or pocket_money.entries.status is distinct from excluded.status;
  end loop;
  -- entries the app no longer has (e.g. "Start over") stay, marked as removed
  if p_entries is not null then
    update pocket_money.entries set status = 'removed', updated_at = now()
     where member_id = me.id and status = 'active' and not (id = any(seen));
  end if;
  -- first sync: the parent's debt list starts with the debts the app already has
  if p_state ? 'debts' then
    insert into pocket_money.parent_doc(member_id, data)
    values (me.id, jsonb_build_object('debts', (select coalesce(jsonb_agg(jsonb_build_object('id', d->>'id', 'name', d->>'name', 'total', d->'total', 'monthly', d->'monthly')), '[]'::jsonb)
                                                from jsonb_array_elements(p_state->'debts') d)))
    on conflict (member_id) do nothing;
  end if;
  return pocket_money.kid_reply(me.id);
end $$;

-- Parent: everything about the family's kids
create or replace function public.pm_parent_pull(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me pocket_money.members := pocket_money.me(p_token);
begin
  if me.role <> 'parent' then raise exception 'parents_only' using errcode = 'P0001'; end if;
  return jsonb_build_object('ok', true, 'me', jsonb_build_object('id', me.id, 'name', me.name), 'kids', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name,
      'state', ks.data, 'version', ks.app_version, 'updated', ks.updated_at,
      'lastSeen', (select max(last_seen) from pocket_money.devices where member_id = m.id),
      'parent', pd.data,
      'entries', coalesce((select jsonb_agg(jsonb_build_object('data', en.data, 'status', en.status, 'a', en.approved, 'n', en.parent_note) order by en.created_at)
                           from pocket_money.entries en where en.member_id = m.id), '[]'::jsonb)
    ) order by m.created_at)
    from pocket_money.members m
    left join pocket_money.kid_state ks on ks.member_id = m.id
    left join pocket_money.parent_doc pd on pd.member_id = m.id
    where m.family_id = me.family_id and m.role = 'kid'), '[]'::jsonb));
end $$;

-- Parent: approve and/or write a note
create or replace function public.pm_decide(p_token text, p_member uuid, p_entry text, p_approved boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me pocket_money.members := pocket_money.me(p_token);
begin
  if me.role <> 'parent' then raise exception 'parents_only' using errcode = 'P0001'; end if;
  update pocket_money.entries en set approved = coalesce(p_approved, false), parent_note = left(coalesce(p_note, ''), 300), decided_at = now()
    from pocket_money.members m
   where en.member_id = p_member and en.id = p_entry and m.id = en.member_id and m.family_id = me.family_id;
  if not found then raise exception 'no_entry' using errcode = 'P0001'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Parent: save debts (and later other rules) for a kid
create or replace function public.pm_set_parent_doc(p_token text, p_member uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me pocket_money.members := pocket_money.me(p_token);
begin
  if me.role <> 'parent' then raise exception 'parents_only' using errcode = 'P0001'; end if;
  if not exists (select 1 from pocket_money.members where id = p_member and family_id = me.family_id and role = 'kid') then
    raise exception 'no_member' using errcode = 'P0001';
  end if;
  insert into pocket_money.parent_doc(member_id, data) values (p_member, coalesce(p_data, '{}'::jsonb))
  on conflict (member_id) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Any device: version check
create or replace function public.pm_ping()
returns jsonb language sql stable set search_path = '' as $$ select jsonb_build_object('ok', true, 'box', 1) $$;

-- Only the pm_* functions are reachable from outside
revoke all on all functions in schema pocket_money from public, anon, authenticated;
revoke all on function public.pm_create_family(text, text, text), public.pm_redeem(text, text), public.pm_invite(text, uuid),
  public.pm_kid_sync(text, jsonb, jsonb, text), public.pm_parent_pull(text), public.pm_decide(text, uuid, text, boolean, text),
  public.pm_set_parent_doc(text, uuid, jsonb), public.pm_ping() from public;
grant execute on function public.pm_create_family(text, text, text), public.pm_redeem(text, text), public.pm_invite(text, uuid),
  public.pm_kid_sync(text, jsonb, jsonb, text), public.pm_parent_pull(text), public.pm_decide(text, uuid, text, boolean, text),
  public.pm_set_parent_doc(text, uuid, jsonb), public.pm_ping() to anon, authenticated;
