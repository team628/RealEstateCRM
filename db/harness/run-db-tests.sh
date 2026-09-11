#!/usr/bin/env bash
# Rebuilds the schema FROM ZERO on a local Postgres and runs the executable
# RLS/tenant-isolation suite. This is the verification gate for SEC-001.
#
# One-time local setup (any Postgres 16 works):
#   initdb + pg_ctl start, or: docker run -e POSTGRES_HOST_AUTH_METHOD=trust \
#     -p 54322:5432 postgres:16
# Then: PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres npm run db:test
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=54322}"
: "${PGUSER:=postgres}"
export PGHOST PGPORT PGUSER
DB=realestatecrm_test

echo "==> Recreating database ${DB} on ${PGHOST}:${PGPORT}"
psql -v ON_ERROR_STOP=1 -q -d postgres \
  -c "drop database if exists ${DB};" \
  -c "create database ${DB};"

echo "==> Applying harness auth stub"
psql -v ON_ERROR_STOP=1 -q -d "${DB}" -f db/harness/00-roles-auth-stub.sql

echo "==> Applying migrations from zero"
for f in supabase/migrations/*.sql; do
  echo "    - ${f}"
  psql -v ON_ERROR_STOP=1 -q -d "${DB}" -f "${f}"
done

echo "==> Applying Supabase-equivalent grants"
psql -v ON_ERROR_STOP=1 -q -d "${DB}" -f db/harness/99-grants.sql

echo "==> Running DB test suite"
for t in db/tests/*.sql; do
  echo "    - ${t}"
  psql -v ON_ERROR_STOP=1 -q -d "${DB}" -f "${t}"
done

echo "ALL DB TESTS PASSED"
