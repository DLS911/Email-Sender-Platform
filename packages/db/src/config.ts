import { logger } from "@platform/observability";
import { ConfigError } from "@platform/schemas";
import { createServiceRoleClient } from "./client.js";

type ConfigCacheEntry = { value: unknown; cachedAt: number };
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, ConfigCacheEntry>();

type GetOptions = {
  brandId?: string | null | undefined;
  environment?: string | undefined;
};

type ConfigRow = { value: unknown };

function cacheKey(key: string, brandId: string | null, environment: string): string {
  return `${key}::${brandId ?? ""}::${environment}`;
}

/**
 * Read a platform_config value. Lookup order:
 *   brand-specific + environment → platform-wide + environment → throw.
 *
 * Cached in-memory with a 60s TTL. Cache invalidation on write happens
 * via Supabase Realtime subscription (wired up in the worker startup).
 */
async function get<T = unknown>(key: string, opts: GetOptions = {}): Promise<T> {
  const env = opts.environment ?? process.env.PLATFORM_ENVIRONMENT ?? "development";
  const brandId = opts.brandId ?? null;
  const cKey = cacheKey(key, brandId, env);

  const cached = cache.get(cKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.value as T;
  }

  const client = createServiceRoleClient();

  if (brandId) {
    const { data } = await client
      .from("platform_config")
      .select("value")
      .eq("key", key)
      .eq("brand_id", brandId)
      .eq("environment", env)
      .maybeSingle();
    const row = data as ConfigRow | null;
    if (row && row.value !== undefined) {
      cache.set(cKey, { value: row.value, cachedAt: Date.now() });
      return row.value as T;
    }
  }

  const { data } = await client
    .from("platform_config")
    .select("value")
    .eq("key", key)
    .is("brand_id", null)
    .eq("environment", env)
    .maybeSingle();
  const row = data as ConfigRow | null;

  if (!row || row.value === undefined) {
    throw new ConfigError(`config key not found: ${key}`, {
      context: { key, brandId, environment: env },
    });
  }

  cache.set(cKey, { value: row.value, cachedAt: Date.now() });
  return row.value as T;
}

function invalidate(key?: string): void {
  if (!key) {
    cache.clear();
    logger.debug("config.cache_cleared");
    return;
  }
  for (const k of cache.keys()) {
    if (k.startsWith(`${key}::`)) cache.delete(k);
  }
}

export const config = { get, invalidate };
