-- 0007: Daily Grind test send infrastructure
--
-- Two tables to support a recurring test that fires the Daily Grind newsletter
-- via Resend to a small set of internal subscribers at 10 AM each one's local time.
-- This is pre-Phase-1 scaffolding to prove the end-to-end pipeline plumbing while
-- the proper sends / send_events / pipeline_runs tables stay reserved for the
-- real subscriber list arriving via the ActiveCampaign import.

CREATE TABLE daily_grind_test_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text,
  timezone text NOT NULL DEFAULT 'America/New_York',
  send_at_hour_local smallint NOT NULL DEFAULT 10 CHECK (send_at_hour_local BETWEEN 0 AND 23),
  active boolean NOT NULL DEFAULT true,
  last_sent_issue_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE INDEX idx_daily_grind_test_subscribers_active ON daily_grind_test_subscribers(active) WHERE active = true;

CREATE TABLE daily_grind_issues (
  issue_date date PRIMARY KEY,
  subject text NOT NULL,
  headline text NOT NULL,
  preheader text NOT NULL,
  sections jsonb NOT NULL,
  html text NOT NULL,
  text_body text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  model text NOT NULL,
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  cost_usd numeric(10, 6) NOT NULL,
  latency_ms integer NOT NULL,
  generation_meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_daily_grind_issues_generated_at ON daily_grind_issues(generated_at DESC);

-- Seed test recipients. Timezone defaults to ET; update via SQL UPDATE when actual TZ confirmed.
INSERT INTO daily_grind_test_subscribers (email, display_name, timezone, notes) VALUES
  ('matt@castorabbott.com', 'Matt', 'America/New_York', 'Test recipient seeded 2026-05-13. Update timezone if not ET.'),
  ('mark@castorabbott.com', 'Mark', 'America/New_York', 'Test recipient seeded 2026-05-13. Update timezone if not ET.')
ON CONFLICT (email) DO NOTHING;
