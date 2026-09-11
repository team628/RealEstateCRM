# REQUIREMENTS LEDGER — authoritative completeness tracker

Statuses:
- Implementation: `NOT STARTED` | `IN PROGRESS` | `IMPLEMENTED — NOT YET VERIFIED` | `VERIFIED`
- Terminal classification (per requirement, at release): `PRODUCTION READY` |
  `FUNCTIONALLY COMPLETE — EXTERNAL CONNECTION REQUIRED` | `BLOCKED — OWNER ACTION REQUIRED` |
  `DEFERRED — DOCUMENTED TECHNICAL REASON` | `REJECTED`

Phases: P1 Foundation → P2 CRM Core → P3 Intelligence/Automation → P4 Comms/MLS/Txn → P5 Reporting/Polish

---

## SEC-001 — Tenant isolation (RLS)
- **Phase:** P1 · **Deps:** none · **External:** Supabase project (for prod deploy only)
- **Impl:** VERIFIED (schema layer) — RLS on all tenant tables; cross-tenant read/write
  and privilege-escalation attempts blocked in executed tests.
- **Tests:** `db/tests/` suite runs against real Postgres 16 with Supabase-identical
  JWT-claim mechanism. See BUILD_STATUS for latest run.
- **Security:** RLS forced (`FORCE ROW LEVEL SECURITY`), helper fns `security definer`
  with locked search_path.
- **Files:** `supabase/migrations/*.sql`, `db/tests/*`
- **DB objects:** all tenant tables + policies; `app.is_org_member`, `app.has_org_role`
- **Acceptance:** a user in org A can never read/write org B rows via any table or RPC;
  role checks enforced; anon has no access to tenant data.

## CRM-001 — Unified contact record
- **Phase:** P2 · **Deps:** SEC-001
- **Impl:** VERIFIED (schema + demo mode): schema verified by db:test; UI
  list/detail verified by browser e2e; dedupe rules verified in SQL suite + unit
  tests. Supabase-backed UI path IMPLEMENTED — NOT YET VERIFIED (needs OA-002 +
  auth UI, KI-003). Merge tooling pending.
- **Tests:** db/tests suite ✓, unit tests ✓, e2e/smoke.mjs ✓
- **Files:** `supabase/migrations/`, `src/features/contacts/`, `src/lib/domain/lead.ts`
- **Acceptance:** one contact row unifies identity, attribution, consent flags, stage;
  timeline attached; dedupe on email/phone within org.

## CRM-002 — Activity timeline
- **Phase:** P2 · **Deps:** CRM-001
- **Impl:** VERIFIED (schema + demo mode): append-only enforcement + actor
  attribution verified in db:test; timeline UI (capture/assignment/note/
  stage-change) verified by e2e. Same Supabase-UI caveat as CRM-001.
- **Acceptance:** immutable, ordered, typed activity stream per contact incl. system,
  human, and AI-attributed entries.

## LEAD-001 — Lead capture + attribution integrity
- **Phase:** P2 · **Deps:** CRM-001
- **Impl:** VERIFIED (SQL + demo mode): idempotent replay, email/phone dedupe,
  immutable original attribution, audit logging — all asserted in db:test; same
  rules unit-tested in TS; form flow verified by e2e. Public-website capture path
  pending (KI-004).
- **Acceptance:** §29 — original source/UTM preserved forever; latest source updated;
  idempotent capture (no dup contacts from double-submit).

## LEAD-002 — Lead routing/assignment
- **Phase:** P2 · **Deps:** LEAD-001
- **Impl:** VERIFIED (SQL + demo mode): round-robin distribution asserted in
  db:test and unit tests; assignment activity on timeline verified by e2e.

## AI-001 — AI provider abstraction
- **Phase:** P3 · **Deps:** SEC-001 · **External:** Anthropic API key (OA-003)
- **Impl:** split status:
  - VERIFIED (pipeline + defenses, demo mode): provider contract with schema-
    validated output; §25 injection fencing (marker-smuggling neutralized, tested);
    §26 PII minimization (only presence flags + fenced message leave the CRM,
    tested); §17 kill-switch gate incl. per-agent override (tested); §14
    provenance-tagged ai_insights that never overwrite contact facts (tested);
    UI card with confidence display (e2e).
  - IMPLEMENTED — NOT YET VERIFIED: `supabase/functions/ai-classify-lead`
    (Claude via official SDK, structured outputs, RLS-scoped user client,
    refusal handling). Needs a Supabase project + ANTHROPIC_API_KEY to verify,
    then real-model evaluation per docs/AI_EVALUATIONS.md before production.
- **Files:** `src/lib/ai/*`, `supabase/functions/ai-classify-lead/`,
  `supabase/migrations/00004_channel_enabled_rpc.sql`

## AI-002 — AI Sales Agent
- **Phase:** P3 · **Deps:** AI-001, AUTO-001, COMM-001 · **Impl:** NOT STARTED
- **Note:** action-request pattern + ai_actions idempotency table already in schema.

## AUTO-001 — Workflow/automation engine
- **Phase:** P3 · **Deps:** SEC-001
- **Impl:** VERIFIED (engine core + demo mode): pure `processEvent` engine with
  kill-switch gate, dedup window, depth/retry/action-budget guardrails, run
  recording; loop-protection proven by executed tests (self-triggering workflow
  terminates at max_depth). First workflow (new-lead follow-up task) verified in
  demo mode + browser e2e. PENDING for production: server-side execution host
  (edge function/DB trigger), workflow configuration UI, retry scheduling.
- **Files:** `src/lib/domain/workflow.ts`, `src/lib/domain/automation.ts`,
  `src/lib/api/demo.ts`; schema: `automation_runs`, `org_settings.automation_limits`.

## COMM-001 — Communications (email/SMS/voice)
- **Phase:** P4 · **External:** providers · **Impl:** NOT STARTED
  (consent flags on contacts + kill switches landed)

## MLS-001 — MLS provider interface
- **Phase:** P4 · **External:** MLS agreement · **Impl:** NOT STARTED

## TXN-001 — Transaction pipeline
- **Phase:** P4 · **Impl:** NOT STARTED (schema stub landed: transactions table)

## RPT-001 — Reporting / money metrics
- **Phase:** P5 · **Impl:** NOT STARTED

## OPS-001 — Kill switches
- **Phase:** P1 · **Deps:** SEC-001
- **Impl:** VERIFIED (schema layer) — `org_settings` switches, admin-only writes
  enforced by RLS and covered by executed tests. Enforcement hooks into comms/AI
  execution paths land with those modules.

## OPS-002 — Audit log
- **Phase:** P1 · **Impl:** VERIFIED (schema layer) — append-only, tenant-scoped,
  no update/delete for members; covered by executed tests.

## DATA-001 — Data ownership / export
- **Phase:** P5 · **Impl:** NOT STARTED (documented in ARCHITECTURE.md)
