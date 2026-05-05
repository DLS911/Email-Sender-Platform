---
spec: 02_data_model
title: Database Schema & Migrations
version: 1.0
status: draft
audience: dev_team, agentic_orchestrator
dependencies:
  - 00_overview
  - 01_foundation
consumed_by:
  - 03_voice_system
  - 04_content_pipeline
  - 05_brain_and_learning
  - 06_distribution_platform
  - 07_experiment_framework
  - 08_review_interface
  - 09_optimization_policies
  - 10_observability
  - 12_migration_plan
purpose: Complete Supabase schema, indexes, RLS policies, and migration strategy. Every table, every relationship, every constraint. Multi-tenancy enforced at the database layer, not just in application code.
---

# Database Schema & Migrations

## What This Spec Covers

The complete database schema. Every table, column, index, foreign key, RLS policy. The migration strategy. The seed data approach. The migration path from the current Google Sheets state to Supabase.

This spec is opinionated about schema design because the database is the hardest thing to change later. Get it right now, save weeks of pain in Phase 4 and 5.

## Why Multi-Tenancy at the Database Layer

Every table in this schema has a `brand_id` column. Every row belongs to exactly one brand. Every query is brand-scoped. Cross-brand data access is explicitly opt-in and rare.

This is enforced two ways:

**At the application layer:** every query goes through helpers that automatically inject `brand_id` filters. A developer who tries to query `episodes` without a brand filter has to work harder than one who uses the helper.

**At the database layer:** Row-Level Security (RLS) policies on every table. Even if a query bypasses the application helpers (bug, raw SQL, future agent error), the database refuses to return rows from the wrong brand.

The combination means cross-brand data leakage is impossible by construction, not by convention. This is the single most important architectural decision in this spec.

## Database: Supabase Postgres

**Postgres 15+** via Supabase. The database is the source of truth for everything except code (which lives in git).

**Why Supabase over raw Postgres:**
- Auth, storage, realtime, edge functions in one platform — reduces our infra surface.
- RLS policies are first-class.
- pgvector for embedding similarity is built in.
- Realtime subscriptions for the review UI come for free.
- Pricing scales sensibly through the size we'll be at for the next 18-24 months.

**What we don't use Supabase for:**
- Long-running background jobs → Railway worker.
- Email sending → Resend.
- LLM calls → providers directly via `@platform/llm-client`.

**Migrations:** SQL files in `infra/supabase/migrations/`, numbered sequentially (`0001_initial.sql`, `0002_add_experiments.sql`, etc.). Applied via Supabase CLI in CI/CD. Never edit a migration after it's been applied to any environment — write a new one.

**Local dev:** Supabase CLI runs a local Postgres + Supabase services for development. Schema changes are tested locally before pushing to staging.

## Schema Overview

The schema has eight logical groups of tables:

1. **Tenancy** — brands, users, roles
2. **Voice configuration** — voice modules, brand voice configs
3. **Content state** — episodes, sections, drafts, revisions
4. **Brain** — concepts (framework + content), embeddings, similarity records
5. **Pipeline execution** — runs, block executions, evaluations
6. **Distribution** — subscribers, segments, sends, events
7. **Experimentation** — experiments, variants, results
8. **Governance** — policies, audit log, platform config

Each group is documented below with full SQL.

---

## Group 1: Tenancy

The foundation of multi-tenancy. Three tables: brands, users, brand_memberships.

### `brands`

Top-level tenant. Each newsletter property is one brand. Castor Abbott, Cortex, Fidelon, Treasure Financial.

```sql
CREATE TABLE brands (
  id text PRIMARY KEY,                          -- "castor_abbott", "cortex", "fidelon", "treasure_financial"
  name text NOT NULL,                           -- Human-readable: "Castor Abbott"
  slug text NOT NULL UNIQUE,                    -- URL-safe: "castor-abbott"
  audience_type text NOT NULL,                  -- "b2b", "b2c", "both"
  status text NOT NULL DEFAULT 'active',        -- "active", "paused", "archived"
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT brands_audience_type_valid CHECK (audience_type IN ('b2b', 'b2c', 'both')),
  CONSTRAINT brands_status_valid CHECK (status IN ('active', 'paused', 'archived'))
);
```

Brand IDs are slug-style strings, not UUIDs. They appear in URLs, log lines, agent prompts. Readable IDs are worth the small performance trade-off.

Seed data inserted via migration:

```sql
INSERT INTO brands (id, name, slug, audience_type) VALUES
  ('castor_abbott', 'Castor Abbott', 'castor-abbott', 'b2b'),
  ('cortex', 'Cortex', 'cortex', 'b2b'),
  ('fidelon', 'Fidelon', 'fidelon', 'both'),
  ('treasure_financial', 'Treasure Financial', 'treasure-financial', 'b2c');
```

