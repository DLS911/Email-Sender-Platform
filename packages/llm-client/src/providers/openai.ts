import OpenAI from "openai";
import type { ProviderAdapter } from "../types.js";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    client = new OpenAI({ apiKey });
  }
  return client;
}

export const openaiAdapter: ProviderAdapter = {
  name: "openai",
  async generate({ model, systemPrompt, userPrompt, temperature, maxTokens }) {
    const startedAt = Date.now();
    const resp = await getClient().chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const text = resp.choices[0]?.message?.content ?? "";
    return {
      text,
      inputTokens: resp.usage?.prompt_tokens ?? 0,
      outputTokens: resp.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    };
  },
};
