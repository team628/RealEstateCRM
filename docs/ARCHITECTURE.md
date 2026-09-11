# ARCHITECTURE

## Layout

```
supabase/migrations/   SQL migrations (source of truth for schema + RLS + trusted logic)
db/tests/              executable RLS/tenant-isolation tests (run vs local PG16)
db/harness/            local-Postgres auth stub faithful to Supabase JWT mechanism
src/                   Lovable-compatible React app
  lib/domain/          pure domain logic (validation, attribution, scoring) — unit tested
  lib/supabase.ts      typed client (env-driven; absent env = demo/local mode)
  features/<area>/     feature modules (contacts, leads, ...) — components + hooks
  components/ui/       shadcn-style primitives
docs/                  governance docs (this directory)
```

## Trust boundaries

1. **Browser (untrusted).** Talks to Supabase with the user's JWT. RLS is the
   enforcement layer; the client is convenience only.
2. **Database (trusted).** RLS policies, constraints, triggers, `security definer`
   RPCs (`app.*` schema). All tenant scoping and role checks happen here via
   `app.is_org_member(org_id)` / `app.has_org_role(org_id, role)`.
3. **Edge functions (trusted).** Future home of AI orchestration, webhooks, provider
   adapters. Service-role usage always sets explicit org scoping.
4. **AI (untrusted input).** AI proposes actions into `ai_actions` with an
   idempotency key; trusted code validates (authorization, consent, kill switches,
   limits) then executes and marks status. AI never gets raw SQL execution.

## Tenancy

Every tenant table: `org_id uuid not null references organizations`. RLS enabled +
FORCED on all of them. Membership/roles in `org_members`. JWT → `auth.uid()` →
membership lookup. Policies never trust client-supplied org_id on reads; inserts
require membership in the target org.

## Kill switches (OPS-001)

`org_settings` row per org: `ai_enabled, automations_enabled, email_enabled,
sms_enabled, voice_enabled` + JSONB per-integration/per-workflow/per-agent
overrides. Writable by owner/admin only (RLS). Every execution path (comms send,
automation run, AI action execution) must check switches at execution time.

## Automation guardrails (AUTO-001)

`automation_runs` log with depth, action counts, correlation id. Org-level limits in
`org_settings.automation_limits` (max depth, max actions/run, max retries, dedup
window). Engine (P3) must refuse to exceed them; circuit breaker via kill switch.

## Attribution (LEAD-001, §29)

Contacts carry immutable `original_source*` columns (set once, trigger-protected)
and mutable `latest_source*` columns. Capture RPC is idempotent via
`lead_capture_requests(idempotency_key)`.

## AI provenance (§14)

`ai_insights` rows carry: kind, value, source ('AI INFERRED' etc.), confidence,
model, reasoning summary, created_at. AI inference never overwrites verified
contact fields; it writes insights that the UI displays alongside facts.

## Data export (DATA-001)

All tenant data reachable by org-scoped selects → export = per-table CSV/JSON dump
through an owner-only RPC/edge function (P5). No data hidden in provider-only
stores; provider adapters must sync canonical data back into Postgres.

## Environments (§20)

dev (local PG16 harness) → staging (Supabase project, preview deploy) → prod
(separate Supabase project). Never point local tests at prod. Migrations run via
Supabase CLI in CI order.
