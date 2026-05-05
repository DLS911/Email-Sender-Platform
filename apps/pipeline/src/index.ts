/**
 * Pipeline worker entry point.
 *
 * Picks up `pipeline_runs` rows in the queue and executes weekday or weekend
 * pipelines per spec 04. Acquires a per-brand advisory lock for the duration
 * of each run to prevent concurrent runs racing the brain.
 *
 * Stage 3 wiring lands the actual block compositions. Stage 1 just stands
 * up the worker shell.
 */
import { logger } from "@platform/observability";

async function main(): Promise<void> {
  logger.info("pipeline.worker_started", {
    node_version: process.version,
    environment: process.env.PLATFORM_ENVIRONMENT ?? "development",
  });

  // TODO(stage-3): connect to Supabase queue, poll for pending runs,
  // dispatch to weekday or weekend orchestrator, release lock on completion.
  // For now we just log a heartbeat and exit so CI can build cleanly.

  logger.info("pipeline.worker_idle", { reason: "no_orchestrator_yet" });
}

main().catch((err: unknown) => {
  logger.error("pipeline.fatal", {
    error_message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
