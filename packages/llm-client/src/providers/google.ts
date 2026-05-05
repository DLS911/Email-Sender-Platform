import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ProviderAdapter } from "../types.js";

let client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI {
  if (!client) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");
    client = new GoogleGenerativeAI(apiKey);
  }
  return client;
}

export const googleAdapter: ProviderAdapter = {
  name: "google",
  async generate({ model, systemPrompt, userPrompt, temperature, maxTokens }) {
    const startedAt = Date.now();
    const m = getClient().getGenerativeModel({
      model,
      systemInstruction: systemPrompt,
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    });
    const resp = await m.generateContent(userPrompt);
    const text = resp.response.text();
    const usage = resp.response.usageMetadata;
    return {
      text,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      latencyMs: Date.now() - startedAt,
    };
  },
};
