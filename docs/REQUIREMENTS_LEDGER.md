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
  tests. Merge tooling VERIFIED: admin-only `merge_contacts` RPC (children move,
  fields fill, §29 attribution preserved, audit-logged) covered by
  `db/tests/03_merge_test.sql` + demo/e2e; assignee-membership guard (KI-005
  fix) covered there too. Supabase-backed UI path IMPLEMENTED — NOT YET
  VERIFIED (needs OA-002 + auth UI, KI-003).
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
  rules unit-tested in TS; form flow verified by e2e. Public-website capture
  VERIFIED at schema layer (KI-004 resolved): anon `capture_lead_public` with
  per-org form token, hourly rate cap, size caps — `db/tests/04_*`.
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
- **Phase:** P4 · **External:** providers (OA-004)
- **Impl:** foundation VERIFIED (schema layer): all outbound messages must pass
  through `queue_message` (SECURITY DEFINER; direct outbox inserts have no
  policy and are proven denied), which enforces consent-granted, kill switches,
  destination presence, idempotent replay, and audit logging — all covered by
  executed assertions in `db/tests/02_comms_export_test.sql`. Drain engine
  VERIFIED at unit level: adapter interface + `drainOutbox` worker (kill switch
  re-checked at send time, bounded retries, terminal-vs-transient failure
  classification, no silent drops) with 7 executed tests; §12 contract doc at
  `docs/contracts/email-sms.md`. Nothing sends yet: concrete provider adapters
  + the scheduled drain edge function are blocked on OA-004. Voice: NOT STARTED.
- **Files:** `supabase/migrations/00005_outbox_and_export.sql`, `db/tests/02_*`,
  `src/lib/comms/`, `docs/contracts/email-sms.md`

## MLS-001 — MLS provider interface
- **Phase:** P4 · **External:** MLS agreement · **Impl:** NOT STARTED

## TXN-001 — Transaction pipeline
- **Phase:** P4
- **Impl:** first slice VERIFIED (demo mode): create transaction (side, price,
  GCI, contact link), status progression with timeline events, pipeline view,
  §30-compliant Closed GCI metric (formula displayed, labeled ACTUAL). Unit +
  e2e tested; RLS on the table covered by the isolation approach (standard
  member policies). PENDING: key-date milestones, commission splits, closing
  checklist, J06 automation hooks.

## RPT-001 — Reporting / money metrics
- **Phase:** P5
- **Impl:** IN PROGRESS — first slices VERIFIED (demo): pipeline-by-stage +
  leads-by-original-source on the dashboard (actual counts, §29-immutable
  attribution — re-touches proven not to re-attribute), Closed GCI with visible
  formula labeled ACTUAL (§30) on Transactions. Executive dashboard/ROI (J10)
  pending.

## OPS-001 — Kill switches
- **Phase:** P1 · **Deps:** SEC-001
- **Impl:** VERIFIED (schema layer) — `org_settings` switches, admin-only writes
  enforced by RLS and covered by executed tests. Enforcement hooks into comms/AI
  execution paths land with those modules.

## OPS-002 — Audit log
- **Phase:** P1 · **Impl:** VERIFIED (schema layer) — append-only, tenant-scoped,
  no update/delete for members; covered by executed tests.

## DATA-001 — Data ownership / export
- **Phase:** P5
- **Impl:** VERIFIED (schema layer + demo UI): `export_org_data` returns the
  full org dataset (contacts, timeline, tasks, transactions, insights, outbox,
  audit trail, settings, members) as JSON; owner-only and cross-org denial
  proven by executed tests. Settings-page download button (owner-gated) in
  both API modes; live-Supabase path shares the standard OA-002 caveat.
  Large-org streaming export (edge function, chunked) is a future scale item.
