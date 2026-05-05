import { config } from "@platform/db";
import { ModelRoleConfigSchema, type ModelRoleConfig, ConfigError } from "@platform/schemas";

/**
 * Resolve a logical model role like "weekend.writer" to a concrete
 * primary/fallback model configuration.
 *
 * Resolution order:
 *   brand+environment specific → platform-default+environment → throw.
 *
 * The result is cached for 60s by the underlying config layer.
 */
export async function resolveModelRole(
  role: string,
  brandId?: string | null,
): Promise<ModelRoleConfig> {
  const key = `llm.role.${role}`;
  const raw = await config.get(key, { brandId });
  const parsed = ModelRoleConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`malformed model role config for ${role}`, {
      context: { role, issues: parsed.error.issues },
    });
  }
  return parsed.data;
}
