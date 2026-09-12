-- 00008_public_capture.sql
-- Resolves KI-004: public website forms can capture leads WITHOUT an
-- authenticated org member, safely:
--   * per-org secret form token (org_settings.public_form_token) — the website
--     embeds it; wrong/missing token is rejected with no org-existence oracle
--   * hourly rate cap per org (org_settings.automation_limits->
--     'max_public_captures_per_hour', default 100) — fail closed
--   * input length caps (spam/bloat control)
--   * capture core factored into app.do_capture_lead, shared by the member
--     RPC (unchanged signature/behavior) and the new anon RPC
--
-- Rollback note: additive + core refactor of capture_lead (behavior preserved,
-- covered by existing suite 01 which reruns on every db:test).

alter table public.org_settings
  add column public_form_token uuid not null default gen_random_uuid();

-- ---------------------------------------------------------------------------
-- Shared capture core. SECURITY DEFINER: callers are the two wrappers below,
-- which perform authorization (membership / form token) BEFORE delegating.
-- ---------------------------------------------------------------------------
create or replace function app.do_capture_lead(
  p_org_id          uuid,
  p_idempotency_key text,
  p_first_name      text,
  p_last_name       text,
  p_email           text,
  p_phone           text,
  p_source          text,
  p_source_detail   text,
  p_utm             jsonb,
  p_referrer        text,
  p_landing_page    text,
  p_message         text,
  p_actor_user_id   uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
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
  from public.lead_capture_requests
  where org_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    return v_contact_id;
  end if;

  -- Dedupe by email or phone within the org.
  select id into v_contact_id
  from public.contacts
  where org_id = p_org_id
    and ((v_email is not null and lower(email) = v_email)
      or (v_phone_digits is not null and phone_digits = v_phone_digits))
  order by created_at
  limit 1;

  if v_contact_id is null then
    v_is_new := true;

    -- Round-robin assignment (LEAD-002): member with the fewest assigned contacts.
    select m.user_id into v_assignee
    from public.org_members m
    where m.org_id = p_org_id and m.role in ('owner', 'admin', 'agent')
    order by (select count(*) from public.contacts c
              where c.org_id = p_org_id and c.assigned_to = m.user_id),
             m.created_at
    limit 1;

    insert into public.contacts (
      org_id, created_by, first_name, last_name, email, phone, assigned_to,
      original_source, original_source_detail, original_utm,
      original_referrer, original_landing_page, captured_at,
      latest_source, latest_source_detail, latest_utm, latest_touch_at
    ) values (
      p_org_id, p_actor_user_id,
      coalesce(trim(p_first_name), ''), coalesce(trim(p_last_name), ''),
      v_email, nullif(trim(coalesce(p_phone, '')), ''), v_assignee,
      p_source, p_source_detail, coalesce(p_utm, '{}'::jsonb),
      p_referrer, p_landing_page, now(),
      p_source, p_source_detail, coalesce(p_utm, '{}'::jsonb), now()
    ) returning id into v_contact_id;

    insert into public.activities (org_id, contact_id, actor_type, activity_type, title, body, metadata)
    values (p_org_id, v_contact_id, 'system', 'capture', 'Lead captured', p_message,
            jsonb_build_object('source', p_source, 'source_detail', p_source_detail,
                               'utm', coalesce(p_utm, '{}'::jsonb)));

    if v_assignee is not null then
      insert into public.activities (org_id, contact_id, actor_type, activity_type, title, metadata)
      values (p_org_id, v_contact_id, 'system', 'assignment', 'Lead assigned',
              jsonb_build_object('assigned_to', v_assignee, 'strategy', 'round_robin'));
    end if;
  else
    -- Existing contact: update latest_* only; original attribution is immutable.
    update public.contacts
    set latest_source        = p_source,
        latest_source_detail = p_source_detail,
        latest_utm           = coalesce(p_utm, '{}'::jsonb),
        latest_touch_at      = now()
    where id = v_contact_id;

    insert into public.activities (org_id, contact_id, actor_type, activity_type, title, body, metadata)
    values (p_org_id, v_contact_id, 'system', 'capture', 'Repeat inquiry', p_message,
            jsonb_build_object('source', p_source, 'source_detail', p_source_detail));
  end if;

  insert into public.audit_log (org_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
  values (p_org_id,
          case when p_actor_user_id is null then 'system'::public.actor_type else 'human'::public.actor_type end,
          p_actor_user_id, 'lead.capture', 'contact', v_contact_id::text,
          jsonb_build_object('idempotency_key', p_idempotency_key,
                             'source', p_source, 'new_contact', v_is_new));

  insert into public.lead_capture_requests (org_id, idempotency_key, contact_id)
  values (p_org_id, p_idempotency_key, v_contact_id);

  return v_contact_id;
end;
$$;
-- Postgres grants EXECUTE to PUBLIC on new functions by default — revoke it so
-- the token/membership checks in the wrappers below cannot be sidestepped.
-- (The wrappers, owned by the migration role, still call it.)
revoke execute on function app.do_capture_lead(
  uuid, text, text, text, text, text, text, text, jsonb, text, text, text, uuid
) from public;

-- ---------------------------------------------------------------------------
-- Member wrapper: same signature and behavior as before (suite 01 re-verifies).
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
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_org_member(p_org_id) then
    raise exception 'permission denied for organization';
  end if;
  return app.do_capture_lead(p_org_id, p_idempotency_key, p_first_name, p_last_name,
    p_email, p_phone, p_source, p_source_detail, p_utm, p_referrer, p_landing_page,
    p_message, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrapper (KI-004): anonymous website forms. Token-gated + rate-capped.
-- ---------------------------------------------------------------------------
create or replace function public.capture_lead_public(
  p_org_id          uuid,
  p_form_token      uuid,
  p_idempotency_key text,
  p_first_name      text default null,
  p_last_name       text default null,
  p_email           text default null,
  p_phone           text default null,
  p_source          text default 'website',
  p_source_detail   text default null,
  p_utm             jsonb default '{}'::jsonb,
  p_referrer        text default null,
  p_landing_page    text default null,
  p_message         text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap integer;
  v_recent integer;
begin
  -- Same error for wrong org and wrong token: no existence oracle.
  if not exists (
    select 1 from public.org_settings s
    where s.org_id = p_org_id and s.public_form_token = p_form_token
  ) then
    raise exception 'invalid form token';
  end if;

  -- Spam/bloat control on anonymous input.
  if length(coalesce(p_first_name, '')) > 100 or length(coalesce(p_last_name, '')) > 100
     or length(coalesce(p_email, '')) > 320 or length(coalesce(p_phone, '')) > 40
     or length(coalesce(p_source, '')) > 100 or length(coalesce(p_source_detail, '')) > 200
     or length(coalesce(p_message, '')) > 5000
     or pg_column_size(coalesce(p_utm, '{}'::jsonb)) > 4096 then
    raise exception 'input exceeds allowed length';
  end if;

  -- Hourly rate cap per org, fail closed (§16/§22).
  select coalesce((s.automation_limits ->> 'max_public_captures_per_hour')::integer, 100)
    into v_cap
  from public.org_settings s where s.org_id = p_org_id;
  select count(*) into v_recent
  from public.lead_capture_requests r
  where r.org_id = p_org_id and r.created_at > now() - interval '1 hour';
  if v_recent >= v_cap then
    raise exception 'capture rate limit exceeded for this organization';
  end if;

  return app.do_capture_lead(p_org_id, p_idempotency_key, p_first_name, p_last_name,
    p_email, p_phone, p_source, p_source_detail, p_utm, p_referrer, p_landing_page,
    p_message, null);
end;
$$;

grant execute on function public.capture_lead_public(uuid, uuid, text, text, text, text, text, text, text, jsonb, text, text, text)
  to anon, authenticated;
