import { logger } from "@platform/observability";
import { PipelineError } from "@platform/schemas";
import { createServiceRoleClient } from "./client.js";

/**
 * Postgres advisory locks scoped to a brand. Prevents two pipeline runs
 * for the same brand from racing the brain or the editorial calendar.
 *
 * Lock granularity: per brand. Different brands run concurrently;
 * same brand serializes.
 *
 * Implementation: Postgres `pg_advisory_lock(int)` via Supabase RPC.
 * A migration registers the SQL functions `acquire_brand_lock(text)`
 * and `release_brand_lock(text)`.
 */

const HASH_NAMESPACE = 0xca570a55;

function brandLockKey(brandId: string): number {
  let h = HASH_NAMESPACE;
  for (let i = 0; i < brandId.length; i++) {
    h = (h * 31 + brandId.charCodeAt(i)) | 0;
  }
  return h;
}

export async function acquireBrandLock(brandId: string): Promise<void> {
  const client = createServiceRoleClient();
  const lockKey = brandLockKey(brandId);
  const { error } = await client.rpc("pg_advisory_lock", { key: lockKey } as never);
  if (error) {
    throw new PipelineError("advisory_lock_failed", "could not acquire brand lock", {
      context: { brandId, lockKey, error: error.message },
    });
  }
  logger.info("brand_lock.acquired", { brand_id: brandId, lock_key: lockKey });
}

export async function releaseBrandLock(brandId: string): Promise<void> {
  const client = createServiceRoleClient();
  const lockKey = brandLockKey(brandId);
  const { error } = await client.rpc("pg_advisory_unlock", { key: lockKey } as never);
  if (error) {
    logger.warn("brand_lock.release_failed", {
      brand_id: brandId,
      lock_key: lockKey,
      error_message: error.message,
    });
    return;
  }
  logger.info("brand_lock.released", { brand_id: brandId, lock_key: lockKey });
}

export async function withBrandLock<T>(brandId: string, fn: () => Promise<T>): Promise<T> {
  await acquireBrandLock(brandId);
  try {
    return await fn();
  } finally {
    await releaseBrandLock(brandId);
  }
}
