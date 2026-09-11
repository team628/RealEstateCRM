-- 00003_owner_guard.sql
-- Fixes KI-001: an organization must always retain at least one owner.
-- Demoting or removing the last owner is blocked; deleting the organization
-- itself (which cascades through org_members) remains allowed.
--
-- Rollback note: additive-only (new trigger); drop trigger + function to revert.

create or replace function app.protect_last_owner()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and new.user_id = old.user_id then
    return new;
  end if;
  -- Allow cascaded deletes when the organization itself is being removed.
  if not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return coalesce(new, old);
  end if;
  if not exists (
    select 1 from public.org_members m
    where m.org_id = old.org_id
      and m.role = 'owner'
      and m.user_id <> old.user_id
  ) then
    raise exception 'an organization must retain at least one owner (KI-001)';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger org_members_protect_last_owner
  before update or delete on public.org_members
  for each row execute function app.protect_last_owner();
