/**
 * Weekday pipeline (Daily Grind). Implementation per spec 04.
 *
 * Orchestrates: topic_proposer → concept_check → research → draft →
 * style_pass → editor_pass → fact_check → persona_evaluate (×10) →
 * score_aggregate → assemble_html → persist → queue for review.
 *
 * Stage 3 work. The shell here documents the planned shape.
 */
import { withBrandLock } from "@platform/db";
import { logger } from "@platform/observability";
import type { BrandId } from "@platform/schemas";

export async function runWeekdayPipeline(brandId: BrandId): Promise<void> {
  await withBrandLock(brandId, async () => {
    logger.info("pipeline.weekday.start", { brand_id: brandId });
    // TODO(stage-3): block-by-block orchestration here.
    logger.info("pipeline.weekday.skipped", {
      brand_id: brandId,
      reason: "blocks_not_implemented_yet",
    });
  });
}
