# DECISIONS

Format: ID / date / decision / rationale / status.

## D-001 — 2026-09-11 — Stack: Vite + React + TS + Tailwind + shadcn/ui frontend, Supabase backend
The directive mandates Lovable survivability (§35), RLS-based tenant isolation, and
edge-function-style trusted execution. Lovable's native stack is exactly this;
Supabase provides Postgres RLS + Auth + Edge Functions. Choosing anything else would
break §35. **ACCEPTED.**

## D-002 — 2026-09-11 — Master spec derived from directive
Repository and remote were completely empty; the referenced product specification was
never committed. Rather than block the entire critical path (§32 says interrupt only
when genuinely blocked), MASTER_SPEC.md was derived from the directive's own
requirement IDs, journeys, and constraints, clearly marked as derived, with owner
review queued. **ACCEPTED — owner review pending (OA-001).**

## D-003 — 2026-09-11 — Local Postgres 16 + auth stub for RLS verification
No Supabase project exists yet and the sandbox cannot run supabase CLI stacks
reliably. A local Postgres 16 instance plus an `auth` schema stub that reads
`request.jwt.claims` GUCs (the same mechanism Supabase uses) lets tenant isolation be
*actually verified* now, with migrations that apply unchanged to real Supabase.
**ACCEPTED.**

## D-004 — 2026-09-11 — Trusted logic lives in SQL/RPC, thin typed client in frontend
Because the frontend talks to Supabase directly, anything security- or
integrity-relevant (tenant scoping, role checks, idempotency, kill-switch checks,
audit writes) is enforced in the database (RLS policies, constraints, triggers,
`security definer` RPCs) so a hostile client cannot bypass it. Frontend keeps a thin
`src/lib/` data layer. **ACCEPTED.**

## D-005 — 2026-09-11 — Additive migration policy
Backwards-compatible migrations preferred; destructive changes require the
ADD → BACKFILL → VERIFY → SWITCH → REMOVE pattern (§21). **ACCEPTED.**

## D-006 — 2026-09-11 — Org roles: owner > admin > agent > assistant
Modeled as an enum + `org_members` join table; role checks centralized in SQL helper
functions (`app.is_org_member`, `app.has_org_role`) reused by every policy, so role
logic exists in exactly one place. **ACCEPTED.**
