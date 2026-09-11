# KNOWN ISSUES

- **KI-001 (P3, correctness):** Nothing prevents removing/demoting the last owner of
  an organization (noted in 00001_foundation.sql). Fix: trigger guarding the final
  owner row. Not exploitable cross-tenant.
- **KI-002 (P6, performance):** Main JS bundle is ~554 kB minified (React + supabase
  + react-query in one chunk). Add route-level code splitting when the app grows.
- **KI-003 (P2, gap):** Supabase mode has no sign-in/sign-up UI or org-creation
  onboarding yet — the app is only usable in demo mode until built. Scheduled as
  next workstream (see BUILD_STATUS).
- **KI-004 (P4, gap):** `capture_lead` requires an authenticated org member; public
  website forms will need an edge-function wrapper (service role + explicit org
  scoping + rate limiting) when the public site lands.
