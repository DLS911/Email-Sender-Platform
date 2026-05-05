-- Row-Level Security policies. Per spec 02_data_model § Row-Level Security.
--
-- Rules:
--   1. Platform admins see everything.
--   2. Brand members see rows for brands they're members of.
--   3. brand_admin and reviewer can write; viewer is read-only.
--   4. Service role (used by the pipeline + webhook handler) bypasses RLS.
--
-- Service role bypass is automatic when using SUPABASE_SERVICE_ROLE_KEY.
-- The policies below apply to authenticated user JWTs (the review UI).

-- Enable RLS on every brand-scoped table.
ALTER TABLE brand_voice_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE episode_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE episode_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE framework_concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE framework_content_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE block_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE segment_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE send_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimization_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;

-- Helper function: is the calling user a platform admin?
CREATE OR REPLACE FUNCTION current_user_is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'platform_admin'
  );
$$;

-- Helper function: is the calling user a member of brand X (any role)?
CREATE OR REPLACE FUNCTION current_user_is_member_of(p_brand_id text)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM brand_memberships
    WHERE brand_memberships.user_id = auth.uid()
    AND brand_memberships.brand_id = p_brand_id
  );
$$;

-- Helper function: can the calling user write to brand X (admin or reviewer)?
CREATE OR REPLACE FUNCTION current_user_can_write_brand(p_brand_id text)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM brand_memberships
    WHERE brand_memberships.user_id = auth.uid()
    AND brand_memberships.brand_id = p_brand_id
    AND brand_memberships.role IN ('brand_admin', 'reviewer')
  );
$$;

-- Apply standard policy template to a brand-scoped table.
-- This is a DO block that loops over the tables and creates uniform policies.
DO $$
DECLARE
  tbl text;
  brand_scoped_tables text[] := ARRAY[
    'brand_voice_configs',
    'episodes',
    'episode_sections',
    'episode_revisions',
    'framework_concepts',
    'content_concepts',
    'framework_content_usage',
    'pipeline_runs',
    'block_executions',
    'persona_evaluations',
    'quality_scores',
    'subscribers',
    'segments',
    'segment_memberships',
    'sends',
    'send_events',
    'experiments',
    'experiment_variants'
  ];
BEGIN
  FOREACH tbl IN ARRAY brand_scoped_tables LOOP
    EXECUTE format(
      'CREATE POLICY %I_platform_admin_all ON %I FOR ALL TO authenticated USING (current_user_is_platform_admin()) WITH CHECK (current_user_is_platform_admin())',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_brand_members_select ON %I FOR SELECT TO authenticated USING (current_user_is_member_of(brand_id))',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_brand_members_insert ON %I FOR INSERT TO authenticated WITH CHECK (current_user_can_write_brand(brand_id))',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_brand_members_update ON %I FOR UPDATE TO authenticated USING (current_user_can_write_brand(brand_id)) WITH CHECK (current_user_can_write_brand(brand_id))',
      tbl, tbl
    );
  END LOOP;
END $$;

-- platform_config: brand_id may be null (platform-wide). Special-case it.
CREATE POLICY platform_config_admin_all ON platform_config
  FOR ALL TO authenticated
  USING (current_user_is_platform_admin())
  WITH CHECK (current_user_is_platform_admin());

CREATE POLICY platform_config_brand_select ON platform_config
  FOR SELECT TO authenticated
  USING (
    brand_id IS NULL
    OR current_user_is_member_of(brand_id)
  );

-- optimization_policies: same pattern.
CREATE POLICY optimization_policies_admin_all ON optimization_policies
  FOR ALL TO authenticated
  USING (current_user_is_platform_admin())
  WITH CHECK (current_user_is_platform_admin());

CREATE POLICY optimization_policies_brand_select ON optimization_policies
  FOR SELECT TO authenticated
  USING (
    brand_id IS NULL
    OR current_user_is_member_of(brand_id)
  );

-- audit_log: read-only for non-admins, scoped to their brands.
CREATE POLICY audit_log_admin_all ON audit_log
  FOR ALL TO authenticated
  USING (current_user_is_platform_admin())
  WITH CHECK (current_user_is_platform_admin());

CREATE POLICY audit_log_brand_select ON audit_log
  FOR SELECT TO authenticated
  USING (
    brand_id IS NULL
    OR current_user_is_member_of(brand_id)
  );
