-- Seed data: the four brands and the default model role configuration.
-- Idempotent — re-runs are safe.

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
VALUES
  ('llm.role.weekday.topic_proposer', NULL, 'production', '{
    "primary":  {"provider":"anthropic","model":"claude-sonnet-4-5-20250929","temperature":0.4,"max_tokens":4000,"reasoning":false},
    "fallback": {"provider":"anthropic","model":"claude-opus-4-20250514",   "temperature":0.4,"max_tokens":4000,"reasoning":false}
  }'::jsonb),
  ('llm.role.weekday.research', NULL, 'production', '{
    "primary":  {"provider":"anthropic","model":"claude-sonnet-4-5-20250929","temperature":0,  "max_tokens":8000,"reasoning":false},
    "fallback": {"provider":"anthropic","model":"claude-opus-4-20250514",   "temperature":0,  "max_tokens":8000,"reasoning":false}
  }'::jsonb),
  ('llm.role.weekday.writer', NULL, 'production', '{
    "primary":  {"provider":"anthropic","model":"claude-sonnet-4-5-20250929","temperature":0.3,"max_tokens":8000,"reasoning":false},
    "fallback": {"provider":"anthropic","model":"claude-opus-4-20250514",   "temperature":0.3,"max_tokens":8000,"reasoning":false}
  }'::jsonb),
  ('llm.role.weekday.opening_trifecta', NULL, 'production', '{
    "primary":  {"provider":"anthropic","model":"claude-sonnet-4-5-20250929","temperature":0.5,"max_tokens":4000,"reasoning":false},
    "fallback": {"provider":"anthropic","model":"claude-opus-4-20250514",   "temperature":0.5,"max_tokens":4000,"reasoning":false}
  }'::jsonb),
  ('llm.role.weekend.destination_proposer', NULL, 'production', '{
    "primary":  {"provider":"anthropic","model":"claude-sonnet-4-5-20250929","temperature":0.7,"max_tokens":4000,"reasoning":false},
    "fallback": {"provider":"anthropic","model":"claude-opus-4-20250514",   "temperature":0.7,"max_tokens":4000,"reasoning":false}
  }'::jsonb),
  ('llm.role.weekend.research', NULL, 'production', '{
    "primary":  {"provider":"anthropic","model":"claude-sonnet-4-5-20250929","temperature":0.2,"max_tokens":8000,"reasoning":false},
    "fallback": {"provider":"anthropic","model":"claude-opus-4-20250514",   "temperature":0.2,"max_tokens":8000,"reasoning":false}
  }'::jsonb),
  ('llm.role.weekend.writer', NULL, 'production', '{
    "primary":  {"provider":"anthropic","model":"claude-opus-4-20250514",   "temperature":0.4,"max_tokens":8000,"reasoning":false},
    "fallback": {"provider":"anthropic","model":"claude-sonnet-4-5-20250929","temperature":0.4,"max_tokens":8000,"reasoning":false}
  }'::jsonb),
  ('llm.role.weekend.fact_checker', NULL, 'production', '{
    "primary":  {"provider":"anthropic","model":"claude-sonnet-4-5-20250929","temperature":0,  "max_tokens":4000,"reasoning":false},
    "fallback": {"provider":"anthropic","model":"claude-opus-4-20250514",   "temperature":0,  "max_tokens":4000,"reasoning":false}
  }'::jsonb),
  ('llm.role.editor.standard', NULL, 'production', '{
    "primary":  {"provider":"anthropic","model":"claude-sonnet-4-5-20250929","temperature":0,  "max_tokens":8000,"reasoning":false},
    "fallback": {"provider":"anthropic","model":"claude-opus-4-20250514",   "temperature":0,  "max_tokens":8000,"reasoning":false}
  }'::jsonb),
  ('llm.role.persona.evaluator', NULL, 'production', '{
    "primary":  {"provider":"anthropic","model":"claude-sonnet-4-5-20250929","temperature":0,  "max_tokens":4000,"reasoning":false},
    "fallback": {"provider":"anthropic","model":"claude-opus-4-20250514",   "temperature":0,  "max_tokens":4000,"reasoning":false}
  }'::jsonb),
  ('llm.role.concept.extractor', NULL, 'production', '{
    "primary":  {"provider":"anthropic","model":"claude-sonnet-4-5-20250929","temperature":0,  "max_tokens":4000,"reasoning":false},
    "fallback": {"provider":"anthropic","model":"claude-opus-4-20250514",   "temperature":0,  "max_tokens":4000,"reasoning":false}
  }'::jsonb)
ON CONFLICT DO NOTHING;
