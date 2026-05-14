-- 0008: pgvector similarity RPC for content_concepts brain lookup.
--
-- The Supabase JS client cannot express the `<=>` cosine distance operator
-- directly. Postgres functions called via .rpc() are the canonical way to
-- bridge pgvector queries into application code.
--
-- match_content_concepts: returns content concepts most similar to a query
-- embedding, scoped by brand and a minimum cosine similarity threshold.
-- Similarity is computed as (1 - cosine_distance), so a similarity of 1.0
-- means identical and 0.85+ usually means "same conceptual territory."

CREATE OR REPLACE FUNCTION match_content_concepts(
  query_embedding vector(1536),
  p_brand_id text,
  match_threshold float DEFAULT 0.80,
  match_count int DEFAULT 20,
  section_filter text DEFAULT NULL,
  since timestamptz DEFAULT (now() - interval '180 days')
)
RETURNS TABLE (
  id uuid,
  episode_id uuid,
  section_name text,
  concept_summary text,
  surface_form text,
  used_at timestamptz,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    cc.id,
    cc.episode_id,
    cc.section_name,
    cc.concept_summary,
    cc.surface_form,
    cc.used_at,
    1 - (cc.concept_embedding <=> query_embedding) AS similarity
  FROM content_concepts cc
  WHERE cc.brand_id = p_brand_id
    AND cc.used_at >= since
    AND cc.concept_embedding IS NOT NULL
    AND (section_filter IS NULL OR cc.section_name = section_filter)
    AND 1 - (cc.concept_embedding <=> query_embedding) >= match_threshold
  ORDER BY cc.concept_embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION match_content_concepts(vector(1536), text, float, int, text, timestamptz)
  TO service_role, authenticated, anon;

-- Convenience function: load the N most recent concepts for a brand without
-- requiring an embedding query. Used to seed the writer prompt with "concepts
-- already covered" context.

CREATE OR REPLACE FUNCTION recent_content_concepts(
  p_brand_id text,
  match_count int DEFAULT 60,
  since timestamptz DEFAULT (now() - interval '180 days')
)
RETURNS TABLE (
  id uuid,
  section_name text,
  concept_summary text,
  surface_form text,
  used_at timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT
    cc.id,
    cc.section_name,
    cc.concept_summary,
    cc.surface_form,
    cc.used_at
  FROM content_concepts cc
  WHERE cc.brand_id = p_brand_id
    AND cc.used_at >= since
  ORDER BY cc.used_at DESC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION recent_content_concepts(text, int, timestamptz)
  TO service_role, authenticated, anon;
