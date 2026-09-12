-- KI-004 verification: anonymous website capture is token-gated, rate-capped,
-- size-capped, and the capture core is unreachable except via the wrappers.
\set ON_ERROR_STOP 1
set client_min_messages to warning;

select id as ua from auth.users where email = 'alice@a.test'
\gset
select id as orga_id from public.organizations where name = 'Org A'
\gset
select public_form_token as form_token from public.org_settings where org_id = :'orga_id'
\gset
select count(*) as recent_captures from public.lead_capture_requests
 where org_id = :'orga_id' and created_at > now() - interval '1 hour'
\gset

-- ---------------------------------------------------------------------------
-- Anonymous captures
-- ---------------------------------------------------------------------------
select tests.login(null);
set role anon;

select tests.assert_denied(
  format('select public.capture_lead_public(%L, %L, %L, null, null, %L)',
         :'orga_id', gen_random_uuid(), 'pub-key-000000001', 'evil@x.test'),
  'wrong form token is rejected');

select tests.assert(
  (select count(*) from public.org_settings) = 0,
  'form token is not readable anonymously');

select public.capture_lead_public(:'orga_id', :'form_token', 'pub-key-000000002',
  'Wanda', 'Web', 'wanda@example.com', null, 'website', 'home-valuation',
  '{"utm_source":"google"}'::jsonb, null, '/home-value',
  'What could I list my house for?') as pub_contact
\gset

select public.capture_lead_public(:'orga_id', :'form_token', 'pub-key-000000002',
  'Wanda', 'Web', 'wanda@example.com') as pub_contact_replay
\gset
select tests.assert(:'pub_contact_replay'::uuid = :'pub_contact'::uuid,
  'anonymous capture replays idempotently');

select tests.assert_denied(
  format('select public.capture_lead_public(%L, %L, %L, null, null, %L, null, null, null, %L::jsonb)',
         :'orga_id', :'form_token', 'pub-key-000000003', 'big@x.test',
         (select jsonb_build_object('k', repeat('x', 5000))::text)),
  'oversized anonymous payloads are rejected');

-- The capture core is not directly callable by API roles
select tests.assert_denied(
  format('select app.do_capture_lead(%L, %L, null, null, %L, null, %L, null, %L::jsonb, null, null, null, null)',
         :'orga_id', 'pub-key-000000004', 'sneak@x.test', 'website', '{}'),
  'capture core is unreachable without a wrapper');

reset role;

-- Verify what the anonymous capture produced (as superuser)
select tests.assert(
  (select assigned_to from public.contacts where id = :'pub_contact') is not null,
  'anonymous lead is round-robin assigned');
select tests.assert(
  (select original_source from public.contacts where id = :'pub_contact') = 'website',
  'anonymous lead carries attribution');
select tests.assert(
  (select actor_type::text from public.audit_log
    where entity_id = :'pub_contact'::text and action = 'lead.capture'
    order by created_at desc limit 1) = 'system',
  'anonymous capture is audit-logged as system actor');

-- ---------------------------------------------------------------------------
-- Hourly rate cap, fail closed
-- ---------------------------------------------------------------------------
select tests.login(:'ua');
set role authenticated;
update public.org_settings
   set automation_limits = jsonb_set(automation_limits, '{max_public_captures_per_hour}',
                                     to_jsonb((:'recent_captures')::int + 1))
 where org_id = :'orga_id';

select tests.login(null);
reset role;
set role anon;
select tests.assert_denied(
  format('select public.capture_lead_public(%L, %L, %L, null, null, %L)',
         :'orga_id', :'form_token', 'pub-key-000000005', 'overcap@x.test'),
  'hourly public capture cap is enforced');
reset role;

-- restore the default cap
select tests.login(:'ua');
set role authenticated;
update public.org_settings
   set automation_limits = automation_limits - 'max_public_captures_per_hour'
 where org_id = :'orga_id';
reset role;

select 'PUBLIC CAPTURE SUITE PASSED' as result;
