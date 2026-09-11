# BUILD STATUS

> Authoritative completeness tracker is `REQUIREMENTS_LEDGER.md`; this file is the
> session-level state for context recovery (§5).

## CURRENT PHASE
P1 Foundation → P2 CRM Core (in progress)

## LAST VERIFIED MILESTONE
*(updated at each checkpoint — see CHECKPOINTS below)*

## ACTIVE WORKSTREAM
Foundation bootstrap: schema+RLS, isolation test harness, lead-capture vertical slice.

## KNOWN FAILURES
See KNOWN_ISSUES.md.

## EXTERNAL BLOCKERS
None for current work. Future-phase items in EXTERNAL_REQUIREMENTS.md / OWNER_ACTIONS.md.

## NEXT HIGHEST-PRIORITY ACTION
Continue P2: contact merge/dedupe UI, tasks/notes UI, then AUTO-001 engine.

## CHECKPOINTS
- **CHECKPOINT 01 — Foundation Secure:** *(pending — requires: migrations apply from
  zero; RLS isolation suite passing; docs current; commit pushed)*
- **CHECKPOINT 02 — CRM Functional:** *(pending)*

## HOW TO RUN VERIFICATION LOCALLY
```
npm ci
npm run test          # domain unit tests (vitest)
npm run typecheck
npm run build
npm run db:test       # rebuilds schema from zero on local PG16 + runs RLS suite
                      # (see db/harness/README.md for one-time local PG setup)
```
