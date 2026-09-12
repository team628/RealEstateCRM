-- 00007_assignee_guard_and_merge.sql
-- 1) Fixes KI-005: assignees must be members of the row's org. Checked only
--    when the assignee column actually changes, so rows holding a since-removed
--    member stay editable.
-- 2) CRM-001 merge tooling: admin-only merge_contacts RPC that folds a
--    duplicate contact into a survivor — children move, missing fields fill,
--    the survivor's original attribution is preserved (§29), everything is
--    audit-logged, and the duplicate is removed.
--
-- Rollback note: additive-only (new triggers + function).

create or replace function app.validate_assignee_membership()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_col text := case tg_table_name when 'transactions' then 'agent_user_id' else 'assigned_to' end;
  v_assignee uuid := (to_jsonb(new) ->> v_col)::uuid;
begin
  if v_assignee is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and (to_jsonb(new) ->> v_col) is not distinct from (to_jsonb(old) ->> v_col) then
    return new;
  end if;
  if not exists (
    select 1 from public.org_members m
    where m.org_id = new.org_id and m.user_id = v_assignee
  ) then
    raise exception 'assignee must be a member of the organization (KI-005)';
  end if;
  return new;
end;
$$;

create trigger contacts_validate_assignee
  before insert or update on public.contacts
  for each row execute function app.validate_assignee_membership();
create trigger tasks_validate_assignee
  before insert or update on public.tasks
  for each row execute function app.validate_assignee_membership();
create trigger transactions_validate_assignee
  before insert or update on public.transactions
  for each row execute function app.validate_assignee_membership();

-- ---------------------------------------------------------------------------
-- merge_contacts: admin-only, same-org, definer (moves append-only children).
-- ---------------------------------------------------------------------------
create or replace function public.merge_contacts(p_survivor_id uuid, p_duplicate_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_survivor  public.contacts%rowtype;
  v_duplicate public.contacts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_survivor_id = p_duplicate_id then
    raise exception 'cannot merge a contact into itself';
  end if;
  select * into v_survivor from public.contacts where id = p_survivor_id;
  if not found or not app.is_org_member(v_survivor.org_id) then
    raise exception 'contact not found';
  end if;
  select * into v_duplicate from public.contacts where id = p_duplicate_id;
  if not found or v_duplicate.org_id <> v_survivor.org_id then
    raise exception 'contact not found';
  end if;
  if not app.has_org_role(v_survivor.org_id, 'admin') then
    raise exception 'only admins can merge contacts';
  end if;

  -- Move children first, then remove the duplicate row (freeing its unique
  -- email), then enrich the survivor. Deleting later would cascade-delete the
  -- children; enriching earlier would collide with the duplicate's email.
  update public.activities            set contact_id = p_survivor_id where contact_id = p_duplicate_id;
  update public.tasks                 set contact_id = p_survivor_id where contact_id = p_duplicate_id;
  update public.transactions          set contact_id = p_survivor_id where contact_id = p_duplicate_id;
  update public.ai_insights           set contact_id = p_survivor_id where contact_id = p_duplicate_id;
  update public.ai_actions            set contact_id = p_survivor_id where contact_id = p_duplicate_id;
  update public.communication_outbox  set contact_id = p_survivor_id where contact_id = p_duplicate_id;
  update public.lead_capture_requests set contact_id = p_survivor_id where contact_id = p_duplicate_id;

  delete from public.contacts where id = p_duplicate_id;

  update public.contacts set
    email      = coalesce(email, v_duplicate.email),
    phone      = coalesce(phone, v_duplicate.phone),
    first_name = case when first_name = '' then v_duplicate.first_name else first_name end,
    last_name  = case when last_name  = '' then v_duplicate.last_name  else last_name  end,
    email_consent = case when email_consent = 'unknown' then v_duplicate.email_consent else email_consent end,
    sms_consent   = case when sms_consent   = 'unknown' then v_duplicate.sms_consent   else sms_consent   end,
    call_consent  = case when call_consent  = 'unknown' then v_duplicate.call_consent  else call_consent  end,
    -- §29: survivor's original attribution wins; adopt the duplicate's only
    -- when the survivor never had a capture (write-once trigger allows that).
    original_source        = case when captured_at is null then v_duplicate.original_source        else original_source        end,
    original_source_detail = case when captured_at is null then v_duplicate.original_source_detail else original_source_detail end,
    original_utm           = case when captured_at is null then v_duplicate.original_utm           else original_utm           end,
    original_referrer      = case when captured_at is null then v_duplicate.original_referrer      else original_referrer      end,
    original_landing_page  = case when captured_at is null then v_duplicate.original_landing_page  else original_landing_page  end,
    captured_at            = coalesce(captured_at, v_duplicate.captured_at),
    -- most recent touch wins for latest_*
    latest_source        = case when v_duplicate.latest_touch_at > coalesce(latest_touch_at, '-infinity') then v_duplicate.latest_source        else latest_source        end,
    latest_source_detail = case when v_duplicate.latest_touch_at > coalesce(latest_touch_at, '-infinity') then v_duplicate.latest_source_detail else latest_source_detail end,
    latest_utm           = case when v_duplicate.latest_touch_at > coalesce(latest_touch_at, '-infinity') then v_duplicate.latest_utm           else latest_utm           end,
    latest_touch_at      = nullif(greatest(coalesce(latest_touch_at, '-infinity'),
                                           coalesce(v_duplicate.latest_touch_at, '-infinity')), '-infinity'),
    lead_score = greatest(lead_score, v_duplicate.lead_score)
  where id = p_survivor_id;

  insert into public.activities (org_id, contact_id, actor_type, actor_user_id, activity_type, title, metadata)
  values (v_survivor.org_id, p_survivor_id, 'human', auth.uid(), 'system', 'Contacts merged',
          jsonb_build_object('merged_contact_id', p_duplicate_id,
                             'merged_name', trim(v_duplicate.first_name || ' ' || v_duplicate.last_name)));

  insert into public.audit_log (org_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
  values (v_survivor.org_id, 'human', auth.uid(), 'contact.merge', 'contact', p_survivor_id::text,
          jsonb_build_object('duplicate_id', p_duplicate_id));

  delete from public.contacts where id = p_duplicate_id;
end;
$$;

grant execute on function public.merge_contacts(uuid, uuid) to authenticated;