### `users`

Humans with access to the platform. Mark, his developer, future team members, eventually external Cortex customers.

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'member',           -- "platform_admin", "brand_admin", "reviewer", "viewer"
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_role_valid CHECK (role IN ('platform_admin', 'brand_admin', 'reviewer', 'viewer'))
);
```

`platform_admin` = Mark, sees everything across all brands. `brand_admin` = full access to their assigned brands. `reviewer` = can review/approve drafts but not change settings. `viewer` = read-only.

Auth is handled by Supabase Auth. The `users` table is our application-level mirror that adds role information.

### `brand_memberships`

Many-to-many between users and brands. Determines per-brand access for non-platform-admins.

```sql
CREATE TABLE brand_memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  role text NOT NULL,                            -- Per-brand role override
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, brand_id),
  CONSTRAINT brand_memberships_role_valid CHECK (role IN ('brand_admin', 'reviewer', 'viewer'))
);
```

Platform admins don't need rows here — their access is global by virtue of role.

---

## Group 2: Voice Configuration

How voice modules attach to brands. The voice module *content* lives in the repo (`packages/voice-modules/`), versioned in git. The database tracks which modules a brand uses, in what order, with what overrides.

### `brand_voice_configs`

Per-brand voice configuration. One active config per brand at a time; old configs preserved for replay/audit.

```sql
CREATE TABLE brand_voice_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  version int NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL,                         -- See structure below
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  notes text,

  UNIQUE (brand_id, version)
);

CREATE INDEX idx_brand_voice_configs_active ON brand_voice_configs(brand_id) WHERE is_active = true;
```

Only one row per brand has `is_active = true`. Enforced by application logic, not DB constraint (Postgres partial unique indexes are awkward across multiple columns).

The `config` JSONB structure:

```json
{
  "weekday": {
    "modules": [
      "core/mark-persona",
      "core/voice-rules",
      "weekday/trust-stacking",
      "weekday/physician-model",
      "weekday/gap-framework",
      "weekday/contrarian-positions",
      "weekday/language-guide"
    ],
    "personas": [
      "solo-operator", "rising-star", "wirehouse-refugee",
      "fee-only-purist", "women-advisor", "next-gen-inheritor",
      "niche-specialist", "team-builder", "veteran", "compliance-conscious"
    ],
    "content_types": ["tactic", "take", "story", "special", "ancient_truth"],
    "default_format_styles": ["deep_dive", "quick_hits", "contrarian", "story", "data"]
  },
  "weekend": {
    "modules": [
      "core/mark-persona",
      "weekend/complete-mark",
      "weekend/family-context",
      "weekend/car-spectrum",
      "weekend/content-types",
      "weekend/unexpected-variable-rubric"
    ],
    "personas": ["...same 10..."],
    "content_types": ["type_1", "type_2", "type_3", "type_4", "type_5", "type_6", "type_7", "type_8", "type_9", "type_10"]
  },
  "overrides": {
    "model_settings": {
      "writer_block": { "primary": "claude-opus-4", "temperature": 0.6 }
    },
    "thresholds": {
      "duplicate_similarity_max": 0.78,
      "exploration_budget_pct": 20
    }
  }
}
```

Voice configs are versioned, not edited. To change voice configuration, insert a new row with `version = current + 1`, `is_active = true`, and set the previous active row to `is_active = false`. Past runs reference the config version that was active at the time, so historical replay works correctly.

### `voice_module_registry`

Catalog of available voice modules. The actual content lives in code; this table is for discoverability, validation, and tracking module-level performance.

```sql
CREATE TABLE voice_module_registry (
  id text PRIMARY KEY,                           -- "weekday/trust-stacking"
  category text NOT NULL,                        -- "core", "weekday", "weekend", "brand-specific"
  brand_id text REFERENCES brands(id) ON DELETE CASCADE,  -- Null for shared modules
  description text NOT NULL,
  current_version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',         -- "active", "deprecated", "experimental"
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT voice_module_registry_status_valid CHECK (status IN ('active', 'deprecated', 'experimental'))
);
```

Sync between code and registry: a CI job parses `packages/voice-modules/` and updates this table on every deploy. Drift between code and registry fails the build.

---

## Group 3: Content State

The actual newsletter content. Episodes are the unit of publication; sections are the components within each episode.

### `episodes`

One row per published or drafted newsletter edition.

```sql
CREATE TABLE episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  edition_type text NOT NULL,                    -- "weekday", "weekend", "special"
  content_type text NOT NULL,                    -- "tactic", "take", "weekend", "type_4", etc.
  format_style text,                             -- "deep_dive", "contrarian", etc. (weekday only)
  special_subtype text,                          -- "compliance", "team_management", etc.
  scheduled_send_at timestamptz,
  actually_sent_at timestamptz,
  status text NOT NULL DEFAULT 'draft',          -- "draft", "pending_review", "approved", "scheduled", "sent", "failed", "skipped"

  -- Content fields
  headline text,
  slug text,                                     -- URL-safe headline slug
  voice_config_version int,                      -- Snapshot of voice config used
  voice_config_id uuid REFERENCES brand_voice_configs(id),

  -- Metadata
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
```

### `episode_sections`

Each newsletter is composed of named sections. Cover Story, Tasting Menu, Host's Corner, Drive, Sunday Prep, Sunday Reset, Sabbath for the Latte. First Pull, Worth Knowing, Tactic, Grounds for Thought, Ancient Truth for the Daily Grind. Plus the Opening Trifecta sub-sections (Number, Unspoken, Flip).

```sql
CREATE TABLE episode_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,  -- Denormalized for RLS
  section_name text NOT NULL,                    -- "cover_story", "tasting_menu", "the_unspoken", etc.
  section_order int NOT NULL,                    -- Render order within episode
  content jsonb NOT NULL,                        -- Schema varies by section type, validated at write time
  word_count int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (episode_id, section_name)
);

