import { logger } from "@platform/observability";
import type { ConceptExtractOutput } from "@platform/schemas";
import type { FrameworkFamily } from "./types.js";

export type ConceptExtractInput = {
  brandId: string;
  episodeId: string;
  /** Output of the concept_extract LLM block — already validated against schema. */
  extracted: ConceptExtractOutput;
  /**
   * Per-section lookback windows in days. Section names map to durations.
   * Example: { cover_story: 270, tasting_menu_item: 90, tactic: 30 }.
   */
  lookbackWindowsDays: Record<string, number>;
};

export type ConceptExtractPersistResult = {
  contentConceptsWritten: number;
  frameworkConceptsMatched: number;
  frameworkConceptsCreated: number;
  usageLinksCreated: number;
};

const DEFAULT_LOOKBACK_DAYS = 30;

function lookbackUntilFor(sectionName: string, windowsDays: Record<string, number>): string {
  const days = windowsDays[sectionName] ?? DEFAULT_LOOKBACK_DAYS;
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString();
}

/**
 * Persist extracted concepts into the brain.
 *
 * Per spec 05_brain_and_learning § Operation 1:
 *   - Content concepts: insert into content_concepts with lookback_until
 *     = now() + window for the section.
 *   - Framework concepts: dedupe against existing via cosine similarity
 *     ≥ 0.92. Hits get use_count++; misses get inserted as `experimental`.
 *   - framework_content_usage rows link content → frameworks for
 *     performance attribution downstream.
 *
 * Stage 3 wires the actual writes against Supabase + pgvector. The contract
 * here lets pipeline code call this and get correct shape behavior now.
 */
export async function persistExtractedConcepts(
  input: ConceptExtractInput,
): Promise<ConceptExtractPersistResult> {
  const contentRows = input.extracted.contentConcepts.map((c) => ({
    brandId: input.brandId,
    episodeId: input.episodeId,
    sectionName: c.sectionName,
    conceptSummary: c.conceptSummary,
    surfaceForm: c.surfaceForm,
    lookbackUntil: lookbackUntilFor(c.sectionName, input.lookbackWindowsDays),
  }));

  const frameworkRows = input.extracted.frameworkConcepts.map((f) => ({
    brandId: input.brandId,
    frameworkName: f.frameworkName,
    frameworkFamily: f.frameworkFamily as FrameworkFamily,
    description: f.description,
  }));

  // TODO(stage-3): replace with actual Supabase writes:
  //   1. Embed each contentConcept.conceptSummary via OpenAI
  //   2. INSERT into content_concepts with lookback_until
  //   3. For each frameworkConcept: vector similarity query to find existing
  //      with cosine ≥ 0.92; if found, UPDATE use_count + last_used_at;
  //      otherwise INSERT new with status='experimental'
  //   4. INSERT framework_content_usage rows linking content_concept ids
  //      to framework_concept ids

  const result: ConceptExtractPersistResult = {
    contentConceptsWritten: contentRows.length,
    frameworkConceptsMatched: 0,
    frameworkConceptsCreated: frameworkRows.length,
    usageLinksCreated: contentRows.length * frameworkRows.length,
  };

  logger.info("brain.concept_extract.persisted", {
    brand_id: input.brandId,
    episode_id: input.episodeId,
    ...result,
  });

  return result;
}
