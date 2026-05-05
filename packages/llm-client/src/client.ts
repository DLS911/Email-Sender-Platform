import { logger } from "@platform/observability";
import { LLMGenerationError } from "@platform/schemas";
import type { ModelConfig } from "@platform/schemas";
import type { z } from "zod";
import { tryValidate } from "./auto-heal.js";
import { estimateCost } from "./cost.js";
import { anthropicAdapter } from "./providers/anthropic.js";
import { googleAdapter } from "./providers/google.js";
import { openaiAdapter } from "./providers/openai.js";
import { resolveModelRole } from "./role-resolver.js";
import type { GenerateOptions, GenerateResult, ProviderAdapter } from "./types.js";

const ADAPTERS: Record<string, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
};

const JSON_MODE_SUFFIX =
  "\n\nReturn ONLY valid JSON matching the requested schema. No preamble, no markdown fences, no commentary.";

export class LLMClient {
  async generate<S extends z.ZodTypeAny>(
    opts: GenerateOptions<S>,
  ): Promise<GenerateResult<z.infer<S>>> {
    const role =
      opts.modelOverride ?? (await resolveModelRole(opts.modelRole, opts.context.brandId));
    const maxRetries = opts.maxRetries ?? 2;

    const systemPrompt = `${opts.systemPrompt}${JSON_MODE_SUFFIX}`;

    let attempt = 0;
    let lastError: string | null = null;
    let totalInput = 0;
    let totalOutput = 0;
    let totalLatency = 0;

    const tryModel = async (
      cfg: ModelConfig,
      label: "primary" | "fallback",
    ): Promise<GenerateResult<z.infer<S>> | null> => {
      const adapter = ADAPTERS[cfg.provider];
      if (!adapter) {
        throw new LLMGenerationError(`unknown provider: ${cfg.provider}`, {
          context: { provider: cfg.provider },
        });
      }

      for (let i = 0; i <= maxRetries; i++) {
        attempt++;
        const userPrompt = lastError
          ? `${opts.userPrompt}\n\n<previous_attempt_failed_validation>\n${lastError}\nReturn corrected JSON only.\n</previous_attempt_failed_validation>`
          : opts.userPrompt;

        try {
          const resp = await adapter.generate({
            model: cfg.model,
            systemPrompt,
            userPrompt,
            temperature: cfg.temperature,
            maxTokens: cfg.max_tokens,
            reasoning: cfg.reasoning,
          });
          totalInput += resp.inputTokens;
          totalOutput += resp.outputTokens;
          totalLatency += resp.latencyMs;

          const validation = tryValidate(opts.schema, resp.text);

          logger.info("llm.call", {
            block_name: opts.context.blockName,
            run_id: opts.context.runId,
            brand_id: opts.context.brandId,
            role: opts.modelRole,
            provider: cfg.provider,
            model: cfg.model,
            input_tokens: resp.inputTokens,
            output_tokens: resp.outputTokens,
            cost_usd: estimateCost(cfg.model, resp.inputTokens, resp.outputTokens),
            latency_ms: resp.latencyMs,
            attempt,
            validation_status: validation.ok
              ? validation.healed
                ? "auto_healed"
                : "passed"
              : "failed",
            model_label: label,
          });

          if (validation.ok) {
            return {
              output: validation.value,
              resolved: {
                role: opts.modelRole,
                primary: role.primary,
                fallback: role.fallback,
                actuallyUsed: { provider: cfg.provider, model: cfg.model },
              },
              usage: {
                input_tokens: totalInput,
                output_tokens: totalOutput,
                cost_usd: estimateCost(cfg.model, totalInput, totalOutput),
                latency_ms: totalLatency,
              },
              validation: validation.healed
                ? "auto_healed"
                : label === "fallback"
                  ? "fallback_validated"
                  : "passed",
              retries: attempt - 1,
              fallback_used: label === "fallback",
            };
          }
          lastError = validation.error;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          logger.warn("llm.call_error", {
            block_name: opts.context.blockName,
            run_id: opts.context.runId,
            provider: cfg.provider,
            model: cfg.model,
            attempt,
            error_message: lastError,
          });
        }
      }
      return null;
    };

    const primary = await tryModel(role.primary, "primary");
    if (primary) return primary;

    logger.warn("llm.fallback_triggered", {
      block_name: opts.context.blockName,
      run_id: opts.context.runId,
      role: opts.modelRole,
    });

    const fallback = await tryModel(role.fallback, "fallback");
    if (fallback) return fallback;

    throw new LLMGenerationError(`both primary and fallback exhausted for role ${opts.modelRole}`, {
      context: {
        role: opts.modelRole,
        primary_model: role.primary.model,
        fallback_model: role.fallback.model,
        attempts: attempt,
        last_error: lastError,
        run_id: opts.context.runId,
        block_name: opts.context.blockName,
      },
    });
  }
}