CREATE INDEX idx_episode_sections_brand ON episode_sections(brand_id);
```

Section content is JSONB because the shape varies per section type. The application validates against the appropriate Zod schema before writing. Schema drift (a section written with the wrong shape) is caught at write time.

### `episode_revisions`

Full snapshot of every edit. Append-only. Required for audit trail and edit-history capability in the review UI.

```sql
CREATE TABLE episode_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  revision_number int NOT NULL,                  -- 1, 2, 3, ...
  source text NOT NULL,                          -- "agent_initial", "agent_polish", "human_edit", "agent_revision"
  triggered_by uuid REFERENCES users(id),        -- Null for agent-only revisions
  full_episode_snapshot jsonb NOT NULL,          -- Complete episode JSON at this point
  diff_from_previous jsonb,                      -- JSON Patch from previous revision (null for revision 1)
  notes text,                                    -- Reason for revision
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (episode_id, revision_number),
  CONSTRAINT episode_revisions_source_valid CHECK (source IN ('agent_initial', 'agent_polish', 'agent_revision', 'human_edit', 'fact_check'))
);

CREATE INDEX idx_episode_revisions_episode ON episode_revisions(episode_id, revision_number DESC);
```

Every change to an episode appends a revision row. Human edits include the user ID. The full snapshot pattern (rather than diff-only) makes replay and audit straightforward — you can see exactly what the episode looked like at any past moment.

---

## Group 4: Brain (Framework Concepts + Content Concepts)

The system's memory. Two completely separate concept layers, as established in `00_overview`. This is the architecturally critical separation.

### `framework_concepts`

Reusable structural patterns, voice mechanisms, opening styles, content architectures.

```sql
CREATE TABLE framework_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  framework_name text NOT NULL,                  -- "say_do_gap_with_knife_twist", "physics_payload_close"
  framework_family text NOT NULL,                -- "opening_pattern", "closing_pattern", "section_structure"
  description text NOT NULL,                     -- 1-2 sentence semantic description
  description_embedding vector(1536),            -- text-embedding-3-large
  example_realizations jsonb,                    -- Array of past concrete uses (for prompt few-shot)
  status text NOT NULL DEFAULT 'active',         -- "active", "experimental", "deprecated"
  performance_score float,                       -- Aggregate engagement when this framework is used (computed)
  use_count int NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT framework_concepts_status_valid CHECK (status IN ('active', 'experimental', 'deprecated'))
);

CREATE INDEX idx_framework_concepts_brand_family ON framework_concepts(brand_id, framework_family);
CREATE INDEX idx_framework_concepts_embedding ON framework_concepts USING ivfflat (description_embedding vector_cosine_ops);
CREATE INDEX idx_framework_concepts_performance ON framework_concepts(brand_id, performance_score DESC NULLS LAST);
```

The pgvector extension handles embedding similarity. `framework_family` provides a coarse categorization (which family of framework is this?), while embedding similarity handles fine-grained "are these two frameworks essentially the same?" queries.

Framework concepts are *not* locked out of reuse. A high-performing framework can be used many times across many episodes. The system's optimization layer rewards their reuse — within the variety constraints documented in `05_brain_and_learning`.

### `content_concepts`

Specific content: destinations, tactics, recommendations, factual claims. Locked out of reuse within configurable lookback windows regardless of performance.

```sql
CREATE TABLE content_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  episode_id uuid REFERENCES episodes(id) ON DELETE SET NULL,
  section_name text NOT NULL,                    -- "cover_story", "tasting_menu_item", "tactic", "the_drive"
  concept_summary text NOT NULL,                 -- 1-2 sentence semantic summary
  concept_embedding vector(1536),
  surface_form text,                             -- Headline, item title, vehicle name (for human-readable lookup)
  raw_content jsonb,                             -- Full section content for replay/inspection
  used_at timestamptz NOT NULL DEFAULT now(),
  lookback_until timestamptz,                    -- When this concept becomes available again (null = permanent)
  hard_blocked boolean NOT NULL DEFAULT false,   -- Permanent block override (e.g., "Lodge cast iron")

  CONSTRAINT content_concepts_section_valid CHECK (section_name <> '')
);

