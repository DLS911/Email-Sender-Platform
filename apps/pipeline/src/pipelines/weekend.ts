/**
 * Weekend pipeline (Saturday Morning Latte). Implementation per spec 04.
 *
 * Orchestrates: content_type_select → destination_proposer → destination_validator
 * (with retry on failure) → research → draft → fact_check → editor_pass →
 * quality_gate (with revision loop) → assemble_html → persist → queue for review.
 */
import { withBrandLock } from "@platform/db";
import { logger } from "@platform/observability";
import type { BrandId } from "@platform/schemas";

export async function runWeekendPipeline(brandId: BrandId): Promise<void> {
  await withBrandLock(brandId, async () => {
    logger.info("pipeline.weekend.start", { brand_id: brandId });
    // TODO(stage-3): block-by-block orchestration here.
    logger.info("pipeline.weekend.skipped", {
      brand_id: brandId,
      reason: "blocks_not_implemented_yet",
    });
  });
}
