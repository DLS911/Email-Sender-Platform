-- Initial schema. Sourced from docs/specs/02_data_model.spec.md.
-- Eight logical groups: tenancy, voice, content, brain, pipeline, distribution,
-- experiments, governance. Multi-tenancy via brand_id on every brand-scoped table.

-- ──────────────────────────────────────────────────────────────────────────
-- Group 1: Tenancy
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE brands (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  audience_type text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brands_audience_type_valid CHECK (audience_type IN ('b2b', 'b2c', 'both')),
  CONSTRAINT brands_status_valid CHECK (status IN ('active', 'paused', 'archived'))
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role_valid CHECK (role IN ('platform_admin', 'brand_admin', 'reviewer', 'viewer'))
);

CREATE TABLE brand_memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, brand_id),
  CONSTRAINT brand_memberships_role_valid CHECK (role IN ('brand_admin', 'reviewer', 'viewer'))
);

-- ──────────────────────────────────────────────────────────────────────────
-- Group 2: Voice configuration
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE brand_voice_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  version int NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  notes text,
  UNIQUE (brand_id, version)
);
CREATE INDEX idx_brand_voice_configs_active ON brand_voice_configs(brand_id) WHERE is_active = true;

CREATE TABLE voice_module_registry (
  id text PRIMARY KEY,
  category text NOT NULL,
  brand_id text REFERENCES brands(id) ON DELETE CASCADE,
  description text NOT NULL,
  current_version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_module_registry_status_valid CHECK (status IN ('active', 'deprecated', 'experimental'))
);

-- ──────────────────────────────────────────────────────────────────────────
-- Group 3: Content state
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  edition_type text NOT NULL,
  content_type text NOT NULL,
  format_style text,
  special_subtype text,
  scheduled_send_at timestamptz,
  actually_sent_at timestamptz,
  status text NOT NULL DEFAULT 'draft',
  headline text,
  slug text,
  voice_config_version int,
  voice_config_id uuid REFERENCES brand_voice_configs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id),
  CONSTRAINT episodes_status_valid CHECK (status IN ('draft', 'pending_review', 'approved', 'scheduled', 'sent', 'failed', 'skipped')),
  CONSTRAINT episodes_edition_type_valid CHECK (edition_type IN ('weekday', 'weekend', 'special'))
);
CREATE INDEX idx_episodes_brand_status ON episodes(brand_id, status);
CREATE INDEX idx_episodes_brand_sent ON episodes(brand_id, actually_sent_at DESC) WHERE actually_sent_at IS NOT NULL;
CREATE INDEX idx_episodes_pending_review ON episodes(brand_id, scheduled_send_at) WHERE status = 'pending_review';

CREATE TABLE episode_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  section_name text NOT NULL,
  section_order int NOT NULL,
  content jsonb NOT NULL,
  word_count int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, section_name)
);
CREATE INDEX idx_episode_sections_brand ON episode_sections(brand_id);

CREATE TABLE episode_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  revision_number int NOT NULL,
  source text NOT NULL,
  triggered_by uuid REFERENCES users(id),
  full_episode_snapshot jsonb NOT NULL,
  diff_from_previous jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, revision_number),
  CONSTRAINT episode_revisions_source_valid CHECK (source IN ('agent_initial', 'agent_polish', 'agent_revision', 'human_edit', 'fact_check'))
);
CREATE INDEX idx_episode_revisions_episode ON episode_revisions(episode_id, revision_number DESC);

-- ──────────────────────────────────────────────────────────────────────────
-- Group 4: Brain (framework + content concepts, junction, cross-brand)
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE framework_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  framework_name text NOT NULL,
  framework_family text NOT NULL,
  description text NOT NULL,
  description_embedding vector(1536),
  example_realizations jsonb,
  status text NOT NULL DEFAULT 'active',
  performance_score float,
  use_count int NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT framework_concepts_status_valid CHECK (status IN ('active', 'experimental', 'deprecated'))
);
CREATE INDEX idx_framework_concepts_brand_family ON framework_concepts(brand_id, framework_family);
CREATE INDEX idx_framework_concepts_embedding ON framework_concepts USING ivfflat (description_embedding vector_cosine_ops);
CREATE INDEX idx_framework_concepts_performance ON framework_concepts(brand_id, performance_score DESC NULLS LAST);

CREATE TABLE content_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  episode_id uuid REFERENCES episodes(id) ON DELETE SET NULL,
  section_name text NOT NULL,
  concept_summary text NOT NULL,
  concept_embedding vector(1536),
  surface_form text,
  raw_content jsonb,
  used_at timestamptz NOT NULL DEFAULT now(),
  lookback_until timestamptz,
  hard_blocked boolean NOT NULL DEFAULT false,
  CONSTRAINT content_concepts_section_valid CHECK (section_name <> '')
);
CREATE INDEX idx_content_concepts_brand_section ON content_concepts(brand_id, section_name);
CREATE INDEX idx_content_concepts_embedding ON content_concepts USING ivfflat (concept_embedding vector_cosine_ops);
CREATE INDEX idx_content_concepts_lookback ON content_concepts(brand_id, section_name, lookback_until DESC);
CREATE INDEX idx_content_concepts_hard_blocked ON content_concepts(brand_id, section_name) WHERE hard_blocked = true;