CREATE INDEX idx_content_concepts_brand_section ON content_concepts(brand_id, section_name);
CREATE INDEX idx_content_concepts_embedding ON content_concepts USING ivfflat (concept_embedding vector_cosine_ops);
CREATE INDEX idx_content_concepts_lookback ON content_concepts(brand_id, section_name, lookback_until DESC);
CREATE INDEX idx_content_concepts_hard_blocked ON content_concepts(brand_id, section_name) WHERE hard_blocked = true;
```

`lookback_until` is set when the concept is created based on the section's configured lookback window (e.g., 270 days for cover stories, 90 days for tasting menu items, permanent for hard-blocked items). Queries during research filter on `lookback_until > now() OR hard_blocked = true` to exclude unavailable concepts.

The hard-blocked flag exists for permanent exclusions (Lodge cast iron, Le Creuset, Four Thousand Weeks, etc. from the existing system).

### `framework_content_usage`

Junction table linking which framework concepts were used in which content sections. Required to attribute performance back to frameworks.

```sql
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
```

When a section is generated, the system records which framework patterns were used. When that episode's performance data arrives, performance is attributed to both the content concept (one-time learning) and the framework concepts (durable learning). This is the data structure that enables the framework-vs-content separation in the learning loop.

### `cross_brand_patterns`

Anonymized patterns extracted across brands for cross-brand learning. Phase 5 capability.

```sql
CREATE TABLE cross_brand_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type text NOT NULL,                    -- "subject_line", "send_time", "section_structure"
  pattern_description text NOT NULL,
  pattern_embedding vector(1536),
  performance_metric text NOT NULL,              -- "open_rate", "click_through", "reply_rate"
  performance_value float NOT NULL,
  source_brand_count int NOT NULL,               -- How many brands contributed (privacy: min 2)
  confidence_level float NOT NULL,               -- Statistical confidence in pattern
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cross_brand_patterns_type ON cross_brand_patterns(pattern_type);
CREATE INDEX idx_cross_brand_patterns_embedding ON cross_brand_patterns USING ivfflat (pattern_embedding vector_cosine_ops);
```

Cross-brand patterns are not joined to specific brands in this table. Source brands are counted but not identified. This is the architectural firewall that lets cross-brand learning happen without enabling cross-brand data leakage.

---

## Group 5: Pipeline Execution

Every pipeline run, every block within it, every retry, every evaluation. The audit trail.

### `pipeline_runs`

One row per pipeline invocation. The top-level execution record.

```sql
CREATE TABLE pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  edition_type text NOT NULL,                    -- "weekday", "weekend"
  triggered_by text NOT NULL,                    -- "scheduled_cron", "manual", "experiment", "replay"
  triggered_by_user uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'running',        -- "running", "completed", "failed", "cancelled"
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  episode_id uuid REFERENCES episodes(id),       -- Set once episode is created
  voice_config_version int,
  total_cost_usd numeric(10, 4),
  total_input_tokens int,
  total_output_tokens int,
  error_summary text,                            -- High-level error if failed

  CONSTRAINT pipeline_runs_status_valid CHECK (status IN ('running', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX idx_pipeline_runs_brand_started ON pipeline_runs(brand_id, started_at DESC);
CREATE INDEX idx_pipeline_runs_status ON pipeline_runs(status, started_at DESC);
```

### `block_executions`

Every individual block within a pipeline run. Cover Story Research, Tasting Menu Validator, Editor, etc.

```sql
CREATE TABLE block_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  block_name text NOT NULL,                      -- "cover_story_research", "hosts_corner_validator"
  block_type text NOT NULL,                      -- "research", "writer", "validator", "editor", "evaluator"
  sequence int NOT NULL,                         -- Execution order within run

  -- LLM call details
  provider text,                                 -- "anthropic", "openai", "google"
  model text,                                    -- "claude-sonnet-4.5", etc.
  temperature float,
  reasoning_enabled boolean DEFAULT false,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10, 4),
  latency_ms int,

  -- Outcome
  status text NOT NULL,                          -- "success", "retry", "fallback_used", "failed"
  retry_count int NOT NULL DEFAULT 0,
  fallback_used boolean NOT NULL DEFAULT false,
  validation_status text,                        -- "passed", "auto_healed", "fallback_validated", "failed"

  -- Data
  input_payload jsonb,                           -- Truncated if very large
  output_payload jsonb,                          -- Truncated if very large
  error_payload jsonb,                           -- Error details if failed

  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  CONSTRAINT block_executions_status_valid CHECK (status IN ('success', 'retry', 'fallback_used', 'failed'))
);

