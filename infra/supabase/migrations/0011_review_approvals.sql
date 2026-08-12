-- Migration 0011: review approvals for both newsletters
--
-- Every generated newsletter issue lands in DB with approval_status = 'pending'.
-- A preview email goes to Mark right after generation with two signed links:
-- Approve → flips status to 'approved'. Needs Work → flips to 'needs_work'
-- and escalates to the editor. The send cron refuses to send unless the
-- issue is 'approved' at cron-fire time; on 'pending' or 'needs_work' at
-- send time, the cron skips and emails the editor a blocked-send notice.
--
-- approval_notified_at is set the first time a blocked-send notice fires
-- for a given issue so the notice isn't spammed on every subsequent send
-- cron tick.

ALTER TABLE saturday_latte_issues
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'needs_work')),
  ADD COLUMN IF NOT EXISTS approval_action_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT,
  ADD COLUMN IF NOT EXISTS approval_notified_at TIMESTAMPTZ;

ALTER TABLE daily_grind_issues
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'needs_work')),
  ADD COLUMN IF NOT EXISTS approval_action_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT,
  ADD COLUMN IF NOT EXISTS approval_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_latte_issues_approval_status
  ON saturday_latte_issues (approval_status);
CREATE INDEX IF NOT EXISTS ix_dg_issues_approval_status
  ON daily_grind_issues (approval_status);

-- Backfill: any existing issues (from historical sends) should already
-- have shipped; mark them approved so they don't get re-sent as pending.
UPDATE saturday_latte_issues SET approval_status = 'approved', approval_action_at = NOW()
  WHERE approval_status = 'pending';
UPDATE daily_grind_issues SET approval_status = 'approved', approval_action_at = NOW()
  WHERE approval_status = 'pending';
