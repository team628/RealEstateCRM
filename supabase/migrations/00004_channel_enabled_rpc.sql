-- 00004_channel_enabled_rpc.sql
-- Public RPC wrapper for the trusted kill-switch check so API clients and edge
-- functions can ask "is this channel enabled?" without duplicating switch
-- logic. Member-gated: non-members always get false (no information leak).
--
-- Rollback note: additive-only.

create or replace function public.channel_enabled(p_org_id uuid, p_channel text, p_key text default null)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when app.is_org_member(p_org_id) then app.channel_enabled(p_org_id, p_channel, p_key)
    else false
  end;
$$;

grant execute on function public.channel_enabled(uuid, text, text)
  to authenticated, service_role;
