-- 00005_outbox_and_export.sql
-- COMM-001 foundation: outbound messages go through a database-enforced queue.
-- Consent (§ communication consent), kill switches (§17), and idempotency (§15)
-- are enforced IN TRUSTED SQL — no client or AI path can send around them.
-- Provider adapters (external, OA-004) later drain 'queued' rows and mark them
-- sent/failed; nothing sends until then, so this is safe to ship now.
--
-- DATA-001 foundation: owner-only whole-org export (§18 data ownership).
--
-- Rollback note: additive-only.

create type public.outbox_channel as enum ('email', 'sms');
create type public.outbox_status as enum ('queued', 'sent', 'failed', 'cancelled');

create table public.communication_outbox (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  contact_id      uuid not null references public.contacts (id) on delete cascade,
  channel         public.outbox_channel not null,
  subject         text,
  body            text not null check (length(body) between 1 and 50000),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  requested_by    uuid references auth.users (id) on delete set null,
  requested_via   public.actor_type not null default 'human',
  status          public.outbox_status not null default 'queued',
  status_reason   text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  unique (org_id, idempotency_key)
);
create index outbox_org_status_idx on public.communication_outbox (org_id, status, created_at);

alter table public.communication_outbox enable row level security;
alter table public.communication_outbox force row level security;

create policy "members read outbox"
  on public.communication_outbox for select
  using (app.is_org_member(org_id));
-- No direct insert policy: rows are created ONLY via queue_message below,
-- which runs as definer after enforcing consent + switches.
create policy "admins cancel queued messages"
  on public.communication_outbox for update
  using (app.has_org_role(org_id, 'admin') and status = 'queued')
  with check (app.has_org_role(org_id, 'admin') and status in ('queued', 'cancelled'));

-- Trusted enqueue path. SECURITY DEFINER so it can insert despite the missing
-- insert policy — every precondition is checked explicitly first.
create or replace function public.queue_message(
  p_contact_id      uuid,
  p_channel         public.outbox_channel,
  p_body            text,
  p_idempotency_key text,
  p_subject         text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_contact public.contacts%rowtype;
  v_consent public.consent_state;
  v_existing uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  select * into v_contact from public.contacts where id = p_contact_id;
  if not found or not app.is_org_member(v_contact.org_id) then
    -- identical error for missing and foreign contacts: no existence oracle
    raise exception 'contact not found';
  end if;

  -- §17 kill switch, fail closed
  if not app.channel_enabled(v_contact.org_id, p_channel::text) then
    raise exception 'outbound % is disabled for this organization', p_channel;
  end if;

  -- consent must be explicitly granted (unknown/revoked both block)
  v_consent := case p_channel
    when 'email' then v_contact.email_consent
    when 'sms'   then v_contact.sms_consent
  end;
  if v_consent is distinct from 'granted' then
    raise exception 'contact has not granted % consent', p_channel;
  end if;

  -- channel destination must exist
  if p_channel = 'email' and v_contact.email is null then
    raise exception 'contact has no email address';
  end if;
  if p_channel = 'sms' and v_contact.phone is null then
    raise exception 'contact has no phone number';
  end if;

  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'idempotency key of at least 8 characters is required';
  end if;

  -- §15 idempotent replay
  select id into v_existing from public.communication_outbox
   where org_id = v_contact.org_id and idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  insert into public.communication_outbox
    (org_id, contact_id, channel, subject, body, idempotency_key, requested_by)
  values
    (v_contact.org_id, p_contact_id, p_channel, p_subject, p_body, p_idempotency_key, auth.uid())
  returning id into v_id;

  insert into public.audit_log (org_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
  values (v_contact.org_id, 'human', auth.uid(), 'comm.queue', 'outbox', v_id::text,
          jsonb_build_object('channel', p_channel, 'contact_id', p_contact_id));

  return v_id;
end;
$$;

grant execute on function public.queue_message(uuid, public.outbox_channel, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- DATA-001: whole-org export, owner-only (§18). Returns one jsonb document;
-- an edge function can stream it as a file later. Excludes nothing the org
-- legitimately owns; includes settings and audit trail.
-- ---------------------------------------------------------------------------
create or replace function public.export_org_data(p_org_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not app.has_org_role(p_org_id, 'owner') then
    raise exception 'only organization owners can export data';
  end if;
  select jsonb_build_object(
    'exported_at', now(),
    'organization', (select to_jsonb(o) from public.organizations o where o.id = p_org_id),
    'settings', (select to_jsonb(s) from public.org_settings s where s.org_id = p_org_id),
    'members', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.org_members m where m.org_id = p_org_id),
    'contacts', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.contacts c where c.org_id = p_org_id),
    'activities', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.activities a where a.org_id = p_org_id),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.tasks t where t.org_id = p_org_id),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.transactions x where x.org_id = p_org_id),
    'ai_insights', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.ai_insights i where i.org_id = p_org_id),
    'ai_actions', (select coalesce(jsonb_agg(to_jsonb(aa)), '[]'::jsonb) from public.ai_actions aa where aa.org_id = p_org_id),
    'automation_runs', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.automation_runs r where r.org_id = p_org_id),
    'communication_outbox', (select coalesce(jsonb_agg(to_jsonb(ob)), '[]'::jsonb) from public.communication_outbox ob where ob.org_id = p_org_id),
    'audit_log', (select coalesce(jsonb_agg(to_jsonb(al)), '[]'::jsonb) from public.audit_log al where al.org_id = p_org_id)
  ) into result;

  return result;
end;
$$;

grant execute on function public.export_org_data(uuid) to authenticated;
