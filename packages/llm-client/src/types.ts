import type { ModelConfig, ModelRoleConfig, RunContext } from "@platform/schemas";
import type { z } from "zod";

export type GenerateOptions<S extends z.ZodTypeAny> = {
  /**
   * Logical role like "weekend.writer". Resolved at call time from
   * platform_config. Hot-swappable models without code changes.
   */
  modelRole: string;
  systemPrompt: string;
  userPrompt: string;
  schema: S;
  maxRetries?: number;
  context: RunContext;
  /**
   * Optional override for the resolved role. Used by replay code
   * to reproduce historical runs against the model that was active then.
   */
  modelOverride?: ModelRoleConfig;
};

export type GenerateResult<T> = {
  output: T;
  resolved: {
    role: string;
    primary: ModelConfig;
    fallback: ModelConfig;
    actuallyUsed: { provider: string; model: string };
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    latency_ms: number;
  };
  validation: "passed" | "auto_healed" | "fallback_validated";
  retries: number;
  fallback_used: boolean;
};

export type ProviderAdapter = {
  name: "anthropic" | "openai" | "google";
  generate(args: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
    temperature: number;
    maxTokens: number;
    reasoning: boolean;
  }): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  }>;
};
