-- 00002_crm_core.sql
-- CRM core: contacts (CRM-001), activity timeline (CRM-002), tasks, transactions
-- (TXN-001 stub), lead capture with attribution integrity + idempotency (LEAD-001),
-- round-robin assignment (LEAD-002), AI action/insight tables (AI foundation),
-- automation run log (AUTO-001 foundation).
--
-- Rollback note: additive-only; safe on fresh or existing database.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.contact_stage as enum
  ('new', 'engaged', 'qualified', 'appointment', 'active_client',
   'under_contract', 'closed', 'past_client', 'archived');
create type public.contact_type as enum
  ('unknown', 'buyer', 'seller', 'buyer_seller', 'renter', 'agent_recruit', 'vendor', 'other');
create type public.consent_state as enum ('unknown', 'granted', 'revoked');
create type public.activity_type as enum
  ('capture', 'note', 'call', 'email', 'sms', 'meeting', 'stage_change',
   'assignment', 'task', 'system');
create type public.task_status as enum ('open', 'completed', 'cancelled');
create type public.txn_status as enum
  ('pending', 'active', 'under_contract', 'closed', 'cancelled');
create type public.ai_action_status as enum
  ('proposed', 'approved', 'rejected', 'executed', 'failed');
create type public.provenance_source as enum
  ('fact', 'user_provided', 'crm_derived', 'external_provider', 'calculated', 'ai_inferred');

-- ---------------------------------------------------------------------------
-- Contacts — unified contact record (CRM-001) with attribution integrity (§29):
-- original_* columns are IMMUTABLE (trigger-enforced); latest_* columns track
-- the most recent touch.
-- ---------------------------------------------------------------------------
create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  assigned_to   uuid references auth.users (id) on delete set null,
  first_name    text not null default '',
  last_name     text not null default '',
  email         text check (email is null or position('@' in email) > 1),
  phone         text,
  -- digits-only projection for dedupe lookups
  phone_digits  text generated always as
                (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  stage         public.contact_stage not null default 'new',
  contact_type  public.contact_type not null default 'unknown',
  -- communication consent (checked by trusted send paths, COMM-001)
  email_consent public.consent_state not null default 'unknown',
  sms_consent   public.consent_state not null default 'unknown',
  call_consent  public.consent_state not null default 'unknown',
  -- attribution: original_* set once at capture, never overwritten (§29)
  original_source        text,
  original_source_detail text,
  original_utm           jsonb not null default '{}'::jsonb,
  original_referrer      text,
  original_landing_page  text,
  captured_at            timestamptz,
  -- attribution: latest touch (mutable)
  latest_source          text,
  latest_source_detail   text,
  latest_utm             jsonb not null default '{}'::jsonb,
  latest_touch_at        timestamptz,
  lead_score    integer not null default 0 check (lead_score between 0 and 100),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (email is not null or phone is not null or created_by is not null)
);
create unique index contacts_org_email_uniq
  on public.contacts (org_id, lower(email)) where email is not null;
create index contacts_org_idx on public.contacts (org_id, created_at desc);
create index contacts_org_assigned_idx on public.contacts (org_id, assigned_to);
create index contacts_org_phone_idx
  on public.contacts (org_id, phone_digits) where phone_digits is not null;

alter table public.contacts enable row level security;
alter table public.contacts force row level security;

create policy "members read org contacts"
  on public.contacts for select using (app.is_org_member(org_id));
create policy "members create org contacts"
  on public.contacts for insert with check (app.is_org_member(org_id));
create policy "members update org contacts"
  on public.contacts for update
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));
create policy "admins delete contacts"
  on public.contacts for delete using (app.has_org_role(org_id, 'admin'));

create trigger contacts_updated_at
  before update on public.contacts
  for each row execute function app.set_updated_at();
create trigger contacts_org_immutable
  before update on public.contacts
  for each row execute function app.prevent_org_change();

