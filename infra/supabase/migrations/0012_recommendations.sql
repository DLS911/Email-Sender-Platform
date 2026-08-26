-- Migration 0012: recommendations table (permanent recall across issues)
--
-- Every generated newsletter issue is walked by an extractor after
-- persistence and every recommendation it contains is written here as
-- a single row keyed by (brand, kind, normalized_value). Loaders use
-- this as the writer's exclusion memory so nothing is ever
-- re-recommended.
--
-- One row per unique recommendation ever made. The unique index on
-- (brand, kind, normalized_value) makes upserts idempotent — running
-- the extractor twice on the same issue is a no-op.

CREATE TABLE IF NOT EXISTS latte_recommendations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand             TEXT NOT NULL,        -- 'saturday_latte' | 'daily_grind'
  kind              TEXT NOT NULL,        -- see kind list in extractor
  value             TEXT NOT NULL,        -- canonical human form
  normalized_value  TEXT NOT NULL,        -- lowercased, punctuation-stripped
  context           TEXT,                 -- optional (section slot, label)
  issue_date        DATE NOT NULL,        -- issue that introduced it
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_latte_recs_brand_kind_norm
  ON latte_recommendations (brand, kind, normalized_value);

CREATE INDEX IF NOT EXISTS ix_latte_recs_brand_created
  ON latte_recommendations (brand, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_latte_recs_brand_issue
  ON latte_recommendations (brand, issue_date DESC);