CREATE TABLE framework_content_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_concept_id uuid NOT NULL REFERENCES framework_concepts(id) ON DELETE CASCADE,
  content_concept_id uuid NOT NULL REFERENCES content_concepts(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  episode_id uuid REFERENCES episodes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (framework_concept_id, content_concept_id)
);
CREATE INDEX idx_framework_content_usage_framework ON framework_content_usage(framework_concept_id);
CREATE INDEX idx_framework_content_usage_episode ON framework_content_usage(episode_id);

CREATE TABLE cross_brand_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type text NOT NULL,
  pattern_description text NOT NULL,
  pattern_embedding vector(1536),
  performance_metric text NOT NULL,
  performance_value float NOT NULL,
  source_brand_count int NOT NULL,
  confidence_level float NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cross_brand_patterns_type ON cross_brand_patterns(pattern_type);
CREATE INDEX idx_cross_brand_patterns_embedding ON cross_brand_patterns USING ivfflat (pattern_embedding vector_cosine_ops);

-- ──────────────────────────────────────────────────────────────────────────
-- Group 5: Pipeline execution
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  edition_type text NOT NULL,
  triggered_by text NOT NULL,
  triggered_by_user uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  episode_id uuid REFERENCES episodes(id),
  voice_config_version int,
  total_cost_usd numeric(10, 4),
  total_input_tokens int,
  total_output_tokens int,
  error_summary text,
  CONSTRAINT pipeline_runs_status_valid CHECK (status IN ('running', 'completed', 'failed', 'cancelled'))
);
CREATE INDEX idx_pipeline_runs_brand_started ON pipeline_runs(brand_id, started_at DESC);
CREATE INDEX idx_pipeline_runs_status ON pipeline_runs(status, started_at DESC);

CREATE TABLE block_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  block_name text NOT NULL,
  block_type text NOT NULL,
  sequence int NOT NULL,
  provider text,
  model text,
  temperature float,
  reasoning_enabled boolean DEFAULT false,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10, 4),
  latency_ms int,
  status text NOT NULL,
  retry_count int NOT NULL DEFAULT 0,
  fallback_used boolean NOT NULL DEFAULT false,
  validation_status text,
  input_payload jsonb,
  output_payload jsonb,
  error_payload jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT block_executions_status_valid CHECK (status IN ('success', 'retry', 'fallback_used', 'failed'))
);
CREATE INDEX idx_block_executions_run ON block_executions(pipeline_run_id, sequence);
CREATE INDEX idx_block_executions_brand_block ON block_executions(brand_id, block_name, started_at DESC);
CREATE INDEX idx_block_executions_failures ON block_executions(brand_id, block_name) WHERE status = 'failed';

CREATE TABLE persona_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  episode_id uuid REFERENCES episodes(id),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  persona_name text NOT NULL,
  persona_segment text NOT NULL,
  love_probability int,
  share_probability int,
  unsubscribe_probability int,
  trifecta_scores jsonb,
  flags jsonb,
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_run_id, persona_name)
);
CREATE INDEX idx_persona_evaluations_episode ON persona_evaluations(episode_id);
CREATE INDEX idx_persona_evaluations_brand_persona ON persona_evaluations(brand_id, persona_name);

CREATE TABLE quality_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  pipeline_run_id uuid NOT NULL REFERENCES pipeline_runs(id),
  love_rate numeric(5, 2),
  share_rate numeric(5, 2),
  churn_risk numeric(5, 2),
  passed boolean NOT NULL,
  hard_stops_triggered jsonb,
  benchmark_comparison jsonb,
  trifecta_passed boolean,
  selected_unspoken_option text,
  segment_breakdown jsonb,
  common_flags jsonb,
  revision_recommendations jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_run_id, episode_id)
);
CREATE INDEX idx_quality_scores_episode ON quality_scores(episode_id);
CREATE INDEX idx_quality_scores_brand_passed ON quality_scores(brand_id, passed, created_at DESC);

-- ──────────────────────────────────────────────────────────────────────────
-- Group 6: Distribution
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'active',
  source text,
  subscribed_at timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz,
  unsubscribe_reason text,
  consent_record jsonb,
  custom_fields jsonb,
  UNIQUE (brand_id, email),
  CONSTRAINT subscribers_status_valid CHECK (status IN ('active', 'unsubscribed', 'bounced', 'complained', 'suppressed'))
);
CREATE INDEX idx_subscribers_brand_status ON subscribers(brand_id, status);
CREATE INDEX idx_subscribers_email ON subscribers(email);

CREATE TABLE segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  segment_type text NOT NULL,
  filter_definition jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, name),
  CONSTRAINT segments_type_valid CHECK (segment_type IN ('static', 'dynamic'))
);