-- §29 attribution integrity: original_* is write-once.
create or replace function app.protect_original_attribution()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if old.captured_at is not null and (
       new.original_source        is distinct from old.original_source
    or new.original_source_detail is distinct from old.original_source_detail
    or new.original_utm           is distinct from old.original_utm
    or new.original_referrer      is distinct from old.original_referrer
    or new.original_landing_page  is distinct from old.original_landing_page
    or new.captured_at            is distinct from old.captured_at
  ) then
    raise exception 'original attribution is immutable once captured (LEAD-001/§29)';
  end if;
  return new;
end;
$$;

create trigger contacts_protect_original_attribution
  before update on public.contacts
  for each row execute function app.protect_original_attribution();

-- ---------------------------------------------------------------------------
-- Activities — append-only timeline (CRM-002)
-- ---------------------------------------------------------------------------
create table public.activities (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  contact_id    uuid not null references public.contacts (id) on delete cascade,
  actor_type    public.actor_type not null default 'human',
  actor_user_id uuid references auth.users (id) on delete set null,
  activity_type public.activity_type not null,
  title         text not null check (length(title) between 1 and 300),
  body          text,
  metadata      jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index activities_contact_idx on public.activities (contact_id, occurred_at desc);
create index activities_org_idx on public.activities (org_id, occurred_at desc);

alter table public.activities enable row level security;
alter table public.activities force row level security;

create policy "members read org activities"
  on public.activities for select using (app.is_org_member(org_id));
create policy "members append activities as themselves"
  on public.activities for insert
  with check (
    app.is_org_member(org_id)
    and (actor_type <> 'human' or actor_user_id = auth.uid())
  );
-- Append-only: no update/delete policies.

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  contact_id  uuid references public.contacts (id) on delete cascade,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  assigned_to uuid references auth.users (id) on delete set null,
  title       text not null check (length(title) between 1 and 300),
  body        text,
  status      public.task_status not null default 'open',
  due_at      timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index tasks_org_status_idx on public.tasks (org_id, status, due_at);
create index tasks_assignee_idx on public.tasks (assigned_to, status);

alter table public.tasks enable row level security;
alter table public.tasks force row level security;

create policy "members read org tasks"
  on public.tasks for select using (app.is_org_member(org_id));
create policy "members create org tasks"
  on public.tasks for insert with check (app.is_org_member(org_id));
create policy "members update org tasks"
  on public.tasks for update
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));
create policy "admins delete tasks"
  on public.tasks for delete using (app.has_org_role(org_id, 'admin'));

create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function app.set_updated_at();
create trigger tasks_org_immutable
  before update on public.tasks
  for each row execute function app.prevent_org_change();

-- ---------------------------------------------------------------------------
-- Transactions (TXN-001 foundation)
-- ---------------------------------------------------------------------------
create table public.transactions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  contact_id       uuid references public.contacts (id) on delete set null,
  agent_user_id    uuid references auth.users (id) on delete set null,
  side             text not null check (side in ('buyer', 'seller')) ,
  status           public.txn_status not null default 'pending',
  property_address text,
  price            numeric(14, 2) check (price is null or price >= 0),
  gci              numeric(14, 2) check (gci is null or gci >= 0),
  key_dates        jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index transactions_org_status_idx on public.transactions (org_id, status);

alter table public.transactions enable row level security;
alter table public.transactions force row level security;

create policy "members read org transactions"
  on public.transactions for select using (app.is_org_member(org_id));
create policy "members create org transactions"
  on public.transactions for insert with check (app.is_org_member(org_id));
create policy "members update org transactions"
  on public.transactions for update
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));
create policy "admins delete transactions"
  on public.transactions for delete using (app.has_org_role(org_id, 'admin'));

create trigger transactions_updated_at
  before update on public.transactions
  for each row execute function app.set_updated_at();
create trigger transactions_org_immutable
  before update on public.transactions
  for each row execute function app.prevent_org_change();

