-- 00001_foundation.sql
-- Foundation: tenancy (organizations, members, roles), profiles, org settings
-- (kill switches + automation guardrails), audit log, RLS helper functions.
--
-- Tenant isolation (SEC-001) is enforced HERE, at the database layer. Application
-- code is not trusted to filter tenants. Every tenant table: RLS ENABLED + FORCED.
--
-- Rollback note: additive-only; safe to apply to a fresh or existing database.

-- ---------------------------------------------------------------------------
-- Schema for trusted helper functions (not exposed through the API)
-- ---------------------------------------------------------------------------
create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('owner', 'admin', 'agent', 'assistant');
create type public.actor_type as enum ('human', 'system', 'ai');

-- ---------------------------------------------------------------------------
-- Organizations (tenants)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 200),
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);
alter table public.organizations enable row level security;
alter table public.organizations force row level security;

-- ---------------------------------------------------------------------------
-- Org membership + roles
-- ---------------------------------------------------------------------------
create table public.org_members (
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.org_role not null default 'agent',
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on public.org_members (user_id);
alter table public.org_members enable row level security;
alter table public.org_members force row level security;

-- ---------------------------------------------------------------------------
-- RLS helper functions.
-- SECURITY DEFINER so they can read org_members without recursive RLS.
-- Locked search_path per hardening guidance.
-- ---------------------------------------------------------------------------
create or replace function app.is_org_member(p_org_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = auth.uid()
  );
$$;

-- Role hierarchy: owner > admin > agent > assistant.
-- has_org_role(org, 'admin') is true for admins AND owners.
create or replace function app.role_rank(p_role public.org_role)
returns int
language sql immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then 4
    when 'admin' then 3
    when 'agent' then 2
    when 'assistant' then 1
  end;
$$;

create or replace function app.has_org_role(p_org_id uuid, p_min_role public.org_role)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and app.role_rank(m.role) >= app.role_rank(p_min_role)
  );
$$;

-- True when the target user shares at least one org with the caller.
create or replace function app.shares_org_with(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.org_members mine
    join public.org_members theirs on theirs.org_id = mine.org_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user_id
  );
$$;

grant execute on function app.is_org_member(uuid),
                          app.role_rank(public.org_role),
                          app.has_org_role(uuid, public.org_role),
                          app.shares_org_with(uuid)
  to anon, authenticated, service_role;

-- Generic trigger helpers
create or replace function app.set_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app.prevent_org_change()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'org_id is immutable (tenant reassignment is not allowed)';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organization policies
-- ---------------------------------------------------------------------------
create policy "members can view their orgs"
  on public.organizations for select
  using (app.is_org_member(id));

create policy "authenticated users can create orgs"
  on public.organizations for insert
  with check (auth.uid() is not null and created_by = auth.uid());

create policy "admins can update org"
  on public.organizations for update
  using (app.has_org_role(id, 'admin'))
  with check (app.has_org_role(id, 'admin'));

create policy "owners can delete org"
  on public.organizations for delete
  using (app.has_org_role(id, 'owner'));

