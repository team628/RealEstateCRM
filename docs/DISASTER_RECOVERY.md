# DISASTER RECOVERY

Current phase: pre-deployment (no production environment exists yet). This document
states the plan that must be verified before production (OA-006).

- **Backups:** Supabase daily backups on paid tier; enable PITR for prod. VERIFY the
  actual plan tier capabilities at provisioning time — do not assume.
- **Restore drill:** before go-live, restore a backup into a scratch project and run
  `db/tests/` against it.
- **Migration recovery:** migrations are additive (D-005); every migration must apply
  cleanly to a fresh DB (verified continuously by the local harness, which rebuilds
  from zero on every test run). Destructive changes require the
  ADD→BACKFILL→VERIFY→SWITCH→REMOVE pattern with a rollback note in the migration header.
- **Failed deployment:** frontend deploys are atomic/rollbackable (static hosting).
  Schema: never deploy a frontend depending on a migration before the migration is live.
- **Integration outage:** provider adapters must degrade to queued/retry state, never
  drop data; canonical data lives in Postgres (see ARCHITECTURE §Data export).
- **Queue recovery:** automation/AI action tables persist state in Postgres, so
  crashed workers resume from status columns; no in-memory-only queues allowed.
- **Data corruption:** append-only audit + activities tables give reconstruction
  trails; org export (DATA-001) doubles as tenant-level snapshot.
