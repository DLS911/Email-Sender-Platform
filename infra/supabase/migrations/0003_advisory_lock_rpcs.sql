-- Advisory lock RPCs for per-brand pipeline serialization.
-- Spec 01_foundation requires that two pipeline runs of the same brand
-- cannot race the brain. We use Postgres advisory locks scoped by an
-- integer key derived from the brand id (computed in app code).

CREATE OR REPLACE FUNCTION pg_advisory_lock(key int)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_lock(key::bigint);
END;
$$;

CREATE OR REPLACE FUNCTION pg_advisory_unlock(key int)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN pg_advisory_unlock(key::bigint);
END;
$$;

GRANT EXECUTE ON FUNCTION pg_advisory_lock(int) TO service_role;
GRANT EXECUTE ON FUNCTION pg_advisory_unlock(int) TO service_role;
