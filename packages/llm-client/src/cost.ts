/**
 * Per-provider cost calculation. Pricing in USD per 1M tokens.
 * Updated from public pricing pages. Refresh periodically.
 */

type Pricing = { input: number; output: number };

const PRICING: Record<string, Pricing> = {
  // Anthropic — claude.ai/pricing
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },

  // OpenAI — openai.com/api/pricing
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
  "text-embedding-3-small": { input: 0.02, output: 0 },

  // Google — ai.google.dev/pricing
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model];
  if (!p) return 0; // unknown model — emit a warning elsewhere; don't crash
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