-- Bootstrap: org creator becomes owner; settings row is created.
-- SECURITY DEFINER (owned by postgres, which bypasses RLS) because the creator
-- is not yet a member when the row is inserted.
create or replace function app.handle_new_organization()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.org_members (org_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  insert into public.org_settings (org_id) values (new.id);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Org member policies
-- ---------------------------------------------------------------------------
create policy "members can view membership of their orgs"
  on public.org_members for select
  using (app.is_org_member(org_id));

create policy "admins manage members"
  on public.org_members for insert
  with check (
    app.has_org_role(org_id, 'admin')
    -- only owners may grant the owner role
    and (role <> 'owner' or app.has_org_role(org_id, 'owner'))
  );

create policy "admins update members"
  on public.org_members for update
  using (app.has_org_role(org_id, 'admin'))
  with check (
    app.has_org_role(org_id, 'admin')
    and (role <> 'owner' or app.has_org_role(org_id, 'owner'))
  );

create policy "admins remove members"
  on public.org_members for delete
  using (app.has_org_role(org_id, 'admin'));
-- Known limitation (tracked): nothing yet prevents removing the last owner.

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create policy "own profile or shared-org profiles are visible"
  on public.profiles for select
  using (id = auth.uid() or app.shares_org_with(id));

create policy "users update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

-- Auto-create a profile when an auth user is created (Supabase pattern).
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Org settings: kill switches (OPS-001) + automation guardrails (AUTO-001).
-- Emergency controls changeable at runtime by owner/admin — no deploy needed.
-- ---------------------------------------------------------------------------
create table public.org_settings (
  org_id                uuid primary key references public.organizations (id) on delete cascade,
  ai_enabled            boolean not null default true,
  automations_enabled   boolean not null default true,
  email_enabled         boolean not null default true,
  sms_enabled           boolean not null default true,
  voice_enabled         boolean not null default true,
  -- per-integration / per-workflow / per-AI-agent overrides: {"key": false} disables
  integration_overrides jsonb not null default '{}'::jsonb,
  workflow_overrides    jsonb not null default '{}'::jsonb,
  agent_overrides       jsonb not null default '{}'::jsonb,
  automation_limits     jsonb not null default jsonb_build_object(
                          'max_depth', 5,
                          'max_actions_per_run', 25,
                          'max_retries', 3,
                          'dedup_window_seconds', 300,
                          'execution_timeout_seconds', 120
                        ),
  updated_at            timestamptz not null default now()
);
alter table public.org_settings enable row level security;
alter table public.org_settings force row level security;

create policy "members read settings"
  on public.org_settings for select
  using (app.is_org_member(org_id));

create policy "admins update settings"
  on public.org_settings for update
  using (app.has_org_role(org_id, 'admin'))
  with check (app.has_org_role(org_id, 'admin'));
-- No insert/delete policies: rows are managed by the org-creation trigger.

create trigger org_settings_updated_at
  before update on public.org_settings
  for each row execute function app.set_updated_at();

-- Trusted kill-switch check used by every execution path (comms, AI, automations).
create or replace function app.channel_enabled(p_org_id uuid, p_channel text, p_key text default null)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  s public.org_settings%rowtype;
  base_enabled boolean;
  override jsonb;
begin
  select * into s from public.org_settings where org_id = p_org_id;
  if not found then
    return false; -- fail closed
  end if;
  base_enabled := case p_channel
    when 'ai'          then s.ai_enabled
    when 'automations' then s.automations_enabled
    when 'email'       then s.email_enabled
    when 'sms'         then s.sms_enabled
    when 'voice'       then s.voice_enabled
    else false -- unknown channel: fail closed
  end;
  if not base_enabled then
    return false;
  end if;
  if p_key is not null then
    override := case p_channel
      when 'ai'          then s.agent_overrides
      when 'automations' then s.workflow_overrides
      else s.integration_overrides
    end;
    if override ? p_key and (override ->> p_key)::boolean = false then
      return false;
    end if;
  end if;
  return true;
end;
$$;

grant execute on function app.channel_enabled(uuid, text, text) to authenticated, service_role;

-- Now that org_settings exists, attach the org bootstrap trigger.
create trigger on_organization_created
  after insert on public.organizations
  for each row execute function app.handle_new_organization();

-- Org creation RPC. A bare `insert ... returning` fails under RLS because the
-- SELECT policy (org membership) is checked on the RETURNING row before the
-- AFTER trigger has made the creator a member — so creation goes through this
-- trusted function instead (found by db/tests/01_isolation_test.sql).
create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 200 then
    raise exception 'organization name must be 1-200 characters';
  end if;
  insert into public.organizations (name, created_by)
  values (trim(p_name), auth.uid())
  returning id into v_org_id;
  return v_org_id;
end;
$$;

grant execute on function public.create_organization(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit log (OPS-002): append-only, tenant-scoped.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references public.organizations (id) on delete cascade,
  actor_type    public.actor_type not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  action        text not null,
  entity_type   text,
  entity_id     text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index audit_log_org_created_idx on public.audit_log (org_id, created_at desc);
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

create policy "members read audit log"
  on public.audit_log for select
  using (app.is_org_member(org_id));

create policy "members append audit entries as themselves"
  on public.audit_log for insert
  with check (
    app.is_org_member(org_id)
    and (actor_type <> 'human' or actor_user_id = auth.uid())
  );
-- Deliberately NO update/delete policies: the audit log is append-only for
-- every API role including admins.
