-- Migration 0010: email_events table
--
-- Persistence for Resend webhook events (delivered / opened / clicked /
-- bounced / complained) plus the send tags that let us query by brand and
-- issue_date. Feeds the /engagement dashboard.
--
-- We tag every outbound send with { brand, issue_date } so the webhook can
-- record which newsletter and which day an event belongs to without a
-- secondary lookup. Tags are stored on the Resend message and echoed back
-- on every event webhook.

CREATE TABLE IF NOT EXISTS email_events (
  id                  BIGSERIAL PRIMARY KEY,
  provider_name       TEXT NOT NULL DEFAULT 'resend',
  provider_event_id   TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  event_at            TIMESTAMPTZ NOT NULL,
  email               TEXT NOT NULL,
  brand               TEXT,
  issue_date          DATE,
  resend_message_id   TEXT,
  bounce_type         TEXT,
  click_url           TEXT,
  raw_payload         JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT email_events_provider_event_unique
    UNIQUE (provider_name, provider_event_id)
);

-- Queries the dashboard runs:
--   1. Per-issue summary: SELECT ... WHERE brand=? AND issue_date=? GROUP BY event_type
--   2. Per-subscriber history: SELECT ... WHERE email=? ORDER BY event_at DESC
--   3. Recent activity feed: SELECT ... ORDER BY event_at DESC LIMIT N
CREATE INDEX IF NOT EXISTS email_events_brand_issue_idx
  ON email_events (brand, issue_date);
CREATE INDEX IF NOT EXISTS email_events_email_event_at_idx
  ON email_events (email, event_at DESC);
CREATE INDEX IF NOT EXISTS email_events_event_at_idx
  ON email_events (event_at DESC);
CREATE INDEX IF NOT EXISTS email_events_resend_message_id_idx
  ON email_events (resend_message_id)
  WHERE resend_message_id IS NOT NULL;

COMMENT ON TABLE email_events IS
  'Resend webhook events (delivered / opened / clicked / bounced / complained). Tagged with brand + issue_date at send time so the /engagement dashboard can query per-issue and per-subscriber without a secondary lookup.';
