# RealEstateCRM — session bootstrap

**Context recovery protocol (mandatory at session start):** read, in order:
`docs/MASTER_SPEC.md` (note its provenance banner), `docs/ARCHITECTURE.md`,
`docs/REQUIREMENTS_LEDGER.md` (authoritative completeness tracker),
`docs/BUILD_STATUS.md`, `docs/DECISIONS.md`, `docs/KNOWN_ISSUES.md`,
`docs/EXTERNAL_REQUIREMENTS.md`, `docs/OWNER_ACTIONS.md`. Then `git log` to find
the last checkpoint. The repository, not conversation memory, is the state.

**Verification commands** (all must pass before a checkpoint commit):

```bash
npm run typecheck && npm test && npm run build
npm run db:test        # needs local Postgres 16 — see db/harness/README.md
# optional browser smoke test: see e2e/README.md
```

**Non-negotiables** (from the execution directive; details in docs/):
- Tenant isolation lives in Postgres RLS, never only in app code. Every new
  tenant table: `org_id` FK + RLS enabled + forced + policies via
  `app.is_org_member` / `app.has_org_role`, and new assertions in `db/tests/`.
- AI output is untrusted input: AI proposes into `ai_actions`; trusted code
  validates (authorization, consent, `app.channel_enabled` kill switches,
  limits) and executes. Never raw SQL access for models.
- `original_*` attribution columns are write-once (trigger-enforced).
- Audit log and activities are append-only.
- Migrations are additive (see docs/DECISIONS.md D-005); each must apply
  cleanly from zero (db:test rebuilds every run).
- Frontend stays Lovable-compatible: Vite + React + TS + Tailwind, feature
  folders under `src/features/`, thin `src/lib/api` data layer, pure domain
  logic in `src/lib/domain` (unit-tested, mirrors the SQL rules).
- No status inflation: `VERIFIED` only after the check actually ran. Update
  REQUIREMENTS_LEDGER.md and BUILD_STATUS.md at every checkpoint.
