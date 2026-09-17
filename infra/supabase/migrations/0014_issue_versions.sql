-- Migration 0014: newsletter_issue_versions — append-only snapshot table
--
-- Both Latte + DG store one row per issue_date in their respective
-- tables (saturday_latte_issues / daily_grind_issues). Any regenerate,
-- rewrite-passage, rewrite-issue, or regenerate-slot call OVERWRITES
-- the html / text_body / subject / sections of that row. Prior to this
-- migration, every prior version of an issue was permanently lost the
-- moment the next mutation happened.
--
-- This table snapshots every version. Rows are INSERT-only — never
-- updated (except to attach a preview_resend_id or an ac campaign id
-- after the fact) and never deleted. Ordering within a (brand,
-- issue_date) uses version_seq (1, 2, 3, ...) — assigned by the app
-- at insert time.
--
-- The main issue rows still exist and still hold the *current* copy
-- (queried by cron, review UI, and AC push). This table is the
-- history / recovery layer.

CREATE TABLE IF NOT EXISTS newsletter_issue_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand               TEXT NOT NULL,           -- 'latte' | 'daily-grind'
  issue_date          DATE NOT NULL,
  version_seq         INTEGER NOT NULL,        -- 1, 2, 3, ...
  subject             TEXT,
  headline            TEXT,
  preheader           TEXT,
  html                TEXT NOT NULL,
  text_body           TEXT,
  sections            JSONB,
  generation_meta     JSONB,
  source              TEXT NOT NULL,           -- 'generate' | 'regenerate_slot' | 'rewrite_passage' | 'rewrite_issue'
  source_note         TEXT,                    -- slot key + criticism, or passage fieldPath, etc.
  preview_resend_id   TEXT,                    -- attached after preview email lands
  ac_campaign_id      TEXT,                    -- attached after AC push
  ac_message_id       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_niv_brand_date_seq
  ON newsletter_issue_versions (brand, issue_date, version_seq);

CREATE INDEX IF NOT EXISTS ix_niv_brand_date_created
  ON newsletter_issue_versions (brand, issue_date, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_niv_created
  ON newsletter_issue_versions (created_at DESC);
