# DB verification harness

Runs `supabase/migrations/*.sql` from zero against a real local Postgres 16 and
executes the RLS/tenant-isolation suite in `db/tests/`.

Why this is faithful to production: Supabase enforces tenancy through Postgres RLS
keyed on `auth.uid()`, which reads the `request.jwt.claims` setting. The harness
stubs exactly that mechanism (`00-roles-auth-stub.sql`) and applies the same broad
GRANTs Supabase applies (`99-grants.sql`), so a policy hole here is a policy hole in
production and vice versa. The stub is never applied to a real Supabase project.

## Run

```bash
# one-time: any local Postgres 16 with trust auth, e.g.
docker run -d -e POSTGRES_HOST_AUTH_METHOD=trust -p 54322:5432 postgres:16
# then
npm run db:test
```

Defaults: `PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres` (override via env).
The test database `realestatecrm_test` is dropped and recreated on every run.
