# Integration contract — outbound email & SMS (COMM-001)

Status: adapter interface + drain engine implemented and unit-verified; no
provider connected yet (OA-004). Fill the provider-specific rows when a
provider is chosen.

| Aspect | Contract |
|---|---|
| Provider | TBD — email (e.g. Resend/SendGrid), SMS (e.g. Twilio; A2P 10DLC required) |
| Authentication | API key via edge-function secret; never in the browser or repo |
| Outgoing data | `communication_outbox` rows only: destination, subject, body. §26: no other contact fields leave the CRM |
| Incoming data | delivery webhooks → update outbox row status; inbound replies (future) land as timeline activities |
| Enqueue path | ONLY `public.queue_message` (SQL): membership + consent-granted + kill switch + destination + idempotency enforced there; direct inserts are impossible (proven in db tests) |
| Drain path | scheduled edge function → `drainOutbox(rows, adapter, ctx)` (`src/lib/comms/drain.ts`): kill switch re-checked per org at send time; bounded retries from `org_settings.automation_limits.max_retries`; terminal failures marked `failed` with reason |
| Idempotency | `(org_id, idempotency_key)` unique at queue time; adapter must pass the key to the provider where supported |
| Rate limits | adapter classifies 429/timeouts as `retryable: true`; drain schedules bounded retries |
| Failure behavior | every row gets an explicit disposition (sent/retry/failed/skipped); failed rows are visible to members via outbox RLS |
| Data ownership | outbox rows live in Postgres and ship with `export_org_data` (DATA-001); the provider is never the system of record |
| Tenant mapping | `org_id` on every row; provider sub-accounts optional later |
| Health monitoring | failed-row counts feed the §23 feature-health surface (extend the Settings health panel when the adapter lands) |
| Kill switches | `org_settings.email_enabled` / `sms_enabled` + per-integration overrides — enforced at queue AND send time |
