import { z } from "zod";

export const BrandIdSchema = z.enum([
  "castor_abbott",
  "cortex",
  "fidelon",
  "treasure_financial",
]);
export type BrandId = z.infer<typeof BrandIdSchema>;

export const EditionSchema = z.enum(["weekday", "weekend", "special"]);
export type Edition = z.infer<typeof EditionSchema>;

export const RunContextSchema = z.object({
  runId: z.string().uuid(),
  brandId: BrandIdSchema,
  blockName: z.string().min(1),
});
export type RunContext = z.infer<typeof RunContextSchema>;

export const LLMProviderSchema = z.enum(["anthropic", "openai", "google"]);
export type LLMProvider = z.infer<typeof LLMProviderSchema>;

export const ModelConfigSchema = z.object({
  provider: LLMProviderSchema,
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  max_tokens: z.number().int().positive(),
  reasoning: z.boolean().default(false),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const ModelRoleConfigSchema = z.object({
  primary: ModelConfigSchema,
  fallback: ModelConfigSchema,
});
export type ModelRoleConfig = z.infer<typeof ModelRoleConfigSchema>;
