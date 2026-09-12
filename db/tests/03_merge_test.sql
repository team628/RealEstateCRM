-- KI-005 (assignee membership) + merge_contacts verification.
-- Runs after 01/02 in the same database, reusing their fixture.
\set ON_ERROR_STOP 1
set client_min_messages to warning;

select id as ua from auth.users where email = 'alice@a.test'
\gset
select id as ub from auth.users where email = 'bob@b.test'
\gset
select id as uc from auth.users where email = 'carol@a.test'
\gset
select id as orga_id from public.organizations where name = 'Org A'
\gset
select id as contact_a from public.contacts where email = 'john@example.com'
\gset

-- ---------------------------------------------------------------------------
-- KI-005: assignees must be org members
-- ---------------------------------------------------------------------------
select tests.login(:'ua');
set role authenticated;

select tests.assert_denied(
  format('update public.contacts set assigned_to = %L where id = %L', :'ub', :'contact_a'),
  'cannot assign a contact to a non-member');

with attempt as (
  update public.contacts set assigned_to = :'uc' where id = :'contact_a' returning 1)
select tests.assert((select count(*) from attempt) = 1,
  'assigning to an org member works');

select tests.assert_denied(
  format('insert into public.tasks (org_id, title, assigned_to) values (%L, %L, %L)',
         :'orga_id', 'bad assignee', :'ub'),
  'cannot create a task assigned to a non-member');

-- ---------------------------------------------------------------------------
-- Merge fixture: two fresh contacts with children
-- ---------------------------------------------------------------------------
select tests.login(:'uc');
select public.capture_lead(:'orga_id', 'merge-key-000000001', 'Morgan', 'Mixed',
  'merge1@example.com', null, 'website', null, '{}'::jsonb, null, null,
  'Interested in selling next spring') as survivor_id
\gset
select public.capture_lead(:'orga_id', 'merge-key-000000002', '', 'Mixed',
  null, '555-303-4444', 'sign_call') as duplicate_id
\gset

insert into public.activities (org_id, contact_id, actor_type, actor_user_id, activity_type, title, body)
values (:'orga_id', :'duplicate_id', 'human', :'uc', 'note', 'Note', 'Called from the yard sign');
insert into public.tasks (org_id, contact_id, title) values (:'orga_id', :'duplicate_id', 'Call back');

select count(*) as dup_activity_count from public.activities where contact_id = :'duplicate_id'
\gset

-- ---------------------------------------------------------------------------
-- Authorization: agents, foreign orgs, self-merge all denied
-- ---------------------------------------------------------------------------
select tests.assert_denied(
  format('select public.merge_contacts(%L, %L)', :'survivor_id', :'duplicate_id'),
  'agents cannot merge contacts');

select tests.login(:'ub');
select tests.assert_denied(
  format('select public.merge_contacts(%L, %L)', :'survivor_id', :'duplicate_id'),
  'non-members cannot merge foreign contacts');

select tests.login(:'ua');
select tests.assert_denied(
  format('select public.merge_contacts(%L, %L)', :'survivor_id', :'survivor_id'),
  'self-merge is rejected');

-- ---------------------------------------------------------------------------
-- Admin merge: children move, fields fill, attribution preserved
-- ---------------------------------------------------------------------------
select public.merge_contacts(:'survivor_id', :'duplicate_id');

select tests.assert(
  (select count(*) from public.contacts where id = :'duplicate_id') = 0,
  'duplicate contact is removed');
select tests.assert(
  (select phone from public.contacts where id = :'survivor_id') = '555-303-4444',
  'missing phone filled from the duplicate');
select tests.assert(
  (select email from public.contacts where id = :'survivor_id') = 'merge1@example.com',
  'survivor email retained');
select tests.assert(
  (select original_source from public.contacts where id = :'survivor_id') = 'website',
  'survivor original attribution preserved through merge (§29)');
select tests.assert(
  (select latest_source from public.contacts where id = :'survivor_id') = 'sign_call',
  'latest touch reflects the most recent capture');
select tests.assert(
  (select count(*) from public.activities where contact_id = :'survivor_id'
    and title = 'Note') = 1,
  'duplicate timeline entries moved to the survivor');
select tests.assert(
  (select count(*) from public.activities where contact_id = :'survivor_id'
    and title = 'Contacts merged') = 1,
  'merge itself is recorded on the timeline');
select tests.assert(
  (select count(*) from public.tasks where contact_id = :'survivor_id'
    and title = 'Call back') = 1,
  'tasks moved to the survivor');
select tests.assert(
  (select count(*) from public.audit_log where action = 'contact.merge') = 1,
  'merge is audit-logged');

reset role;
select 'MERGE SUITE PASSED' as result;
