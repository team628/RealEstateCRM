# BUILD STATUS

> Authoritative completeness tracker is `REQUIREMENTS_LEDGER.md`; this file is the
> session-level state for context recovery (§5).

## CURRENT PHASE
P1 Foundation → P2 CRM Core (in progress)

## LAST VERIFIED MILESTONE
CHECKPOINT 04 (2026-09-11): CRM core + automation engine + AI classification
pipeline + consent-enforced comms outbox + org data export + transactions slice
+ §14 provenance guard. Verification executed: typecheck ✓, 56 unit tests ✓,
production build ✓, db:test (isolation + comms/export suites, 6 migrations from
zero) ✓, browser e2e smoke (28 checks, zero console errors) ✓.

## ACTIVE WORKSTREAM
Foundation bootstrap: schema+RLS, isolation test harness, lead-capture vertical slice.

## KNOWN FAILURES
See KNOWN_ISSUES.md.

## EXTERNAL BLOCKERS
None for current work. Future-phase items in EXTERNAL_REQUIREMENTS.md / OWNER_ACTIONS.md.

## NEXT HIGHEST-PRIORITY ACTION
1. When OA-002 lands (Supabase project): apply the 8 migrations, verify auth
   flow, capture RPCs, and the AI edge function live — the single biggest unlock.
2. Property search UI over the MLS interface (demo-verifiable via fake
   provider; J02 groundwork) + saved buyer criteria on contacts.
3. Transaction milestones (key_dates) + commission splits.
4. Populate AI evaluation scenario cases (docs/AI_EVALUATIONS.md suite 1) as a
   runnable script, executable once OA-003 provides a key.
5. Concrete comms provider adapters when OA-004 lands (engine is ready).

## CHECKPOINTS
- **CHECKPOINT 01 — Foundation Secure: DONE 2026-09-11** (commit 19b2718).
  Migrations apply from zero; RLS isolation suite passing; docs current; pushed.
- **CHECKPOINT 02 — CRM Functional (demo mode): DONE 2026-09-11.**
  Lead capture → contact → timeline → assignment → stage/notes → kill-switch UI,
  verified by unit tests + browser e2e in demo mode. Supabase-backed mode is
  implemented but UNVERIFIED until a project exists (OA-002) — no auth UI yet.
- **CHECKPOINT 02b — 2026-09-11:** KI-001 fixed (owner guard, verified in db suite);
  auth + org onboarding UI for Supabase mode (implemented, live-unverified — KI-003);
  Tasks feature end-to-end in demo mode (unit + e2e verified). e2e now 17 checks.
- **CHECKPOINT 03 (partial) — 2026-09-11:** AUTO-001 engine core verified: pure
  workflow engine (kill switches, dedup, loop protection incl. recursive-chain
  termination, action budgets, run log) + first workflow "new_lead_followup"
  live in demo mode. 44 unit tests, 18 e2e checks, db suite all passing.
- **CHECKPOINT 04 — 2026-09-11:** AI-001 classification pipeline (injection
  fencing, PII minimization, provenance, kill-switch gate) verified in demo;
  edge function implemented-unverified. COMM-001 outbox with SQL-enforced
  consent + switches and DATA-001 owner-only export both verified by the DB
  suite. Contact editing + automation health view live.

## HOW TO RUN VERIFICATION LOCALLY
```
npm ci
npm run test          # domain unit tests (vitest)
npm run typecheck
npm run build
npm run db:test       # rebuilds schema from zero on local PG16 + runs RLS suite
                      # (see db/harness/README.md for one-time local PG setup)
```
