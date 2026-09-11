# BUILD STATUS

> Authoritative completeness tracker is `REQUIREMENTS_LEDGER.md`; this file is the
> session-level state for context recovery (§5).

## CURRENT PHASE
P1 Foundation → P2 CRM Core (in progress)

## LAST VERIFIED MILESTONE
CHECKPOINT 02 (2026-09-11): CRM vertical slice functional and verified end-to-end
in demo mode; DB layer verified by isolation suite. Verification executed:
typecheck ✓, 32 unit tests ✓, production build ✓, db:test isolation suite ✓,
browser e2e smoke (13 checks, zero console errors) ✓.

## ACTIVE WORKSTREAM
Foundation bootstrap: schema+RLS, isolation test harness, lead-capture vertical slice.

## KNOWN FAILURES
See KNOWN_ISSUES.md.

## EXTERNAL BLOCKERS
None for current work. Future-phase items in EXTERNAL_REQUIREMENTS.md / OWNER_ACTIONS.md.

## NEXT HIGHEST-PRIORITY ACTION
1. AUTO-001 workflow engine using the tested guardrail functions (first workflow:
   new-lead follow-up task).
2. Contact merge tooling; contact type/consent editing UI.
3. Verify auth flow live the moment OA-002 provides a Supabase project.

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
- **CHECKPOINT 03 — Opportunity Intelligence Functional:** *(pending)*

## HOW TO RUN VERIFICATION LOCALLY
```
npm ci
npm run test          # domain unit tests (vitest)
npm run typecheck
npm run build
npm run db:test       # rebuilds schema from zero on local PG16 + runs RLS suite
                      # (see db/harness/README.md for one-time local PG setup)
```