-- ---------------------------------------------------------------------------
-- Lead capture idempotency ledger (LEAD-001, §15)
-- ---------------------------------------------------------------------------
create table public.lead_capture_requests (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  contact_id      uuid not null references public.contacts (id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (org_id, idempotency_key)
);
alter table public.lead_capture_requests enable row level security;
alter table public.lead_capture_requests force row level security;

create policy "members read capture requests"
  on public.lead_capture_requests for select using (app.is_org_member(org_id));
create policy "members record capture requests"
  on public.lead_capture_requests for insert with check (app.is_org_member(org_id));
-- Append-only.

-- ---------------------------------------------------------------------------
-- AI action requests (§24: AI proposes, trusted code validates + executes;
-- §15: idempotent)
-- ---------------------------------------------------------------------------
create table public.ai_actions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  contact_id      uuid references public.contacts (id) on delete cascade,
  agent_key       text not null,           -- which AI agent proposed it
  action_type     text not null,           -- e.g. 'send_sms', 'create_task'
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  correlation_id  uuid,
  status          public.ai_action_status not null default 'proposed',
  status_reason   text,
  created_at      timestamptz not null default now(),
  executed_at     timestamptz,
  unique (org_id, idempotency_key)
);
create index ai_actions_org_status_idx on public.ai_actions (org_id, status, created_at desc);

alter table public.ai_actions enable row level security;
alter table public.ai_actions force row level security;

create policy "members read ai actions"
  on public.ai_actions for select using (app.is_org_member(org_id));
create policy "members propose ai actions"
  on public.ai_actions for insert
  with check (app.is_org_member(org_id) and status = 'proposed');
create policy "admins adjudicate ai actions"
  on public.ai_actions for update
  using (app.has_org_role(org_id, 'admin'))
  with check (app.has_org_role(org_id, 'admin'));
-- Execution/status transitions in production flow through trusted server code
-- (service role / edge functions); admin update is the manual review path.

