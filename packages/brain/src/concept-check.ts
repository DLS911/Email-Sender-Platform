import { logger } from "@platform/observability";
import type { ConceptCheckInput, ConceptCheckResult, ContentConcept } from "./types.js";

const DEFAULT_SIMILARITY_THRESHOLD = 0.78;

/**
 * Cosine similarity between two embedding vectors. Pure function — no I/O.
 * Returns 0 if either vector is empty or lengths mismatch.
 */
export function similarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Check candidate concepts against the brain. Block any candidate whose
 * similarity to a recently-used or hard-blocked concept exceeds the
 * threshold (default 0.78 — calibrated per spec 05).
 *
 * Stage 3 wires this to actual pgvector queries. The interface here is
 * stable so block code can call it now and get correct shape behavior.
 */
export async function checkConcept(input: ConceptCheckInput): Promise<ConceptCheckResult> {
  const threshold = input.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  // TODO(stage-3): replace with pgvector query against content_concepts:
  //   SELECT * FROM content_concepts
  //   WHERE brand_id = $1 AND section_name = $2
  //   AND (lookback_until > now() OR hard_blocked = true)
  //   AND concept_embedding <=> $candidate_embedding < (1 - $threshold)
  // For now we return an always-pass result so the pipeline can be exercised
  // end-to-end with mock data.
  const recent: ContentConcept[] = [];

  const blocked: string[] = [];
  const near: ConceptCheckResult["near"] = [];

  for (const candidate of input.candidates) {
    if (!candidate.embedding) continue;
    for (const past of recent) {
      if (!past.conceptEmbedding) continue;
      const sim = similarity(candidate.embedding, past.conceptEmbedding);
      if (past.hardBlocked || sim >= 0.92) {
        blocked.push(candidate.slug);
        break;
      }
      if (sim >= threshold) {
        near.push({ candidate: candidate.slug, matchedConcept: past, similarity: sim });
      }
    }
  }

  logger.info("brain.concept_check", {
    brand_id: input.brandId,
    section_name: input.sectionName,
    candidates: input.candidates.length,
    blocked_count: blocked.length,
    near_count: near.length,
    threshold,
  });

  return {
    blocked,
    near,
    passed: blocked.length === 0,
  };
}
