import Anthropic from "@anthropic-ai/sdk";
import type { ProviderAdapter } from "../types.js";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey });
  }
  return client;
}

export const anthropicAdapter: ProviderAdapter = {
  name: "anthropic",
  async generate({ model, systemPrompt, userPrompt, temperature, maxTokens }) {
    const startedAt = Date.now();
    const resp = await getClient().messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = resp.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return {
      text,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
    };
  },
};
