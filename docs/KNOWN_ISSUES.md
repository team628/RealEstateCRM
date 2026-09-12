# KNOWN ISSUES


- **KI-002 (P6, performance):** Main JS bundle is ~560 kB minified (React + supabase
  + react-query in one chunk). Add route-level code splitting when the app grows.
- **KI-003 (P2, partially resolved):** Sign-in/sign-up, org-creation onboarding and
  sign-out are now built for Supabase mode, but remain UNVERIFIED against a live
  Supabase project (none exists — OA-002). Demo mode is unaffected. Verify the full
  auth flow as the first action once a project is provisioned.

## Resolved
- **KI-001** (last-owner removal) — fixed by `00003_owner_guard.sql`, covered by
  executed assertions in `db/tests/01_isolation_test.sql`.
- **KI-004** (no public capture path) — resolved by `00008_public_capture.sql`:
  anon-callable `capture_lead_public` gated by a per-org secret form token, an
  hourly rate cap, and input size caps; capture core unreachable except via the
  wrappers (PUBLIC execute revoked — default-grant pitfall caught by the suite).
  Covered by `db/tests/04_public_capture_test.sql`.
- **KI-005** (non-member assignees) — fixed by `00007_assignee_guard_and_merge.sql`
  (membership-validating triggers on contacts/tasks/transactions, change-only so
  rows with since-removed members stay editable), covered by `db/tests/03_merge_test.sql`.
