-- Seed data: the four brands and the default model role configuration.
-- Idempotent — re-runs are safe.
--
-- Uses jsonb_build_object() rather than '{...}'::jsonb because long inline
-- JSON values are vulnerable to copy-paste line wrapping (PostgreSQL accepts
-- newlines in string literals, but the JSON parser rejects newlines inside
-- string values). jsonb_build_object() builds the value server-side and is
-- immune to that class of error.

INSERT INTO brands (id, name, slug, audience_type) VALUES
  ('castor_abbott', 'Castor Abbott', 'castor-abbott', 'b2b'),
  ('cortex', 'Cortex', 'cortex', 'b2b'),
  ('fidelon', 'Fidelon', 'fidelon', 'both'),
  ('treasure_financial', 'Treasure Financial', 'treasure-financial', 'b2c')
ON CONFLICT (id) DO NOTHING;

-- Default model role configuration. Per spec 01_foundation § Default Model Roles.
-- Models default to current Anthropic releases. Hot-swappable via this table
-- without code changes.
INSERT INTO platform_config (key, brand_id, environment, value)
SELECT key, NULL::text, 'production', value FROM (VALUES
  ('llm.role.weekday.topic_proposer', jsonb_build_object(
    'primary', jsonb_build_object('provider','anthropic','model','claude-sonnet-4-5-20250929','temperature',0.4,'max_tokens',4000,'reasoning',false),
    'fallback', jsonb_build_object('provider','anthropic','model','claude-opus-4-20250514','temperature',0.4,'max_tokens',4000,'reasoning',false))),
  ('llm.role.weekday.research', jsonb_build_object(
    'primary', jsonb_build_object('provider','anthropic','model','claude-sonnet-4-5-20250929','temperature',0,'max_tokens',8000,'reasoning',false),
    'fallback', jsonb_build_object('provider','anthropic','model','claude-opus-4-20250514','temperature',0,'max_tokens',8000,'reasoning',false))),
  ('llm.role.weekday.writer', jsonb_build_object(
    'primary', jsonb_build_object('provider','anthropic','model','claude-sonnet-4-5-20250929','temperature',0.3,'max_tokens',8000,'reasoning',false),
    'fallback', jsonb_build_object('provider','anthropic','model','claude-opus-4-20250514','temperature',0.3,'max_tokens',8000,'reasoning',false))),
  ('llm.role.weekday.opening_trifecta', jsonb_build_object(
    'primary', jsonb_build_object('provider','anthropic','model','claude-sonnet-4-5-20250929','temperature',0.5,'max_tokens',4000,'reasoning',false),
    'fallback', jsonb_build_object('provider','anthropic','model','claude-opus-4-20250514','temperature',0.5,'max_tokens',4000,'reasoning',false))),
  ('llm.role.weekend.destination_proposer', jsonb_build_object(
    'primary', jsonb_build_object('provider','anthropic','model','claude-sonnet-4-5-20250929','temperature',0.7,'max_tokens',4000,'reasoning',false),
    'fallback', jsonb_build_object('provider','anthropic','model','claude-opus-4-20250514','temperature',0.7,'max_tokens',4000,'reasoning',false))),
  ('llm.role.weekend.research', jsonb_build_object(
    'primary', jsonb_build_object('provider','anthropic','model','claude-sonnet-4-5-20250929','temperature',0.2,'max_tokens',8000,'reasoning',false),
    'fallback', jsonb_build_object('provider','anthropic','model','claude-opus-4-20250514','temperature',0.2,'max_tokens',8000,'reasoning',false))),
  ('llm.role.weekend.writer', jsonb_build_object(
    'primary', jsonb_build_object('provider','anthropic','model','claude-opus-4-20250514','temperature',0.4,'max_tokens',8000,'reasoning',false),
    'fallback', jsonb_build_object('provider','anthropic','model','claude-sonnet-4-5-20250929','temperature',0.4,'max_tokens',8000,'reasoning',false))),
  ('llm.role.weekend.fact_checker', jsonb_build_object(
    'primary', jsonb_build_object('provider','anthropic','model','claude-sonnet-4-5-20250929','temperature',0,'max_tokens',4000,'reasoning',false),
    'fallback', jsonb_build_object('provider','anthropic','model','claude-opus-4-20250514','temperature',0,'max_tokens',4000,'reasoning',false))),
  ('llm.role.editor.standard', jsonb_build_object(
    'primary', jsonb_build_object('provider','anthropic','model','claude-sonnet-4-5-20250929','temperature',0,'max_tokens',8000,'reasoning',false),
    'fallback', jsonb_build_object('provider','anthropic','model','claude-opus-4-20250514','temperature',0,'max_tokens',8000,'reasoning',false))),
  ('llm.role.persona.evaluator', jsonb_build_object(
    'primary', jsonb_build_object('provider','anthropic','model','claude-sonnet-4-5-20250929','temperature',0,'max_tokens',4000,'reasoning',false),
    'fallback', jsonb_build_object('provider','anthropic','model','claude-opus-4-20250514','temperature',0,'max_tokens',4000,'reasoning',false))),
  ('llm.role.concept.extractor', jsonb_build_object(
    'primary', jsonb_build_object('provider','anthropic','model','claude-sonnet-4-5-20250929','temperature',0,'max_tokens',4000,'reasoning',false),
    'fallback', jsonb_build_object('provider','anthropic','model','claude-opus-4-20250514','temperature',0,'max_tokens',4000,'reasoning',false)))
) AS t(key, value)
ON CONFLICT DO NOTHING;