-- ---------------------------------------------------------------------------
-- AI insights with provenance + confidence (§14). AI inference never overwrites
-- verified contact fields; it lands here and is displayed alongside facts.
-- ---------------------------------------------------------------------------
create table public.ai_insights (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  contact_id  uuid not null references public.contacts (id) on delete cascade,
  kind        text not null,               -- e.g. 'seller_probability', 'summary'
  value       jsonb not null,
  source      public.provenance_source not null,
  confidence  numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  model       text,
  reasoning   text,
  signals     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index ai_insights_contact_idx on public.ai_insights (contact_id, kind, created_at desc);

alter table public.ai_insights enable row level security;
alter table public.ai_insights force row level security;

create policy "members read ai insights"
  on public.ai_insights for select using (app.is_org_member(org_id));
create policy "members record ai insights"
  on public.ai_insights for insert with check (app.is_org_member(org_id));
-- Append-only (new insight supersedes old by created_at).

-- ---------------------------------------------------------------------------
-- Automation run log (AUTO-001 foundation: §16 loop protection bookkeeping)
-- ---------------------------------------------------------------------------
create table public.automation_runs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  workflow_key   text not null,
  trigger_event  text not null,
  dedup_key      text,
  correlation_id uuid,
  depth          integer not null default 0 check (depth >= 0),
  action_count   integer not null default 0 check (action_count >= 0),
  retry_count    integer not null default 0 check (retry_count >= 0),
  status         text not null default 'running'
                 check (status in ('running', 'succeeded', 'failed', 'aborted')),
  error          text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index automation_runs_org_idx on public.automation_runs (org_id, workflow_key, started_at desc);
-- Dedup window enforcement helper index
create index automation_runs_dedup_idx
  on public.automation_runs (org_id, workflow_key, dedup_key, started_at desc)
  where dedup_key is not null;

alter table public.automation_runs enable row level security;
alter table public.automation_runs force row level security;

create policy "members read automation runs"
  on public.automation_runs for select using (app.is_org_member(org_id));
create policy "members record automation runs"
  on public.automation_runs for insert with check (app.is_org_member(org_id));
create policy "members update automation runs"
  on public.automation_runs for update
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Lead capture RPC (LEAD-001 + LEAD-002).
-- SECURITY INVOKER: RLS applies — the caller must be a member of p_org_id.
-- Idempotent (idempotency key + advisory lock), dedupes by email/phone,
-- preserves original attribution, assigns round-robin, writes timeline + audit.
-- ---------------------------------------------------------------------------
create or replace function public.capture_lead(
  p_org_id          uuid,
  p_idempotency_key text,
  p_first_name      text default null,
  p_last_name       text default null,
  p_email           text default null,
  p_phone           text default null,
  p_source          text default 'manual',
  p_source_detail   text default null,
  p_utm             jsonb default '{}'::jsonb,
  p_referrer        text default null,
  p_landing_page    text default null,
  p_message         text default null
) returns uuid
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  v_contact_id   uuid;
  v_assignee     uuid;
  v_email        text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone_digits text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  v_is_new       boolean := false;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'idempotency key of at least 8 characters is required';
  end if;
  if v_email is null and v_phone_digits is null then
    raise exception 'a lead must include an email address or phone number';
  end if;

  -- Serialize concurrent identical submissions (double-click, webhook retry).
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || '/' || p_idempotency_key, 0));

  -- Idempotent replay: same key returns the same contact, no side effects.
  select contact_id into v_contact_id
  from lead_capture_requests
  where org_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    return v_contact_id;
  end if;

  -- Dedupe by email or phone within the org.
  select id into v_contact_id
  from contacts
  where org_id = p_org_id
    and ((v_email is not null and lower(email) = v_email)
      or (v_phone_digits is not null and phone_digits = v_phone_digits))
  order by created_at
  limit 1;

  if v_contact_id is null then
    v_is_new := true;

    -- Round-robin assignment (LEAD-002): member with the fewest assigned contacts.
    select m.user_id into v_assignee
    from org_members m
    where m.org_id = p_org_id and m.role in ('owner', 'admin', 'agent')
    order by (select count(*) from contacts c
              where c.org_id = p_org_id and c.assigned_to = m.user_id),
             m.created_at
    limit 1;

    insert into contacts (
      org_id, first_name, last_name, email, phone, assigned_to,
      original_source, original_source_detail, original_utm,
      original_referrer, original_landing_page, captured_at,
      latest_source, latest_source_detail, latest_utm, latest_touch_at
    ) values (
      p_org_id, coalesce(trim(p_first_name), ''), coalesce(trim(p_last_name), ''),
      v_email, nullif(trim(coalesce(p_phone, '')), ''), v_assignee,
      p_source, p_source_detail, coalesce(p_utm, '{}'::jsonb),
      p_referrer, p_landing_page, now(),
      p_source, p_source_detail, coalesce(p_utm, '{}'::jsonb), now()
    ) returning id into v_contact_id;

    insert into activities (org_id, contact_id, actor_type, activity_type, title, body, metadata)
    values (p_org_id, v_contact_id, 'system', 'capture', 'Lead captured', p_message,
            jsonb_build_object('source', p_source, 'source_detail', p_source_detail,
                               'utm', coalesce(p_utm, '{}'::jsonb)));

    if v_assignee is not null then
      insert into activities (org_id, contact_id, actor_type, activity_type, title, metadata)
      values (p_org_id, v_contact_id, 'system', 'assignment', 'Lead assigned',
              jsonb_build_object('assigned_to', v_assignee, 'strategy', 'round_robin'));
    end if;
  else
    -- Existing contact: update latest_* only; original attribution is immutable.
    update contacts
    set latest_source        = p_source,
        latest_source_detail = p_source_detail,
        latest_utm           = coalesce(p_utm, '{}'::jsonb),
        latest_touch_at      = now()
    where id = v_contact_id;

    insert into activities (org_id, contact_id, actor_type, activity_type, title, body, metadata)
    values (p_org_id, v_contact_id, 'system', 'capture', 'Repeat inquiry', p_message,
            jsonb_build_object('source', p_source, 'source_detail', p_source_detail));
  end if;

  insert into audit_log (org_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
  values (p_org_id, 'human', auth.uid(), 'lead.capture', 'contact', v_contact_id::text,
          jsonb_build_object('idempotency_key', p_idempotency_key,
                             'source', p_source, 'new_contact', v_is_new));

  insert into lead_capture_requests (org_id, idempotency_key, contact_id)
  values (p_org_id, p_idempotency_key, v_contact_id);

  return v_contact_id;
end;
$$;