CREATE TABLE segment_memberships (
  segment_id uuid NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  subscriber_id uuid NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (segment_id, subscriber_id)
);
CREATE INDEX idx_segment_memberships_subscriber ON segment_memberships(subscriber_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Group 7: Experimentation
-- (created before sends so sends can FK to experiment_variants)
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  experiment_type text NOT NULL,
  hypothesis text NOT NULL,
  success_metric text NOT NULL,
  minimum_sample_size int NOT NULL,
  confidence_threshold float NOT NULL DEFAULT 0.95,
  status text NOT NULL DEFAULT 'proposed',
  created_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  started_at timestamptz,
  concluded_at timestamptz,
  winning_variant_id uuid,
  results_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experiments_type_valid CHECK (experiment_type IN ('framework', 'content', 'subject_line', 'send_time', 'cta', 'segment_variant')),
  CONSTRAINT experiments_status_valid CHECK (status IN ('proposed', 'approved', 'running', 'concluded', 'cancelled'))
);
CREATE INDEX idx_experiments_brand_status ON experiments(brand_id, status);

CREATE TABLE experiment_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  variant_name text NOT NULL,
  variant_definition jsonb NOT NULL,
  traffic_allocation_pct numeric(5, 2) NOT NULL,
  recipient_count int DEFAULT 0,
  metric_value numeric,
  sample_size int DEFAULT 0,
  is_winner boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, variant_name)
);
CREATE INDEX idx_experiment_variants_experiment ON experiment_variants(experiment_id);

ALTER TABLE experiments
  ADD CONSTRAINT experiments_winning_variant_fk
  FOREIGN KEY (winning_variant_id) REFERENCES experiment_variants(id);

-- Sends — references episodes + experiment_variants
CREATE TABLE sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES episodes(id),
  segment_id uuid REFERENCES segments(id),
  experiment_id uuid REFERENCES experiments(id),
  variant_id uuid REFERENCES experiment_variants(id),
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  provider_name text NOT NULL DEFAULT 'resend',
  provider_broadcast_id text,
  recipient_count int,
  status text NOT NULL DEFAULT 'scheduled',
  subject_line text NOT NULL,
  preheader text,
  from_email text NOT NULL,
  from_name text NOT NULL,
  reply_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sends_status_valid CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'cancelled'))
);
CREATE INDEX idx_sends_brand_scheduled ON sends(brand_id, scheduled_at DESC);
CREATE INDEX idx_sends_episode ON sends(episode_id);
CREATE INDEX idx_sends_provider_broadcast ON sends(provider_name, provider_broadcast_id);

CREATE TABLE send_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL REFERENCES sends(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  subscriber_id uuid REFERENCES subscribers(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  provider_name text NOT NULL DEFAULT 'resend',
  provider_event_id text,
  click_url text,
  click_section text,
  reply_content text,
  reply_classification text,
  bounce_type text,
  user_agent text,
  ip_address inet,
  raw_payload jsonb,
  CONSTRAINT send_events_type_valid CHECK (event_type IN ('delivered', 'opened', 'clicked', 'replied', 'complained', 'bounced', 'unsubscribed', 'failed'))
);
CREATE INDEX idx_send_events_send_type ON send_events(send_id, event_type);
CREATE INDEX idx_send_events_brand_type_time ON send_events(brand_id, event_type, event_at DESC);
CREATE INDEX idx_send_events_subscriber ON send_events(subscriber_id) WHERE subscriber_id IS NOT NULL;
CREATE UNIQUE INDEX idx_send_events_provider_dedup
  ON send_events (provider_name, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE TABLE suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  reason text NOT NULL,
  source_brand_id text REFERENCES brands(id),
  global boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  UNIQUE (email)
);
CREATE INDEX idx_suppression_list_email ON suppression_list(email);

-- ──────────────────────────────────────────────────────────────────────────
-- Group 8: Governance & configuration
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE optimization_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text REFERENCES brands(id) ON DELETE CASCADE,
  scope text NOT NULL,
  policy_name text NOT NULL,
  policy_definition jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active',
  version int NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT optimization_policies_scope_valid CHECK (scope IN ('platform', 'brand', 'experiment_class')),
  CONSTRAINT optimization_policies_status_valid CHECK (status IN ('active', 'superseded', 'revoked'))
);
CREATE INDEX idx_optimization_policies_active ON optimization_policies(brand_id, scope) WHERE status = 'active';

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text REFERENCES brands(id),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_brand_action ON audit_log(brand_id, action, created_at DESC);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_type, actor_id, created_at DESC);
CREATE INDEX idx_audit_log_target ON audit_log(target_type, target_id);

-- platform_config: lookup is (key, brand_id-or-null, environment).
-- Use a unique index with COALESCE so brand_id NULL is treated as a single value.
CREATE TABLE platform_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  brand_id text REFERENCES brands(id) ON DELETE CASCADE,
  environment text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX idx_platform_config_lookup
  ON platform_config (key, COALESCE(brand_id, ''), environment);
CREATE INDEX idx_platform_config_key ON platform_config(key);