CREATE INDEX idx_block_executions_run ON block_executions(pipeline_run_id, sequence);
CREATE INDEX idx_block_executions_brand_block ON block_executions(brand_id, block_name, started_at DESC);
CREATE INDEX idx_block_executions_failures ON block_executions(brand_id, block_name) WHERE status = 'failed';
```

Block executions are the atomic unit of observability. Every LLM call gets a row. The query "show me every Hosts Corner failure in the last 30 days" is a single indexed query against this table.

`input_payload` and `output_payload` are stored truncated when very large (>100KB). The full payload is logged via the structured log layer for cases where it's needed.

### `persona_evaluations`

Persona panel scoring outputs. One row per persona per episode.

```sql
CREATE TABLE persona_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  episode_id uuid REFERENCES episodes(id),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  persona_name text NOT NULL,                    -- "solo_operator", "veteran", etc.
  persona_segment text NOT NULL,                 -- "highest_engagement", "moderate_engagement", "at_risk"

  love_probability int,                          -- 0-100
  share_probability int,
  unsubscribe_probability int,

  trifecta_scores jsonb,                         -- Per-element scores for weekday Opening Trifecta
  flags jsonb,                                   -- Array of flagged issues
  raw_response jsonb,                            -- Full persona response for audit/debug

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (pipeline_run_id, persona_name)
);

CREATE INDEX idx_persona_evaluations_episode ON persona_evaluations(episode_id);
CREATE INDEX idx_persona_evaluations_brand_persona ON persona_evaluations(brand_id, persona_name);
```

### `quality_scores`

Aggregate quality assessment per episode. One row per episode.

```sql
CREATE TABLE quality_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  pipeline_run_id uuid NOT NULL REFERENCES pipeline_runs(id),

  love_rate numeric(5, 2),                       -- Aggregate persona love score
  share_rate numeric(5, 2),
  churn_risk numeric(5, 2),                      -- Weighted (at-risk personas count 2x)

  passed boolean NOT NULL,
  hard_stops_triggered jsonb,                    -- Array of triggered hard-stop conditions
  benchmark_comparison jsonb,                    -- Per-metric pass/fail vs benchmarks

  trifecta_passed boolean,                       -- Weekday only
  selected_unspoken_option text,                 -- "option_1", "option_2", "option_3"

  segment_breakdown jsonb,                       -- Per-segment averages
  common_flags jsonb,                            -- [{flag, count, personas, priority}]
  revision_recommendations jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (pipeline_run_id, episode_id)
);

CREATE INDEX idx_quality_scores_episode ON quality_scores(episode_id);
CREATE INDEX idx_quality_scores_brand_passed ON quality_scores(brand_id, passed, created_at DESC);
```

---

## Group 6: Distribution

Subscriber state, sending records, event stream.

### `subscribers`

Per-brand subscriber list. Each subscriber belongs to exactly one brand.

```sql
CREATE TABLE subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'active',         -- "active", "unsubscribed", "bounced", "complained", "suppressed"
  source text,                                   -- "website_signup", "import", "api", "referral"
  subscribed_at timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz,
  unsubscribe_reason text,
  consent_record jsonb,                          -- GDPR-compliant consent metadata if applicable
  custom_fields jsonb,                           -- Brand-specific arbitrary fields

  UNIQUE (brand_id, email),
  CONSTRAINT subscribers_status_valid CHECK (status IN ('active', 'unsubscribed', 'bounced', 'complained', 'suppressed'))
);

