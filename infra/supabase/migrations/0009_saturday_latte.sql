-- 0009: Saturday Morning Latte tables.
--
-- Per user direction: "treat this as an entirely new system and newsletter.
-- it's just under the same name." Separate tables from daily_grind_*.
--
-- Mirrors the daily_grind shape but with weekend-specific fields.

CREATE TABLE saturday_latte_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text,
  timezone text NOT NULL DEFAULT 'America/New_York',
  send_at_hour_local smallint NOT NULL DEFAULT 9 CHECK (send_at_hour_local BETWEEN 0 AND 23),
  active boolean NOT NULL DEFAULT true,
  last_sent_issue_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE INDEX idx_saturday_latte_subscribers_active ON saturday_latte_subscribers(active) WHERE active = true;

CREATE TABLE saturday_latte_issues (
  issue_date date PRIMARY KEY,
  subject text NOT NULL,
  cover_story_headline text NOT NULL,
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
  research_sources jsonb,
  generation_meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_saturday_latte_issues_generated_at ON saturday_latte_issues(generated_at DESC);

-- Seed: same recipients as Daily Grind, default 9 AM ET Saturday delivery
INSERT INTO saturday_latte_subscribers (email, display_name, timezone, send_at_hour_local, active, notes) VALUES
  ('austin@castorabbott.com', 'Austin', 'America/New_York', 9, false, 'PAUSED: bug fixing in progress. 9 AM ET Saturday default.'),
  ('matt@castorabbott.com', 'Matt', 'America/New_York', 9, false, 'PAUSED: bug fixing in progress. 9 AM ET Saturday default.'),
  ('mark@castorabbott.com', 'Mark', 'America/New_York', 9, false, 'PAUSED: bug fixing in progress. 9 AM ET Saturday default.')
ON CONFLICT (email) DO NOTHING;
