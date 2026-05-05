import { logger } from "@platform/observability";
import type { ModelConfig } from "@platform/schemas";
import { LLMGenerationError } from "@platform/schemas";
import type { z } from "zod";
import { type ValidationOutcome, tryValidate } from "./auto-heal.js";
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

type Attempt<T> = {
  validation: ValidationOutcome<T>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

function buildUserPrompt(base: string, lastError: string | null): string {
  if (!lastError) return base;
  return `${base}\n\n<previous_attempt_failed_validation>\n${lastError}\nReturn corrected JSON only.\n</previous_attempt_failed_validation>`;
}

function getAdapter(name: string): ProviderAdapter {
  const adapter = ADAPTERS[name];
  if (!adapter) {
    throw new LLMGenerationError(`unknown provider: ${name}`, { context: { provider: name } });
  }
  return adapter;
}

async function runOnce<S extends z.ZodTypeAny>(
  cfg: ModelConfig,
  systemPrompt: string,
  userPrompt: string,
  schema: S,
): Promise<Attempt<z.infer<S>>> {
  const adapter = getAdapter(cfg.provider);
  const resp = await adapter.generate({
    model: cfg.model,
    systemPrompt,
    userPrompt,
    temperature: cfg.temperature,
    maxTokens: cfg.max_tokens,
    reasoning: cfg.reasoning,
  });
  return {
    validation: tryValidate(schema, resp.text),
    inputTokens: resp.inputTokens,
    outputTokens: resp.outputTokens,
    latencyMs: resp.latencyMs,
  };
}

export class LLMClient {
  async generate<S extends z.ZodTypeAny>(
    opts: GenerateOptions<S>,
  ): Promise<GenerateResult<z.infer<S>>> {
    const role =
      opts.modelOverride ?? (await resolveModelRole(opts.modelRole, opts.context.brandId));
    const maxRetries = opts.maxRetries ?? 2;
    const systemPrompt = `${opts.systemPrompt}${JSON_MODE_SUFFIX}`;

    const totals = { input: 0, output: 0, latency: 0, attempt: 0 };
    let lastError: string | null = null;

    const tryModel = async (
      cfg: ModelConfig,
      label: "primary" | "fallback",
    ): Promise<GenerateResult<z.infer<S>> | null> => {
      for (let i = 0; i <= maxRetries; i++) {
        totals.attempt++;
        const userPrompt = buildUserPrompt(opts.userPrompt, lastError);

        let attempt: Attempt<z.infer<S>>;
        try {
          attempt = await runOnce(cfg, systemPrompt, userPrompt, opts.schema);
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          logger.warn("llm.call_error", {
            block_name: opts.context.blockName,
            run_id: opts.context.runId,
            provider: cfg.provider,
            model: cfg.model,
            attempt: totals.attempt,
            error_message: lastError,
          });
          continue;
        }

        totals.input += attempt.inputTokens;
        totals.output += attempt.outputTokens;
        totals.latency += attempt.latencyMs;

        const validationStatus = attempt.validation.ok
          ? attempt.validation.healed
            ? "auto_healed"
            : "passed"
          : "failed";

        logger.info("llm.call", {
          block_name: opts.context.blockName,
          run_id: opts.context.runId,
          brand_id: opts.context.brandId,
          role: opts.modelRole,
          provider: cfg.provider,
          model: cfg.model,
          input_tokens: attempt.inputTokens,
          output_tokens: attempt.outputTokens,
          cost_usd: estimateCost(cfg.model, attempt.inputTokens, attempt.outputTokens),
          latency_ms: attempt.latencyMs,
          attempt: totals.attempt,
          validation_status: validationStatus,
          model_label: label,
        });

        if (attempt.validation.ok) {
          return {
            output: attempt.validation.value,
            resolved: {
              role: opts.modelRole,
              primary: role.primary,
              fallback: role.fallback,
              actuallyUsed: { provider: cfg.provider, model: cfg.model },
            },
            usage: {
              input_tokens: totals.input,
              output_tokens: totals.output,
              cost_usd: estimateCost(cfg.model, totals.input, totals.output),
              latency_ms: totals.latency,
            },
            validation: attempt.validation.healed
              ? "auto_healed"
              : label === "fallback"
                ? "fallback_validated"
                : "passed",
            retries: totals.attempt - 1,
            fallback_used: label === "fallback",
          };
        }
        lastError = attempt.validation.error;
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
        attempts: totals.attempt,
        last_error: lastError,
        run_id: opts.context.runId,
        block_name: opts.context.blockName,
      },
    });
  }
}