CREATE INDEX idx_subscribers_brand_status ON subscribers(brand_id, status);
CREATE INDEX idx_subscribers_email ON subscribers(email);  -- For cross-brand lookup with explicit auth
```

The same email can subscribe to multiple brands (separate rows per brand). Cross-brand identity resolution is intentionally not done at the data layer — each brand owns its subscriber relationship independently, and pseudo-aggregating identities would create privacy and consent complications that aren't worth solving in v1.

### `segments`

Named groups of subscribers within a brand. Computed dynamically or stored as static lists.

```sql
CREATE TABLE segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  segment_type text NOT NULL,                    -- "static", "dynamic"
  filter_definition jsonb,                       -- For dynamic segments: SQL-like filter spec
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
```

### `sends`

One row per email sent. The link between an episode, a segment, and the subscribers who received it.

```sql
CREATE TABLE sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES episodes(id),
  segment_id uuid REFERENCES segments(id),       -- Null = all active subscribers
  experiment_id uuid REFERENCES experiments(id), -- Set if this send is part of an experiment
  variant_id uuid REFERENCES experiment_variants(id),

  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  provider_name text NOT NULL DEFAULT 'resend',  -- "resend", "ses", etc. See 06_distribution_platform
  provider_broadcast_id text,                    -- ID returned by the active provider
  recipient_count int,
  status text NOT NULL DEFAULT 'scheduled',      -- "scheduled", "sending", "sent", "failed", "cancelled"

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
```

### `send_events`

Every event from the active distribution provider's webhooks. Opens, clicks, replies, complaints, bounces, unsubscribes. Stored in normalized form regardless of which provider produced them.

```sql
CREATE TABLE send_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL REFERENCES sends(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  subscriber_id uuid REFERENCES subscribers(id) ON DELETE SET NULL,

  event_type text NOT NULL,                      -- "delivered", "opened", "clicked", "replied", "complained", "bounced", "unsubscribed"
  event_at timestamptz NOT NULL,                 -- When the event occurred (from the provider)
  received_at timestamptz NOT NULL DEFAULT now(),-- When we received the webhook

  -- Provider tracking (see 06_distribution_platform for the abstraction layer)
  provider_name text NOT NULL DEFAULT 'resend',  -- "resend", "ses", etc.
  provider_event_id text,                        -- Provider's event ID for idempotency

  -- Event-specific data
  click_url text,                                -- For click events
  click_section text,                            -- Which section the click came from (if attributable)
  reply_content text,                            -- For reply events (truncated if very long)
  reply_classification text,                     -- "engagement", "complaint", "unsubscribe_request", "question", "suggestion"
  bounce_type text,                              -- "hard", "soft"
  user_agent text,
  ip_address inet,                               -- Anonymized in some compliance contexts

  raw_payload jsonb,                             -- Full original webhook payload for audit

  CONSTRAINT send_events_type_valid CHECK (event_type IN ('delivered', 'opened', 'clicked', 'replied', 'complained', 'bounced', 'unsubscribed', 'failed'))
);

CREATE INDEX idx_send_events_send_type ON send_events(send_id, event_type);
CREATE INDEX idx_send_events_brand_type_time ON send_events(brand_id, event_type, event_at DESC);
CREATE INDEX idx_send_events_subscriber ON send_events(subscriber_id) WHERE subscriber_id IS NOT NULL;
CREATE UNIQUE INDEX idx_send_events_provider_dedup
  ON send_events (provider_name, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
```

The event stream is the foundation of the closed feedback loop. Every event arrives within seconds of the subscriber action via the active distribution provider's webhooks, gets normalized through the provider adapter, attributed to a send (and through the send to an episode, segment, and possibly experiment variant), and becomes available for the learning loop to query.

The `provider_name` and `provider_event_id` columns support the multi-provider abstraction defined in `06_distribution_platform`. The unique index on `(provider_name, provider_event_id)` enforces webhook idempotency — duplicate deliveries cannot create duplicate event rows even if they arrive seconds apart.

`click_section` attribution: each link in the rendered email has a tracking parameter identifying which section it came from. The webhook handler parses this to populate `click_section`. This enables section-level engagement attribution rather than just total click rates.

### `suppression_list`

Compliance-mandated do-not-send list. Cross-brand by default — if a subscriber complains about Brand A, they don't get Brand B without an explicit re-opt-in.

```sql
CREATE TABLE suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  reason text NOT NULL,                          -- "complaint", "hard_bounce", "manual", "unsubscribe_all"
  source_brand_id text REFERENCES brands(id),    -- Which brand triggered the suppression
  global boolean NOT NULL DEFAULT true,          -- True = block from all brands
  added_at timestamptz NOT NULL DEFAULT now(),
  notes text,

  UNIQUE (email)
);

CREATE INDEX idx_suppression_list_email ON suppression_list(email);
```

The send pipeline checks this list before queuing any subscriber. Globally suppressed addresses are excluded regardless of brand.

---

## Group 7: Experimentation

Phase 2+ capability. Schema ready from day one to avoid retrofitting.

### `experiments`

A defined experiment with variants, hypothesis, success metric.

```sql
CREATE TABLE experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  experiment_type text NOT NULL,                 -- "framework", "content", "subject_line", "send_time"
  hypothesis text NOT NULL,
  success_metric text NOT NULL,                  -- "open_rate", "click_through", "reply_rate", etc.
  minimum_sample_size int NOT NULL,
  confidence_threshold float NOT NULL DEFAULT 0.95,

  status text NOT NULL DEFAULT 'proposed',       -- "proposed", "approved", "running", "concluded", "cancelled"
  created_by uuid REFERENCES users(id),          -- Null for agent-proposed
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  started_at timestamptz,
  concluded_at timestamptz,

  winning_variant_id uuid,                       -- Set when concluded
  results_summary jsonb,                         -- Statistical analysis

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT experiments_type_valid CHECK (experiment_type IN ('framework', 'content', 'subject_line', 'send_time', 'cta', 'segment_variant')),
  CONSTRAINT experiments_status_valid CHECK (status IN ('proposed', 'approved', 'running', 'concluded', 'cancelled'))
);

