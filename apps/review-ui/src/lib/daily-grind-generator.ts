import Anthropic from "@anthropic-ai/sdk";
import { DAILY_GRIND_VOICE_SYSTEM_PROMPT } from "./daily-grind-voice-prompt";

export type DailyGrindSection = {
  name: string;
  body: string;
};

export type DailyGrindIssue = {
  headline: string;
  preheader: string;
  contentType: string;
  sections: DailyGrindSection[];
  meta: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
    issueDate: string;
  };
};

const MODEL = "claude-sonnet-4-5-20250929";
const TEMPERATURE = 0.4;
const MAX_TOKENS = 4000;

const INPUT_COST_PER_M = 3;
const OUTPUT_COST_PER_M = 15;

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_M + (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
}

function buildUserPrompt(issueDate: string, recentTopics: string[]): string {
  const parts: string[] = [];
  parts.push(`Today is ${issueDate}. Write today's Daily Grind issue.`);

  if (recentTopics.length > 0) {
    parts.push(
      `\nRecently covered topics (do NOT repeat or rehash):\n${recentTopics.map((t) => `- ${t}`).join("\n")}`,
    );
  }

  parts.push(
    `\nPick the content type and topic yourself. Lead with what an advisor opening their inbox at 6 AM will find immediately useful. Pick a topic that hasn't been covered recently per the list above (if provided).`,
  );

  parts.push(
    `\nReturn ONLY the JSON object specified in the system prompt. No markdown fences, no preamble.`,
  );

  return parts.join("\n");
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const lines = trimmed.split("\n");
    if (lines.length >= 3 && lines[lines.length - 1]!.startsWith("```")) {
      return lines.slice(1, -1).join("\n").trim();
    }
  }
  return trimmed;
}

type ParsedDraft = {
  headline: string;
  preheader: string;
  contentType: string;
  sections: DailyGrindSection[];
};

function parseDraft(rawText: string): ParsedDraft {
  const cleaned = stripCodeFences(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `daily_grind_generator: failed to parse model output as JSON: ${err instanceof Error ? err.message : String(err)}\nraw: ${cleaned.slice(0, 200)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("daily_grind_generator: model output is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  const headline = String(obj.headline ?? "").trim();
  const preheader = String(obj.preheader ?? "").trim();
  const contentType = String(obj.contentType ?? "tactic").trim();
  const rawSections = Array.isArray(obj.sections) ? obj.sections : [];

  if (!headline) throw new Error("daily_grind_generator: missing headline");
  if (rawSections.length === 0) throw new Error("daily_grind_generator: empty sections array");

  const sections: DailyGrindSection[] = rawSections.map((s, i) => {
    if (!s || typeof s !== "object") {
      throw new Error(`daily_grind_generator: section ${i} is not an object`);
    }
    const row = s as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    const body = String(row.body ?? "").trim();
    if (!name) throw new Error(`daily_grind_generator: section ${i} missing name`);
    if (!body) throw new Error(`daily_grind_generator: section ${i} missing body`);
    return { name, body };
  });

  return { headline, preheader, contentType, sections };
}

export async function generateDailyGrindIssue(opts: {
  issueDate: string;
  recentTopics?: string[];
  apiKey?: string;
}): Promise<DailyGrindIssue> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("daily_grind_generator: ANTHROPIC_API_KEY missing");
  }

  const client = new Anthropic({ apiKey });
  const userPrompt = buildUserPrompt(opts.issueDate, opts.recentTopics ?? []);

  const start = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: DAILY_GRIND_VOICE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;

  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== "text") {
    throw new Error("daily_grind_generator: model response missing text block");
  }

  const parsed = parseDraft(firstBlock.text);

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd = estimateCostUsd(inputTokens, outputTokens);

  return {
    ...parsed,
    meta: {
      model: MODEL,
      inputTokens,
      outputTokens,
      costUsd,
      latencyMs,
      issueDate: opts.issueDate,
    },
  };
}
