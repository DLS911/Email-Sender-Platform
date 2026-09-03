-- Migration 0013: curated items (Austin's manual pre-selections)
--
-- Austin curates lists of cars / drinks / books / products he wants
-- future Latte issues to pick from FIRST. When the writer runs, it
-- receives the active curated list per kind and MUST pick from it
-- when the list is non-empty; if all curated items for a kind have
-- been used, the writer falls back to the normal shelf / research
-- picking. Optional reference URLs let a curator pre-approve the
-- image the pipeline should use.
--
-- Status transitions:
--   active     — available for the writer to pick
--   used       — has been used in a published issue (marked by
--                cron flow after issue persistence)
--   archived   — curator no longer wants this item; hidden from
--                the writer but kept in the table for history

CREATE TABLE IF NOT EXISTS latte_curated_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                TEXT NOT NULL,        -- 'car' | 'drink' | 'book' | 'product'
  title               TEXT NOT NULL,
  normalized_title    TEXT NOT NULL,        -- lowercased, punctuation-stripped
  notes               TEXT,                 -- curator's optional note
  reference_url       TEXT,                 -- optional pre-approved image URL
  status              TEXT NOT NULL DEFAULT 'active',
                        -- 'active' | 'used' | 'archived'
  used_in_issue_date  DATE,                 -- populated when marked used
  added_by            TEXT,                 -- 'austin' | future admin id
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent adding the same item twice for the same kind. Duplicate
-- titles across kinds are fine (a bourbon called "Old Book" is a
-- different pick than the actual book).
CREATE UNIQUE INDEX IF NOT EXISTS ix_latte_curated_kind_norm
  ON latte_curated_items (kind, normalized_title);

CREATE INDEX IF NOT EXISTS ix_latte_curated_kind_status
  ON latte_curated_items (kind, status);

CREATE INDEX IF NOT EXISTS ix_latte_curated_status_created
  ON latte_curated_items (status, created_at DESC);