CREATE INDEX idx_experiments_brand_status ON experiments(brand_id, status);
```

### `experiment_variants`

The variants being tested within an experiment.

```sql
CREATE TABLE experiment_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  variant_name text NOT NULL,
  variant_definition jsonb NOT NULL,             -- The actual variant content/setting
  traffic_allocation_pct numeric(5, 2) NOT NULL, -- 0.0 to 100.0

  -- Results
  recipient_count int DEFAULT 0,
  metric_value numeric,                          -- The measured success metric
  sample_size int DEFAULT 0,
  is_winner boolean DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (experiment_id, variant_name)
);

ALTER TABLE experiments ADD CONSTRAINT experiments_winning_variant_fk
  FOREIGN KEY (winning_variant_id) REFERENCES experiment_variants(id);

CREATE INDEX idx_experiment_variants_experiment ON experiment_variants(experiment_id);
```

---

## Group 8: Governance & Configuration

Optimization policies, audit log, platform configuration.

### `optimization_policies`

What experiments and adjustments agents can make autonomously vs. what requires human approval.

```sql
CREATE TABLE optimization_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text REFERENCES brands(id) ON DELETE CASCADE,  -- Null = platform-wide
  scope text NOT NULL,                           -- "platform", "brand", "experiment_class"
  policy_name text NOT NULL,
  policy_definition jsonb NOT NULL,              -- See structure in 09_optimization_policies
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
```

### `audit_log`

Every consequential action taken by humans or agents. Append-only.

```sql
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text REFERENCES brands(id),           -- Null for platform-level actions
  actor_type text NOT NULL,                      -- "human", "agent", "system"
  actor_id text NOT NULL,                        -- User ID or agent identifier
  action text NOT NULL,                          -- "approve_send", "edit_episode", "run_experiment", "change_voice_config"
  target_type text NOT NULL,                     -- "episode", "voice_config", "experiment", "subscriber"
  target_id text,
  payload jsonb,                                 -- Action-specific data
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_brand_action ON audit_log(brand_id, action, created_at DESC);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_type, actor_id, created_at DESC);
CREATE INDEX idx_audit_log_target ON audit_log(target_type, target_id);
```

### `platform_config`

Runtime configuration. Defined in `01_foundation`. Repeated here for completeness.

```sql
CREATE TABLE platform_config (
  key text NOT NULL,
  brand_id text REFERENCES brands(id) ON DELETE CASCADE,  -- Null = platform-wide default
  environment text NOT NULL,                     -- "production", "staging", "development"
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id),

  PRIMARY KEY (key, COALESCE(brand_id, ''), environment)
);
```

---

## Row-Level Security (RLS)

RLS is enabled on every table that contains brand-scoped data. The policies enforce:

1. Platform admins see all rows.
2. Brand admins see rows where `brand_id` matches their brand membership.
3. Reviewers see rows where `brand_id` matches their brand membership.
4. Viewers see rows where `brand_id` matches their brand membership (read-only).
5. Service role (used by the backend pipeline) bypasses RLS entirely.

**Standard policy template applied to every brand-scoped table:**

```sql
-- Enable RLS
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;

-- Platform admins see everything
CREATE POLICY platform_admins_all ON episodes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'platform_admin'
    )
  );

-- Brand members see their brand's data
CREATE POLICY brand_members_select ON episodes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM brand_memberships bm
      WHERE bm.user_id = auth.uid()
      AND bm.brand_id = episodes.brand_id
    )
  );

-- Brand admins and reviewers can write
CREATE POLICY brand_admins_write ON episodes
  FOR INSERT, UPDATE TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM brand_memberships bm
      WHERE bm.user_id = auth.uid()
      AND bm.brand_id = episodes.brand_id
      AND bm.role IN ('brand_admin', 'reviewer')
    )
  );
