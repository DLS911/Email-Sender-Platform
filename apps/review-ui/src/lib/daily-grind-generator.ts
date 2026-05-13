import Anthropic from "@anthropic-ai/sdk";
import { DAILY_GRIND_VOICE_SYSTEM_PROMPT } from "./daily-grind-voice-prompt";
import type {
  DailyGrindContent,
  DailyGrindContentType,
  HowToStep,
  WorthKnowingItem,
} from "./daily-grind-html-template";

export type DailyGrindIssue = {
  content: DailyGrindContent;
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
const TEMPERATURE = 0.45;
const MAX_TOKENS = 6000;

const INPUT_COST_PER_M = 3;
const OUTPUT_COST_PER_M = 15;

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_M + (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
}

function buildUserPrompt(issueDate: string, recentTopics: string[]): string {
  const parts: string[] = [];
  parts.push(`Today is ${issueDate}. Write today's Daily Grind issue in full.`);

  if (recentTopics.length > 0) {
    parts.push(
      `\nRecently covered headlines (do NOT repeat or rehash these — pick a fresh angle):\n${recentTopics.map((t) => `- ${t}`).join("\n")}`,
    );
  }

  parts.push(
    `\nProduce a complete issue with the full structure: Opening Trifecta (Number/Unspoken/Flip), First Pull, three Worth Knowing items, the main content section (Tactic/Take/Story/Rant/Special), Grounds for Thought, Ancient Truth, P.S.`,
  );
  parts.push(
    `\nReturn ONLY the JSON object specified in the system prompt. No preamble, no markdown fences, no commentary.`,
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

function requireString(obj: Record<string, unknown>, key: string, context: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`daily_grind_generator: ${context}: missing string field "${key}"`);
  }
  return v.trim();
}

function requireObject(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown> {
  const v = obj[key];
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`daily_grind_generator: ${context}: missing object field "${key}"`);
  }
  return v as Record<string, unknown>;
}

function requireArray(obj: Record<string, unknown>, key: string, context: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    throw new Error(`daily_grind_generator: ${context}: missing array field "${key}"`);
  }
  return v;
}

const VALID_CONTENT_TYPES: DailyGrindContentType[] = ["tactic", "take", "story", "rant", "special"];

function parseContentType(raw: string): DailyGrindContentType {
  const lower = raw.toLowerCase().trim();
  if ((VALID_CONTENT_TYPES as string[]).includes(lower)) {
    return lower as DailyGrindContentType;
  }
  return "tactic";
}

function parseWorthKnowing(raw: unknown[]): WorthKnowingItem[] {
  if (raw.length < 1) {
    throw new Error("daily_grind_generator: worthKnowing must have at least one item");
  }
  return raw.map((r, i) => {
    if (!r || typeof r !== "object") {
      throw new Error(`daily_grind_generator: worthKnowing[${i}] not an object`);
    }
    const obj = r as Record<string, unknown>;
    const ctx = `worthKnowing[${i}]`;
    const item: WorthKnowingItem = {
      category: requireString(obj, "category", ctx),
      headline: requireString(obj, "headline", ctx),
      body: requireString(obj, "body", ctx),
      myTake: requireString(obj, "myTake", ctx),
    };
    if (typeof obj.stat === "string" && obj.stat.trim() !== "") {
      item.stat = obj.stat.trim();
    }
    if (typeof obj.statLabel === "string" && obj.statLabel.trim() !== "") {
      item.statLabel = obj.statLabel.trim();
    }
    if (
      typeof obj.statColor === "string" &&
      ["green", "red", "gold"].includes(obj.statColor)
    ) {
      item.statColor = obj.statColor as "green" | "red" | "gold";
    }
    return item;
  });
}

function parseHowToSteps(raw: unknown[]): HowToStep[] {
  if (raw.length < 2) {
    throw new Error("daily_grind_generator: howTo.steps must have at least 2 steps");
  }
  return raw.map((r, i) => {
    if (!r || typeof r !== "object") {
      throw new Error(`daily_grind_generator: howTo.steps[${i}] not an object`);
    }
    const obj = r as Record<string, unknown>;
    return {
      label: requireString(obj, "label", `howTo.steps[${i}]`),
      body: requireString(obj, "body", `howTo.steps[${i}]`),
    };
  });
}

function parseContent(rawText: string): DailyGrindContent {
  const cleaned = stripCodeFences(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `daily_grind_generator: failed to parse model output as JSON: ${err instanceof Error ? err.message : String(err)}\nfirst 200 chars: ${cleaned.slice(0, 200)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("daily_grind_generator: model output is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  const trifecta = requireObject(obj, "openingTrifecta", "root");
  const theNumberObj = requireObject(trifecta, "theNumber", "openingTrifecta");
  const theFlipObj = requireObject(trifecta, "theFlip", "openingTrifecta");

  const firstPullObj = requireObject(obj, "firstPull", "root");
  const firstPullParas = requireArray(firstPullObj, "paragraphs", "firstPull");

  const mainContentObj = requireObject(obj, "mainContent", "root");
  const howToObj = requireObject(mainContentObj, "howTo", "mainContent");
  const howToStepsRaw = requireArray(howToObj, "steps", "mainContent.howTo");

  const ancientObj = requireObject(obj, "ancientTruth", "root");

  return {
    headline: requireString(obj, "headline", "root"),
    preheader: requireString(obj, "preheader", "root"),
    contentType: parseContentType(requireString(obj, "contentType", "root")),
    openingTrifecta: {
      theNumber: {
        stat: requireString(theNumberObj, "stat", "openingTrifecta.theNumber"),
        description: requireString(theNumberObj, "description", "openingTrifecta.theNumber"),
      },
      theUnspoken: requireString(trifecta, "theUnspoken", "openingTrifecta"),
      theFlip: {
        conventional: requireString(theFlipObj, "conventional", "openingTrifecta.theFlip"),
        reality: requireString(theFlipObj, "reality", "openingTrifecta.theFlip"),
      },
    },
    firstPull: {
      paragraphs: firstPullParas.map((p, i) => {
        if (typeof p !== "string" || p.trim() === "") {
          throw new Error(`daily_grind_generator: firstPull.paragraphs[${i}] not a non-empty string`);
        }
        return p.trim();
      }),
    },
    worthKnowing: parseWorthKnowing(requireArray(obj, "worthKnowing", "root")),
    mainContent: {
      subhead: requireString(mainContentObj, "subhead", "mainContent"),
      intro: requireString(mainContentObj, "intro", "mainContent"),
      howTo: {
        title: requireString(howToObj, "title", "mainContent.howTo"),
        steps: parseHowToSteps(howToStepsRaw),
      },
      closing: requireString(mainContentObj, "closing", "mainContent"),
    },
    groundsForThought: requireString(obj, "groundsForThought", "root"),
    ancientTruth: {
      verse: requireString(ancientObj, "verse", "ancientTruth"),
      reference: requireString(ancientObj, "reference", "ancientTruth"),
      application: requireString(ancientObj, "application", "ancientTruth"),
    },
    ps: requireString(obj, "ps", "root"),
  };
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

  const content = parseContent(firstBlock.text);

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd = estimateCostUsd(inputTokens, outputTokens);

  return {
    content,
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
