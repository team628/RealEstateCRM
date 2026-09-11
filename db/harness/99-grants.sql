-- Emulates Supabase's default privileges for the API roles: broad GRANTs with
-- Row-Level Security as the actual gate. This mirrors production exactly —
-- Supabase grants table access to anon/authenticated and relies on RLS.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