```

The application backend uses the Supabase service role for pipeline operations (which bypasses RLS — necessary because the pipeline is not a user). The review UI uses authenticated user sessions and is bound by RLS.

This separation is critical: the *pipeline* doesn't need RLS because it's a trusted internal service. The *UI* absolutely does, because it's where humans (and possibly future external customers) interact with data.

## Indexes Strategy

Indexes are not retrofitted. They're designed in from day one based on the query patterns each module will execute.

The indexes documented per-table above cover the primary access patterns. As query patterns emerge in production, additional indexes will be added via migrations. Watch the Supabase performance advisor.

A few principles:

- **Composite indexes match the leading columns of common queries.** `idx_block_executions_brand_block(brand_id, block_name, started_at DESC)` supports "show me Hosts Corner runs for Castor Abbott in the last week" without a sort.
- **Partial indexes for common filters.** `WHERE status = 'pending_review'` makes the review queue query fast even as the table grows.
- **Vector indexes on embedding columns.** `ivfflat` with `vector_cosine_ops` for similarity search.

## Migration Strategy

**Migration files live in `infra/supabase/migrations/`.** Numbered sequentially with descriptive names: `0001_initial_schema.sql`, `0002_seed_brands.sql`, `0003_add_experiments.sql`.

**Each migration is idempotent where possible.** `CREATE TABLE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING` for seed data.

**Migrations are forward-only.** No down migrations. If a migration is wrong, write a new migration that fixes it. This is opinionated — down migrations are a footgun in practice and rarely actually used.

**Local dev:** `supabase migration up` applies pending migrations. `supabase db reset` blows away local DB and reapplies from scratch. CI runs `supabase db reset` to ensure migrations work from zero.

**Production deployments:** Migrations applied via Supabase CLI in CI/CD pipeline before app deployments. If a migration fails in CI, the app deployment is blocked.

**Schema dump:** Every successful production migration triggers a schema dump committed to `infra/supabase/schema.sql`. This is the human-readable source of truth for the current state.

## Migration from Google Sheets

Phase 1 migration includes a one-time import from the existing `Featured` Google Sheet to Supabase. The script:

1. Reads the sheet via Google Sheets API.
2. For each row, parses the (date, section, type, item_name, concept) tuple.
3. Generates an embedding for the concept using `text-embedding-3-large`.
4. Inserts into `content_concepts` with appropriate `brand_id` (Castor Abbott initially), `lookback_until` derived from the section's configured lookback window.
5. Records the migration run in `audit_log`.

The script lives in `apps/pipeline/src/scripts/migrate-from-sheets.ts`. Run once per brand during onboarding.

After the import, the Google Sheet is deprecated. The Supabase tables are the source of truth going forward. The MindStudio system (running in parallel during cutover) can read the sheet but no longer writes to it.

## Backup & Recovery

**Supabase managed backups.** Daily automated backups with 7-day retention on the production tier. 30-day retention on the team tier.

**Point-in-time recovery.** Available on team tier. Worth the cost for a content production system.

**Application-level export:** A nightly cron job exports critical tables (episodes, episode_revisions, content_concepts, framework_concepts, subscribers, audit_log) to JSON files in Vercel Blob storage. This is a redundant backup — if Supabase fails catastrophically, we have everything we need to rebuild on another database.

**Test restore procedure quarterly.** Documented in `docs/runbooks/disaster-recovery.md`. Includes the actual command sequence for restoring from backup, validating data integrity, switching DNS, and resuming operations.

## Open Decisions for the Dev Team

- **Specific embedding dimension:** 1536 (text-embedding-3-large) is the default. text-embedding-3-small at 1536 is acceptable. Smaller dimensions trade precision for query speed; the default is appropriate for our scale.
- **ivfflat vs hnsw for vector indexes:** ivfflat is the default for now. Switch to hnsw if vector query performance becomes a bottleneck (it won't at our scale for at least 12 months).
- **Whether to store full block I/O or rely on log aggregation:** Currently spec'd to store in DB with truncation. If row sizes become problematic, move to object storage (Vercel Blob, S3) and store URLs in DB.
- **Dynamic segment evaluation strategy:** Materialized vs. on-the-fly. Spec'd as flexible (jsonb filter definitions). Implementation choice is deferred to `06_distribution_platform`.

## Acceptance Criteria

The data model is complete when:

- [ ] All tables in groups 1-8 are created via migration files.
- [ ] All foreign key relationships are in place.
- [ ] All indexes documented above are created.
- [ ] RLS policies are enabled on all brand-scoped tables and tested with at least three user roles.
- [ ] Seed data for the four brands is in place.
- [ ] pgvector extension is enabled and at least one ivfflat index is built.
- [ ] A test exists that verifies cross-brand data isolation: a query authenticated as a Castor Abbott reviewer cannot return Cortex data even via crafted SQL.
- [ ] The Google Sheets migration script exists and has been run successfully against a test environment.
- [ ] Schema dump is generated and committed to `infra/supabase/schema.sql`.
- [ ] Backup and disaster recovery procedures are documented in `docs/runbooks/`.

---

**Next:** Read `03_voice_system.spec.md` for how voice modules compose and how the existing system prompts decompose into reusable units.
