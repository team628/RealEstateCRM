-- SEC-001 / OPS-001 / OPS-002 / LEAD-001 / LEAD-002 executable verification.
-- Run via db/harness/run-db-tests.sh (fresh DB, migrations applied from zero).
-- Every assertion either passes or aborts the run with a non-zero exit code.
\set ON_ERROR_STOP 1
set client_min_messages to warning;

-- ---------------------------------------------------------------------------
-- Test helpers (created as superuser)
-- ---------------------------------------------------------------------------
create schema if not exists tests;

create or replace function tests.assert(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'ASSERT FAILED: %', msg;
  end if;
end $$;

-- Asserts that a statement raises ANY error (RLS violation, trigger, check...).
create or replace function tests.assert_denied(stmt text, msg text) returns void
language plpgsql as $$
declare denied boolean := false;
begin
  begin
    execute stmt;
  exception when others then
    denied := true;
  end;
  if not denied then
    raise exception 'ASSERT FAILED (statement unexpectedly allowed): %', msg;
  end if;
end $$;

create or replace function tests.login(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then ''
         else json_build_object('sub', p_user, 'role', 'authenticated')::text end,
    false);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

-- ---------------------------------------------------------------------------
-- Fixture users (direct auth.users inserts, as Supabase Auth would create them)
-- ---------------------------------------------------------------------------
\set ua 11111111-1111-1111-1111-111111111111
\set ub 22222222-2222-2222-2222-222222222222
\set uc 33333333-3333-3333-3333-333333333333

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ua', 'alice@a.test', '{"full_name":"Alice Owner"}'),
  (:'ub', 'bob@b.test',   '{"full_name":"Bob Owner"}'),
  (:'uc', 'carol@a.test', '{"full_name":"Carol Agent"}');

select tests.assert((select count(*) from public.profiles) = 3,
  'profiles are auto-created for new auth users');

-- ---------------------------------------------------------------------------
-- Org bootstrap: Alice founds Org A (becomes owner), adds Carol as agent.
-- Bob founds Org B.
-- ---------------------------------------------------------------------------
select tests.login(:'ua');
set role authenticated;

select public.create_organization('Org A') as orga_id
\gset

select tests.assert(app.is_org_member(:'orga_id'), 'org creator is a member');
select tests.assert(app.has_org_role(:'orga_id', 'owner'), 'org creator is owner');
select tests.assert((select count(*) from public.org_settings where org_id = :'orga_id') = 1,
  'org settings row auto-created');

insert into public.org_members (org_id, user_id, role) values (:'orga_id', :'uc', 'agent');

select tests.login(:'ub');
select public.create_organization('Org B') as orgb_id
\gset

-- The RPC must not allow anonymous or impersonated creation
select tests.assert_denied(
  'select public.create_organization(''  '')',
  'blank org names are rejected');

-- ---------------------------------------------------------------------------
-- LEAD-001/002: capture as Carol (agent in Org A)
-- ---------------------------------------------------------------------------
select tests.login(:'uc');

select public.capture_lead(:'orga_id', 'test-key-00000001', 'John', 'Doe',
  'John@Example.com', '+1 (555) 111-2222', 'website', 'home-valuation',
  '{"utm_source":"google","utm_campaign":"brand"}'::jsonb,
  'https://google.com', '/home-value', 'What is my house worth?') as contact_a
\gset

select tests.assert(
  (select email from public.contacts where id = :'contact_a') = 'john@example.com',
  'email is normalized to lowercase');
select tests.assert(
  (select assigned_to from public.contacts where id = :'contact_a') is not null,
  'new lead gets an assignee');
select tests.assert(
  (select original_source from public.contacts where id = :'contact_a') = 'website',
  'original source recorded');
select tests.assert(
  (select count(*) from public.activities where contact_id = :'contact_a'
    and activity_type in ('capture', 'assignment')) = 2,
  'capture + assignment activities recorded on timeline');
select tests.assert(
  (select count(*) from public.audit_log where org_id = :'orga_id'
    and action = 'lead.capture') = 1,
  'capture is audit-logged');

-- Idempotent replay (§15): same key -> same contact, no duplicates, no new events
select public.capture_lead(:'orga_id', 'test-key-00000001', 'John', 'Doe',
  'john@example.com', null, 'website') as contact_a_replay
\gset
select tests.assert(:'contact_a_replay'::uuid = :'contact_a'::uuid,
  'idempotent replay returns the same contact');
select tests.assert((select count(*) from public.contacts) = 1,
  'replay creates no duplicate contact');
select tests.assert(
  (select count(*) from public.activities where contact_id = :'contact_a') = 2,
  'replay writes no duplicate activities');

-- Dedupe by email (different key), attribution integrity (§29)
select public.capture_lead(:'orga_id', 'test-key-00000002', 'John', 'Doe',
  'JOHN@example.com', null, 'zillow', 'listing-inquiry') as contact_a_dupe
\gset
select tests.assert(:'contact_a_dupe'::uuid = :'contact_a'::uuid,
  'same email dedupes to existing contact');
select tests.assert(
  (select latest_source from public.contacts where id = :'contact_a') = 'zillow',
  'latest source updated on repeat inquiry');
select tests.assert(
  (select original_source from public.contacts where id = :'contact_a') = 'website',
  'ORIGINAL source never overwritten by later touches');

-- Direct tampering with original attribution is blocked by trigger
select tests.assert_denied(
  format('update public.contacts set original_source = %L where id = %L',
         'hacked', :'contact_a'),
  'original attribution is immutable');

-- Round-robin: a second distinct lead goes to the other eligible member
select public.capture_lead(:'orga_id', 'test-key-00000003', 'Sally', 'Seller',
  'sally@example.com', '555-222-3333', 'open_house') as contact_b
\gset
select tests.assert(
  (select count(distinct assigned_to) from public.contacts) = 2,
  'round-robin distributes leads across members');

-- Phone dedupe tolerates formatting differences
select public.capture_lead(:'orga_id', 'test-key-00000004', 'S', 'S',
  null, '(555) 222 3333', 'sign_call') as contact_b_dupe
\gset
select tests.assert(:'contact_b_dupe'::uuid = :'contact_b'::uuid,
  'phone dedupe ignores formatting');

-- Cross-tenant capture: Carol is not a member of Org B
select tests.assert_denied(
  format('select public.capture_lead(%L, %L, %L, %L, %L)',
         :'orgb_id', 'test-key-00000009', 'Evil', 'Lead', 'evil@x.test'),
  'non-member cannot capture a lead into another org');

-- ---------------------------------------------------------------------------
-- SEC-001: cross-tenant isolation from Org B's perspective (Bob)
-- ---------------------------------------------------------------------------
select tests.login(:'ub');

select tests.assert((select count(*) from public.contacts) = 0,
  'Bob sees zero Org A contacts');
select tests.assert((select count(*) from public.organizations where id = :'orga_id') = 0,
  'Org A row is invisible to Bob');
select tests.assert((select count(*) from public.activities) = 0,
  'Org A activities are invisible to Bob');
select tests.assert((select count(*) from public.audit_log) = 0,
  'Org A audit log is invisible to Bob');
select tests.assert((select count(*) from public.org_settings where org_id = :'orga_id') = 0,
  'Org A settings are invisible to Bob');
select tests.assert((select count(*) from public.profiles where id = :'ua') = 0,
  'profiles do not leak across unrelated orgs');
select tests.assert((select count(*) from public.profiles where id = :'ub') = 1,
  'Bob still sees his own profile');

with attempt as (
  update public.contacts set first_name = 'HACKED' where id = :'contact_a' returning 1)
select tests.assert((select count(*) from attempt) = 0,
  'cross-tenant contact update affects zero rows');

select tests.assert_denied(
  format('insert into public.activities (org_id, contact_id, activity_type, title, actor_type)
          values (%L, %L, %L, %L, %L)',
         :'orga_id', :'contact_a', 'note', 'sneaky note', 'system'),
  'cross-tenant activity insert is denied');

select tests.assert_denied(
  format('insert into public.org_members (org_id, user_id, role) values (%L, %L, %L)',
         :'orga_id', :'ub', 'admin'),
  'self-invite into a foreign org is denied');

-- Carol (member of A) does see Alice's profile via shared org
select tests.login(:'uc');
select tests.assert((select count(*) from public.profiles where id = :'ua') = 1,
  'shared-org profiles are visible');

-- ---------------------------------------------------------------------------
-- Role enforcement + kill switches (OPS-001)
-- ---------------------------------------------------------------------------
-- Carol is an agent: cannot flip kill switches, self-escalate, or delete contacts
with attempt as (
  update public.org_settings set sms_enabled = false where org_id = :'orga_id' returning 1)
select tests.assert((select count(*) from attempt) = 0,
  'agent cannot change kill switches');

with attempt as (
  update public.org_members set role = 'admin'
  where org_id = :'orga_id' and user_id = :'uc' returning 1)
select tests.assert((select count(*) from attempt) = 0,
  'agent cannot escalate their own role');

with attempt as (
  delete from public.contacts where id = :'contact_a' returning 1)
select tests.assert((select count(*) from attempt) = 0,
  'agent cannot delete contacts (admin-only)');

-- Tenant reassignment of a row is blocked even for members
select tests.login(:'ua');
select tests.assert_denied(
  format('update public.contacts set org_id = %L where id = %L',
         :'orgb_id', :'contact_a'),
  'moving a row to another tenant is denied');

-- Owner CAN operate the kill switches, effective immediately (no deploy)
with attempt as (
  update public.org_settings
  set sms_enabled = false, workflow_overrides = '{"wf_drip": false}'::jsonb
  where org_id = :'orga_id' returning 1)
select tests.assert((select count(*) from attempt) = 1,
  'owner updates kill switches');
select tests.assert(app.channel_enabled(:'orga_id', 'sms') = false,
  'SMS kill switch takes effect');
select tests.assert(app.channel_enabled(:'orga_id', 'email') = true,
  'other channels unaffected');
select tests.assert(app.channel_enabled(:'orga_id', 'automations', 'wf_drip') = false,
  'per-workflow override disables one workflow');
select tests.assert(app.channel_enabled(:'orga_id', 'automations', 'wf_other') = true,
  'other workflows remain enabled');
select tests.assert(app.channel_enabled(gen_random_uuid(), 'sms') = false,
  'unknown org fails closed');

-- ---------------------------------------------------------------------------
-- OPS-002: audit log + timeline are append-only, even for the org owner
-- ---------------------------------------------------------------------------
with attempt as (update public.audit_log set action = 'tampered' returning 1)
select tests.assert((select count(*) from attempt) = 0, 'audit log cannot be updated');
with attempt as (delete from public.audit_log returning 1)
select tests.assert((select count(*) from attempt) = 0, 'audit log cannot be deleted');
with attempt as (update public.activities set title = 'tampered' returning 1)
select tests.assert((select count(*) from attempt) = 0, 'timeline cannot be rewritten');
with attempt as (delete from public.activities returning 1)
select tests.assert((select count(*) from attempt) = 0, 'timeline cannot be deleted');

-- Actor spoofing: cannot write a human activity attributed to someone else
select tests.login(:'uc');
select tests.assert_denied(
  format('insert into public.activities (org_id, contact_id, activity_type, title, actor_type, actor_user_id)
          values (%L, %L, %L, %L, %L, %L)',
         :'orga_id', :'contact_a', 'note', 'spoofed', 'human', :'ua'),
  'human activities must be attributed to the caller');

-- ---------------------------------------------------------------------------
-- KI-001: an org must always retain at least one owner
-- ---------------------------------------------------------------------------
select tests.login(:'ua');

select tests.assert_denied(
  format('update public.org_members set role = %L where org_id = %L and user_id = %L',
         'admin', :'orga_id', :'ua'),
  'sole owner cannot demote themselves');

select tests.assert_denied(
  format('delete from public.org_members where org_id = %L and user_id = %L',
         :'orga_id', :'ua'),
  'sole owner cannot remove themselves');

-- With a second owner present, ownership changes are allowed again
with promote as (
  update public.org_members set role = 'owner'
  where org_id = :'orga_id' and user_id = :'uc' returning 1)
select tests.assert((select count(*) from promote) = 1, 'owner can promote a second owner');
with demote as (
  update public.org_members set role = 'agent'
  where org_id = :'orga_id' and user_id = :'uc' returning 1)
select tests.assert((select count(*) from demote) = 1,
  'non-last owner can be demoted');

-- Deleting an entire organization still works (cascade is exempt from the guard)
select tests.login(:'ub');
select public.create_organization('Throwaway Org') as orgc_id
\gset
with del as (delete from public.organizations where id = :'orgc_id' returning 1)
select tests.assert((select count(*) from del) = 1,
  'org deletion cascades past the last-owner guard');

-- ---------------------------------------------------------------------------
-- Anonymous access: nothing visible, nothing writable
-- ---------------------------------------------------------------------------
select tests.login(null);
reset role;
set role anon;
select tests.assert((select count(*) from public.contacts) = 0, 'anon sees no contacts');
select tests.assert((select count(*) from public.organizations) = 0, 'anon sees no orgs');
select tests.assert((select count(*) from public.audit_log) = 0, 'anon sees no audit log');
select tests.assert_denied(
  'insert into public.organizations (name, created_by) values (''X'', gen_random_uuid())',
  'anon cannot create organizations');
select tests.assert_denied(
  'select public.create_organization(''Anon Org'')',
  'anon cannot create organizations via RPC');
reset role;

select 'ISOLATION SUITE PASSED' as result;
