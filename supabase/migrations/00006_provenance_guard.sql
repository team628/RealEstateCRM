-- 00006_provenance_guard.sql
-- §14 provenance integrity (found in adversarial review §38): API clients could
-- insert ai_insights labeled source='fact', dressing up an unverified claim as
-- verified truth. 'fact' rows may only be written by trusted server code
-- (service role bypasses RLS); every client-written insight must carry an
-- honest non-fact provenance.
--
-- Rollback note: restores the previous permissive policy.

drop policy "members record ai insights" on public.ai_insights;

create policy "members record non-fact insights"
  on public.ai_insights for insert
  with check (
    app.is_org_member(org_id)
    and source <> 'fact'
  );
