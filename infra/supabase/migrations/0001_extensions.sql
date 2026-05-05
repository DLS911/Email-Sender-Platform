-- Required extensions.
-- pgvector powers embedding similarity for the brain.
-- pgcrypto for gen_random_uuid (Supabase has it but we declare for clarity).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
