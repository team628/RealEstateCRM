-- COMM-001 / DATA-001 verification. Runs after 01_isolation_test.sql in the
-- same database and reuses its fixture (Org A: alice owner, carol agent;
-- Org B: bob; John Doe + Sally Seller contacts; sms kill switch left OFF).
\set ON_ERROR_STOP 1
set client_min_messages to warning;

-- Recover fixture ids as superuser (psql vars don't cross files)
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
-- COMM-001: consent is enforced in SQL — unknown consent blocks
-- ---------------------------------------------------------------------------
select tests.login(:'uc');
set role authenticated;

select tests.assert_denied(
  format('select public.queue_message(%L, %L, %L, %L)',
         :'contact_a', 'email', 'Hi John!', 'comm-key-000000001'),
  'unknown consent blocks email send');

-- Owner grants email consent; queueing then works and is idempotent
select tests.login(:'ua');
update public.contacts set email_consent = 'granted' where id = :'contact_a';

select tests.login(:'uc');
select public.queue_message(:'contact_a', 'email', 'Hi John!', 'comm-key-000000002',
                            'Your home valuation') as msg_id
\gset
select public.queue_message(:'contact_a', 'email', 'Hi John! (retry)', 'comm-key-000000002') as msg_id_replay
\gset
select tests.assert(:'msg_id_replay'::uuid = :'msg_id'::uuid,
  'identical idempotency key replays the same outbox row');
select tests.assert(
  (select count(*) from public.communication_outbox) = 1,
  'no duplicate outbox rows from replay');
select tests.assert(
  (select count(*) from public.audit_log where action = 'comm.queue') = 1,
  'queueing is audit-logged');

-- ---------------------------------------------------------------------------
-- §17: kill switch blocks the channel even with consent granted
-- (sms_enabled was switched off in 01_isolation_test.sql and is still off)
-- ---------------------------------------------------------------------------
select tests.login(:'ua');
update public.contacts set sms_consent = 'granted' where id = :'contact_a';

select tests.login(:'uc');
select tests.assert_denied(
  format('select public.queue_message(%L, %L, %L, %L)',
         :'contact_a', 'sms', 'Text hi', 'comm-key-000000003'),
  'sms kill switch blocks sends despite granted consent');

-- Owner re-enables sms; send now queues
select tests.login(:'ua');
update public.org_settings set sms_enabled = true where org_id = :'orga_id';
select tests.login(:'uc');
select public.queue_message(:'contact_a', 'sms', 'Text hi', 'comm-key-000000004') as sms_id
\gset
select tests.assert(
  (select status::text from public.communication_outbox where id = :'sms_id') = 'queued',
  'sms queues once switch is back on');

-- Revoked consent blocks again
select tests.login(:'ua');
update public.contacts set email_consent = 'revoked' where id = :'contact_a';
select tests.login(:'uc');
select tests.assert_denied(
  format('select public.queue_message(%L, %L, %L, %L)',
         :'contact_a', 'email', 'Hi again', 'comm-key-000000005'),
  'revoked consent blocks email send');

-- ---------------------------------------------------------------------------
-- Cross-tenant + bypass attempts
-- ---------------------------------------------------------------------------
select tests.login(:'ub');
select tests.assert_denied(
  format('select public.queue_message(%L, %L, %L, %L)',
         :'contact_a', 'email', 'sneaky', 'comm-key-000000006'),
  'non-member cannot queue messages to a foreign org contact');
select tests.assert(
  (select count(*) from public.communication_outbox) = 0,
  'foreign outbox rows are invisible cross-tenant');

-- Direct insert path is closed even for the org owner (only the RPC enforces
-- consent, so raw inserts must be impossible)
select tests.login(:'ua');
select tests.assert_denied(
  format('insert into public.communication_outbox (org_id, contact_id, channel, body, idempotency_key)
          values (%L, %L, %L, %L, %L)',
         :'orga_id', :'contact_a', 'email', 'bypass consent', 'comm-key-000000007'),
  'direct outbox inserts are denied — consent cannot be bypassed');

-- Agents cannot cancel; admins can
select tests.login(:'uc');
with attempt as (
  update public.communication_outbox set status = 'cancelled', status_reason = 'nope'
  where id = :'msg_id' returning 1)
select tests.assert((select count(*) from attempt) = 0, 'agents cannot cancel queued messages');

select tests.login(:'ua');
with attempt as (
  update public.communication_outbox set status = 'cancelled', status_reason = 'owner cancelled'
  where id = :'msg_id' returning 1)
select tests.assert((select count(*) from attempt) = 1, 'admins can cancel queued messages');

-- ---------------------------------------------------------------------------
-- DATA-001: export is owner-only and complete
-- ---------------------------------------------------------------------------
select tests.login(:'uc');
select tests.assert_denied(
  format('select public.export_org_data(%L)', :'orga_id'),
  'agents cannot export org data');

select tests.login(:'ub');
select tests.assert_denied(
  format('select public.export_org_data(%L)', :'orga_id'),
  'foreign owners cannot export another org');

select tests.login(:'ua');
select public.export_org_data(:'orga_id') as export
\gset
select tests.assert(
  jsonb_array_length((:'export')::jsonb -> 'contacts') = 2,
  'export contains all org contacts');
select tests.assert(
  jsonb_array_length((:'export')::jsonb -> 'communication_outbox') = 2,
  'export contains outbox rows');
select tests.assert(
  ((:'export')::jsonb -> 'settings' ->> 'org_id')::uuid = :'orga_id',
  'export contains org settings');
select tests.assert(
  jsonb_array_length((:'export')::jsonb -> 'audit_log') > 0,
  'export contains the audit trail');

reset role;
select 'COMMS + EXPORT SUITE PASSED' as result;
