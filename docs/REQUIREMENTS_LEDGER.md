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
- **Impl:** IMPLEMENTED — NOT YET VERIFIED (schema + UI list/detail; merge/dedupe pending)
- **Tests:** domain unit tests (validation/normalization) passing; e2e pending
- **Files:** `supabase/migrations/`, `src/features/contacts/`, `src/lib/domain/contact.ts`
- **Acceptance:** one contact row unifies identity, attribution, consent flags, stage;
  timeline attached; dedupe on email/phone within org.

## CRM-002 — Activity timeline
- **Phase:** P2 · **Deps:** CRM-001
- **Impl:** IMPLEMENTED — NOT YET VERIFIED (append-only activities table + UI)
- **Acceptance:** immutable, ordered, typed activity stream per contact incl. system,
  human, and AI-attributed entries.

## LEAD-001 — Lead capture + attribution integrity
- **Phase:** P2 · **Deps:** CRM-001
- **Impl:** IMPLEMENTED — NOT YET VERIFIED (capture RPC w/ idempotency + attribution rules)
- **Tests:** attribution unit tests (original source never overwritten) passing
- **Acceptance:** §29 — original source/UTM preserved forever; latest source updated;
  idempotent capture (no dup contacts from double-submit).

## LEAD-002 — Lead routing/assignment
- **Phase:** P2 · **Deps:** LEAD-001 · **Impl:** IMPLEMENTED — NOT YET VERIFIED
  (round-robin assignment inside capture RPC; audit-logged)

## AI-001 — AI provider abstraction
- **Phase:** P3 · **Deps:** SEC-001 · **External:** provider API keys
- **Impl:** NOT STARTED (contract defined in ARCHITECTURE.md §AI)

## AI-002 — AI Sales Agent
- **Phase:** P3 · **Deps:** AI-001, AUTO-001, COMM-001 · **Impl:** NOT STARTED
- **Note:** action-request pattern + ai_actions idempotency table already in schema.

## AUTO-001 — Workflow/automation engine
- **Phase:** P3 · **Deps:** SEC-001 · **Impl:** IN PROGRESS
  (guardrail settings + kill switches + execution log schema landed; engine pending)

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
