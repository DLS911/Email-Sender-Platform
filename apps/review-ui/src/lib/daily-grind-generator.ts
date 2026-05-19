import Anthropic from "@anthropic-ai/sdk";
import { DAILY_GRIND_VOICE_SYSTEM_PROMPT } from "./daily-grind-voice-prompt";
import { RESEARCH_SYSTEM_PROMPT } from "./daily-grind-research-prompt";
import { runPerplexityResearch } from "./daily-grind-research-perplexity";
import type {
  DailyGrindContent,
  DailyGrindContentType,
  HowToStep,
  WorthKnowingItem,
} from "./daily-grind-html-template";

export type ResearchKeyStat = { number: string; label: string };
export type ResearchItem = {
  category: string;
  title: string;
  url: string;
  source: string;
  publishedDate?: string;
  summary: string;
  keyStats?: ResearchKeyStat[];
  notableQuote?: string;
};

export type ResearchBundle = {
  researchedOn: string;
  items: ResearchItem[];
};

export type DailyGrindIssue = {
  content: DailyGrindContent;
  research: ResearchBundle;
  meta: {
    model: string;
    researchInputTokens: number;
    researchOutputTokens: number;
    researchWebSearches: number;
    writerInputTokens: number;
    writerOutputTokens: number;
    totalCostUsd: number;
    researchLatencyMs: number;
    writerLatencyMs: number;
    issueDate: string;
  };
};

const MODEL = "claude-sonnet-4-5-20250929";
const RESEARCH_TEMPERATURE = 0;
const RESEARCH_MAX_TOKENS = 5000;
const WRITER_TEMPERATURE = 0.45;
const WRITER_MAX_TOKENS = 5000;
const WEB_SEARCH_MAX_USES = 4;

const INPUT_COST_PER_M = 3;
const OUTPUT_COST_PER_M = 15;
const WEB_SEARCH_COST_PER_K = 10;

function estimateCostUsd(
  researchIn: number,
  researchOut: number,
  searches: number,
  writerIn: number,
  writerOut: number,
): number {
  const tokenCost =
    ((researchIn + writerIn) / 1_000_000) * INPUT_COST_PER_M +
    ((researchOut + writerOut) / 1_000_000) * OUTPUT_COST_PER_M;
  const searchCost = (searches / 1000) * WEB_SEARCH_COST_PER_K;
  return tokenCost + searchCost;
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

function extractJsonObject(text: string): string {
  const cleaned = stripCodeFences(text);
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    throw new Error(`no JSON object found in model output: ${cleaned.slice(0, 200)}`);
  }
  // Walk the string string-aware, tracking brace depth, to find the matching
  // close brace for the first open brace. Robust against trailing commentary
  // the writer occasionally appends after the JSON block.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return cleaned.slice(firstBrace, i + 1);
    }
  }
  throw new Error(`unbalanced JSON object in model output: ${cleaned.slice(0, 200)}`);
}

function requireString(obj: Record<string, unknown>, key: string, context: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`${context}: missing string field "${key}"`);
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
    throw new Error(`${context}: missing object field "${key}"`);
  }
  return v as Record<string, unknown>;
}

function requireArray(obj: Record<string, unknown>, key: string, context: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    throw new Error(`${context}: missing array field "${key}"`);
  }
  return v;
}

// ─── Research phase ─────────────────────────────────────────────────────────

function parseResearch(rawText: string): ResearchBundle {
  const json = extractJsonObject(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `research: failed to parse JSON: ${err instanceof Error ? err.message : String(err)}\nfirst 200 chars: ${json.slice(0, 200)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("research: model output is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  const rawItems = requireArray(obj, "items", "research");
  if (rawItems.length === 0) {
    throw new Error("research: items array is empty");
  }
  const items: ResearchItem[] = rawItems.map((r, i) => {
    if (!r || typeof r !== "object") throw new Error(`research.items[${i}] not an object`);
    const row = r as Record<string, unknown>;
    const ctx = `research.items[${i}]`;
    const item: ResearchItem = {
      category: requireString(row, "category", ctx),
      title: requireString(row, "title", ctx),
      url: requireString(row, "url", ctx),
      source: requireString(row, "source", ctx),
      summary: requireString(row, "summary", ctx),
    };
    if (typeof row.publishedDate === "string" && row.publishedDate.trim() !== "") {
      item.publishedDate = row.publishedDate.trim();
    }
    if (typeof row.notableQuote === "string" && row.notableQuote.trim() !== "") {
      item.notableQuote = row.notableQuote.trim();
    }
    if (Array.isArray(row.keyStats)) {
      item.keyStats = row.keyStats
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
        .map((s, j) => ({
          number: requireString(s, "number", `${ctx}.keyStats[${j}]`),
          label: requireString(s, "label", `${ctx}.keyStats[${j}]`),
        }));
    }
    return item;
  });
  return {
    researchedOn:
      typeof obj.researchedOn === "string"
        ? obj.researchedOn
        : new Date().toISOString().slice(0, 10),
    items,
  };
}

type ResearchResult = {
  bundle: ResearchBundle;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  latencyMs: number;
};

async function runResearchPhase(
  client: Anthropic,
  issueDate: string,
  recentTopics: string[],
  topicHint?: string,
): Promise<ResearchResult> {
  const userPromptParts: string[] = [];
  userPromptParts.push(`Today is ${issueDate}.`);
  if (topicHint) {
    userPromptParts.push(
      `\nTopic focus for this issue: ${topicHint}. Bias your searches toward this area; pick research items that support this focus.`,
    );
  }
  if (recentTopics.length > 0) {
    userPromptParts.push(
      `\nRecently covered headlines (find DIFFERENT angles — don't search for these same topics):\n${recentTopics.map((t) => `- ${t}`).join("\n")}`,
    );
  }
  userPromptParts.push(
    `\nUse the web_search tool to find fresh, real, recent (last 30-60 days) news and data relevant to independent financial advisors. Return the structured JSON specified in the system prompt.`,
  );

  const start = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: RESEARCH_MAX_TOKENS,
    temperature: RESEARCH_TEMPERATURE,
    system: RESEARCH_SYSTEM_PROMPT,
    tools: [
      {
        type: "web_search_20260209",
        name: "web_search",
        max_uses: WEB_SEARCH_MAX_USES,
        // Force direct calls. Default behavior allows the model to wrap
        // web_search inside code_execution, which double-counts against
        // the tool quota (1 code_execution + 1 web_search per search).
        // Direct calls are cheaper and avoid the "Server tool use limit
        // exceeded" failure mode that bricked tonight's tests.
        allowed_callers: ["direct"],
      },
    ],
    messages: [{ role: "user", content: userPromptParts.join("\n") }],
  });
  const latencyMs = Date.now() - start;

  let webSearches = 0;
  let textOutput = "";
  for (const block of response.content) {
    if (block.type === "server_tool_use" && block.name === "web_search") {
      webSearches++;
    } else if (block.type === "text") {
      textOutput += block.text;
    }
  }

  if (!textOutput) {
    throw new Error("research: no text block in response");
  }

  const bundle = parseResearch(textOutput);

  return {
    bundle,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    webSearches,
    latencyMs,
  };
}

// ─── Writer phase ───────────────────────────────────────────────────────────

const VALID_CONTENT_TYPES: DailyGrindContentType[] = ["tactic", "take", "story", "rant", "special"];

function parseContentType(raw: string): DailyGrindContentType {
  const lower = raw.toLowerCase().trim();
  if ((VALID_CONTENT_TYPES as string[]).includes(lower)) {
    return lower as DailyGrindContentType;
  }
  return "tactic";
}

function validateAgainstResearch(items: WorthKnowingItem[], research: ResearchBundle): void {
  const researchUrls = new Set(research.items.map((r) => r.url));
  for (const [i, item] of items.entries()) {
    if (!researchUrls.has(item.sourceUrl)) {
      throw new Error(
        `writer: worthKnowing[${i}] sourceUrl "${item.sourceUrl}" does not match any research item url. Model may have invented a source.`,
      );
    }
  }
  // Worth Knowing must cite 3 DISTINCT stories, not 3 angles of one story.
  // If the writer reuses the same sourceUrl, every "Worth Knowing" item is
  // really the same news — readers see three copies of the same source link
  // and the section loses its point. Reject duplicates so the writer is
  // forced to draw from 3 different research items.
  const urlCounts = new Map<string, number>();
  for (const item of items) {
    urlCounts.set(item.sourceUrl, (urlCounts.get(item.sourceUrl) ?? 0) + 1);
  }
  const dupes = [...urlCounts.entries()].filter(([, n]) => n > 1).map(([u]) => u);
  if (dupes.length > 0) {
    throw new Error(
      `writer: worthKnowing items must cite distinct stories. Duplicate sourceUrl(s): ${dupes.join(", ")}`,
    );
  }
}

function stripMyTakePrefix(raw: string): string {
  return raw.replace(/^\s*my\s*take\s*[:\-–—]+\s*/i, "").trim();
}

/**
 * Voice safety post-processor. The voice modules explicitly ban em dashes,
 * en dashes, and figure dashes, but the model occasionally emits one anyway.
 * Replace with proper punctuation rather than fail the issue.
 *
 * Heuristic: dash-with-spaces → comma+space. Dash-without-spaces inside a
 * word → no space (handles "long—term" → "long, term" awkwardness by using
 * a comma which is at least valid English).
 */
function stripBannedDashes(raw: string): string {
  // Catch ANY em/en/figure dash regardless of context. Normalize to ", "
  // and clean up resulting double-spaces or double-commas.
  return raw
    .replace(/\s*[—–‒]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/,([A-Za-z])/g, ", $1");
}

function deepStripDashes<T>(input: T): T {
  if (typeof input === "string") return stripBannedDashes(input) as unknown as T;
  if (Array.isArray(input)) return input.map((x) => deepStripDashes(x)) as unknown as T;
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) out[k] = deepStripDashes(v);
    return out as unknown as T;
  }
  return input;
}

function parseWorthKnowing(raw: unknown[]): WorthKnowingItem[] {
  if (raw.length < 1) throw new Error("writer: worthKnowing must have at least one item");
  return raw.map((r, i) => {
    if (!r || typeof r !== "object") throw new Error(`writer: worthKnowing[${i}] not an object`);
    const obj = r as Record<string, unknown>;
    const ctx = `worthKnowing[${i}]`;
    const item: WorthKnowingItem = {
      category: requireString(obj, "category", ctx),
      headline: requireString(obj, "headline", ctx),
      sourceUrl: requireString(obj, "sourceUrl", ctx),
      body: requireString(obj, "body", ctx),
      myTake: stripMyTakePrefix(requireString(obj, "myTake", ctx)),
    };
    if (typeof obj.stat === "string" && obj.stat.trim() !== "") item.stat = obj.stat.trim();
    if (typeof obj.statLabel === "string" && obj.statLabel.trim() !== "")
      item.statLabel = obj.statLabel.trim();
    if (
      typeof obj.statColor === "string" &&
      ["green", "red", "gold"].includes(obj.statColor)
    ) {
      item.statColor = obj.statColor as "green" | "red" | "gold";
    }
    if (typeof obj.sourceName === "string" && obj.sourceName.trim() !== "")
      item.sourceName = obj.sourceName.trim();
    if (typeof obj.publishedDate === "string" && obj.publishedDate.trim() !== "")
      item.publishedDate = obj.publishedDate.trim();
    return item;
  });
}

function parseHowToSteps(raw: unknown[]): HowToStep[] {
  if (raw.length < 2) throw new Error("writer: howTo.steps must have at least 2 steps");
  return raw.map((r, i) => {
    if (!r || typeof r !== "object") throw new Error(`writer: howTo.steps[${i}] not an object`);
    const obj = r as Record<string, unknown>;
    return {
      label: requireString(obj, "label", `howTo.steps[${i}]`),
      body: requireString(obj, "body", `howTo.steps[${i}]`),
    };
  });
}

function parseContent(rawText: string): DailyGrindContent {
  const json = extractJsonObject(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `writer: failed to parse JSON: ${err instanceof Error ? err.message : String(err)}\nfirst 200 chars: ${json.slice(0, 200)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") throw new Error("writer: model output not an object");
  const obj = parsed as Record<string, unknown>;
  const trifecta = requireObject(obj, "openingTrifecta", "root");
  const theNumber = requireObject(trifecta, "theNumber", "openingTrifecta");
  const theFlip = requireObject(trifecta, "theFlip", "openingTrifecta");
  const firstPull = requireObject(obj, "firstPull", "root");
  const firstPullParas = requireArray(firstPull, "paragraphs", "firstPull");
  const mainContent = requireObject(obj, "mainContent", "root");
  const howTo = requireObject(mainContent, "howTo", "mainContent");
  const howToSteps = requireArray(howTo, "steps", "mainContent.howTo");
  const ancient = requireObject(obj, "ancientTruth", "root");
  return {
    headline: requireString(obj, "headline", "root"),
    preheader: requireString(obj, "preheader", "root"),
    contentType: parseContentType(requireString(obj, "contentType", "root")),
    openingTrifecta: {
      theNumber: {
        stat: requireString(theNumber, "stat", "openingTrifecta.theNumber"),
        description: requireString(theNumber, "description", "openingTrifecta.theNumber"),
      },
      theUnspoken: requireString(trifecta, "theUnspoken", "openingTrifecta"),
      theFlip: {
        conventional: requireString(theFlip, "conventional", "openingTrifecta.theFlip"),
        reality: requireString(theFlip, "reality", "openingTrifecta.theFlip"),
      },
    },
    firstPull: {
      paragraphs: firstPullParas.map((p, i) => {
        if (typeof p !== "string" || p.trim() === "") {
          throw new Error(`firstPull.paragraphs[${i}] not a non-empty string`);
        }
        return p.trim();
      }),
    },
    worthKnowing: parseWorthKnowing(requireArray(obj, "worthKnowing", "root")),
    mainContent: {
      subhead: requireString(mainContent, "subhead", "mainContent"),
      intro: requireString(mainContent, "intro", "mainContent"),
      howTo: {
        title: requireString(howTo, "title", "mainContent.howTo"),
        steps: parseHowToSteps(howToSteps),
      },
      closing: requireString(mainContent, "closing", "mainContent"),
    },
    groundsForThought: requireString(obj, "groundsForThought", "root"),
    ancientTruth: {
      verse: requireString(ancient, "verse", "ancientTruth"),
      reference: requireString(ancient, "reference", "ancientTruth"),
      application: requireString(ancient, "application", "ancientTruth"),
    },
    ps: requireString(obj, "ps", "root"),
  };
}

function normalizeVerseRef(raw: string): string {
  // Normalize "Proverbs 21:5 (ESV)" → "proverbs 21:5"
  return raw
    .toLowerCase()
    .replace(/\([a-z]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Permanent ban list — verses that read as dramatic/preachy in a tactical
// advisor newsletter. Mixed-faith audience means the proverbs work as
// wisdom literature but eternal-stakes NT verses are out of place.
const PERMANENT_BAN_VERSES = [
  "Matthew 7:21",
  "Matthew 7:7",
  "John 14:6",
  "John 3:16",
  "Romans 8:28",
  "Romans 10:9",
  "Philippians 4:13",
  "Jeremiah 29:11",
  "Proverbs 3:5-6",
  "Proverbs 3:5",
  "Proverbs 3:6",
  // AI defaults (already covered in prompt but enforced here too)
  "Proverbs 21:5",
  "Proverbs 24:27",
  "Proverbs 16:9",
  "Proverbs 16:3",
];

function verseConflictsWithRecent(picked: string, recent: string[]): boolean {
  const norm = normalizeVerseRef(picked);
  if (recent.some((r) => normalizeVerseRef(r) === norm)) return true;
  if (PERMANENT_BAN_VERSES.some((r) => normalizeVerseRef(r) === norm)) return true;
  return false;
}

function buildWriterUserPrompt(
  issueDate: string,
  research: ResearchBundle,
  recentTopics: string[],
  recentVerses: string[],
  bannedVerses: string[],
  recentConcepts: string[] = [],
): string {
  const parts: string[] = [];
  parts.push(`Today is ${issueDate}. Write today's Daily Grind issue using the research below.`);
  parts.push("\n# RESEARCH (use ONLY these items for Worth Knowing and any cited statistics):");
  parts.push(JSON.stringify(research, null, 2));
  if (recentTopics.length > 0) {
    parts.push(
      `\n# RECENT HEADLINES — STRUCTURAL ANTI-PATTERN MEMORY

The following are the actual H1 headlines from the most recent Daily Grind issues. Today's headline MUST be structurally different from every one of these — not just topically different, structurally different.

Look at the headlines below. If they share a grammatical pattern (e.g. starting with "The", ending in "-ing", a "Nobody's X" construction, a noun-noun-noun pile), do NOT match that pattern. Pick a DIFFERENT structural template from the system prompt's strong headline patterns.

Recent headlines:
${recentTopics.map((t) => `- ${t}`).join("\n")}

Before you finalize today's headline:
1. Read your draft headline aloud.
2. Compare its STRUCTURE (not topic) against the list above.
3. If it matches any structural pattern present in the list, REWRITE using a different template.
4. Specifically: if your headline uses "Nobody's X" or any banned pattern from the system prompt, REWRITE.`,
    );
  }
  if (recentConcepts.length > 0) {
    parts.push(
      `\n# CONCEPTS ALREADY COVERED IN RECENT ISSUES (do not rehash these — even if framed differently):\n${recentConcepts.map((c) => `- ${c}`).join("\n")}\n\nIf today's research overlaps with a concept above, pick a DIFFERENT angle on the topic or pick different research items. The reader has seen these ideas already.`,
    );
  }
  const allBanned = [...new Set([...recentVerses, ...bannedVerses])];
  if (allBanned.length > 0) {
    parts.push(
      `\n# BANNED ANCIENT TRUTH VERSES — HARD RULE
If you pick any verse from the following list, the response will be REJECTED and you will be asked to regenerate. Pick a completely different verse, ideally from a different book (Ecclesiastes, Psalms, James) or a less-cited Proverbs chapter (e.g., Proverbs 3, 11, 14, 18, 27, 29).

Banned verses for this issue:
${allBanned.map((v) => `- ${v}`).join("\n")}

Default avoidance regardless of list (these are the most-overused AI defaults):
- Proverbs 21:5 ("plans of the diligent...")
- Proverbs 24:27 ("prepare your work outside...")
- Proverbs 16:9 ("the heart of man plans his way...")
- Proverbs 16:3 ("commit your work to the LORD...")

If your topic naturally fits one of those defaults, find a fresher verse that touches the same theme from a different angle.`,
    );
  }
  parts.push(
    `\n# OUTPUT NOTES:
- For each Worth Knowing "myTake" field, write ONLY the take. Do NOT include the literal text "My take:" in the field value — the rendering layer adds that label automatically.
- Confirm before returning: every Worth Knowing sourceUrl matches a research item URL exactly, and the ancientTruth.reference is NOT in the banned list above.

# ANCIENT TRUTH VERSE SELECTION (this is the single most important variety lever)
Before you write ancientTruth, name the theme of THIS issue in one phrase (mental note — don't put it in the output). Examples: "fee compression and unbundling AUM", "IRMAA timing risk on Roth conversions", "Reg S-P compliance deadline", "formal referral systems".

Then pick a verse from the THEMATIC FAMILY that matches (see the system prompt's table). Do not pick a generic "planning" verse if the issue is about compliance — pick a watchfulness verse. Do not pick a "diligence" verse if the issue is about M&A wealth — pick a stewardship or hasty-riches verse.

Rotate the source book across issues. If recent issues used Proverbs, lean toward Ecclesiastes, James, or Luke today. If the topic is wealth or fees, Ecclesiastes 5 or Luke 12 are often stronger than the obvious Proverbs pick.

Vary the emotional register: cautionary verses for compliance/risk, opportunity verses for new strategies, rebuke verses for rants, patience verses for growth pieces.`,
  );
  parts.push(
    `\nReturn ONLY the JSON object specified in the system prompt. No preamble, no markdown fences.`,
  );
  return parts.join("\n");
}

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const VERSE_SWAP_MAX_TOKENS = 800;
const HEADLINE_REWRITE_MAX_TOKENS = 300;

// Patterns the writer keeps mode-collapsing onto. If a generated headline
// matches any of these, we rewrite via Haiku rather than ship a weak hook.
const HEADLINE_BAN_PATTERNS: Array<{ name: string; rx: RegExp }> = [
  { name: "Nobody's X", rx: /\bnobody'?s\b/i },
  { name: "Nobody Is/Asked/Tells", rx: /\bnobody\s+(is|are|asked|tells?|knows?|wants?)\b/i },
  { name: "What Nobody Tells You", rx: /^what\s+nobody\b/i },
  { name: "The Truth About X", rx: /^the\s+truth\s+about\b/i },
  { name: "Why X Matters", rx: /\bwhy\s+.+\s+matters?\b/i },
  { name: "Rethinking / Understanding", rx: /^(rethinking|understanding|reimagining)\b/i },
  { name: "N Ways / N Things / N Tips listicle", rx: /^\d+\s+(ways?|things?|tips?|reasons?|secrets?|steps?)\b/i },
  { name: "You're Not / You Aren't", rx: /\byou(\s|')?re\s+not\b/i },
];

function headlineBanMatch(headline: string): { name: string; rx: RegExp } | null {
  for (const p of HEADLINE_BAN_PATTERNS) {
    if (p.rx.test(headline)) return p;
  }
  return null;
}

const HEADLINE_REWRITE_SYSTEM_PROMPT = `You rewrite the H1 headline for The Daily Grind, a newsletter for independent financial advisors written in Mark's voice — sharp, contrarian, specific.

The headline must:
- Be 5-12 words, title case.
- Take a position or name a specific thing. Not neutral, not descriptive.
- NOT use any of these banned patterns: "Nobody's X", "What Nobody Tells You", "The Truth About X", "Why X Matters", "Rethinking/Understanding X", "N Ways/Things/Tips" listicles, "You're Not X".
- Use ONE of these structural templates (pick whichever fits the issue):
  • The contrarian stat: "63% of Discovery Calls End in the First 4 Minutes"
  • The named gap: "What Advisors Promise vs. What Compliance Logs Show"
  • The reframe directive: "Stop Sending NDAs. Send a Calendar Hold."
  • The observation w/ count: "Three CRM Fields Predict 80% of Closes"
  • The challenge: "Your Pipeline Has 47 Names. Eight Will Move."
  • The setup-and-twist: "Conventional Wisdom Says Niche Down. The Math Says Scale Up First."
  • The number specific: "The 15-Minute Window That Decides Every Review"
  • The blunt verdict: "Form CRS Is Useless. Here's What Replaces It."

Return ONLY this JSON, no preamble:
{ "headline": "the rewritten H1" }`;

async function rewriteBannedHeadline(
  client: Anthropic,
  issueDate: string,
  bannedHeadline: string,
  matchedPattern: string,
  recentHeadlines: string[],
  contextSummary: string,
): Promise<{ headline: string; inputTokens: number; outputTokens: number; latencyMs: number }> {
  const userPrompt = `Issue date: ${issueDate}
Issue context (from first paragraph): ${contextSummary}

The writer produced this headline, which matches a BANNED pattern:
"${bannedHeadline}"  ← matches "${matchedPattern}"

Rewrite it. The new headline must NOT match any banned pattern AND must be structurally different from these recent headlines:
${recentHeadlines.slice(0, 15).map((h) => `- ${h}`).join("\n") || "(none)"}

Return JSON only.`;
  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: HEADLINE_REWRITE_MAX_TOKENS,
    temperature: 0.8,
    system: HEADLINE_REWRITE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("headline_rewrite: response missing text block");
  }
  const json = extractJsonObject(block.text);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  return {
    headline: requireString(parsed, "headline", "headline_rewrite"),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
  };
}

const VERSE_SWAP_SYSTEM_PROMPT = `You pick a Bible verse for The Daily Grind, a newsletter for independent financial advisors. The host is Mark at Castor Abbott. The verse must fit the issue's theme and the application must be 2-3 sentences applying the verse to advisor practice — concrete, not preachy.

Avoid these AI-default verses: Proverbs 21:5, Proverbs 24:27, Proverbs 16:9, Proverbs 16:3, Proverbs 15:22, Proverbs 22:3.

Prefer less-cited Proverbs (3, 11, 14, 18, 20, 25, 27, 29) or Ecclesiastes, Psalms, James, or Luke when the theme allows.

Return ONLY this JSON, no preamble:
{
  "verse": "the verse text in quotes",
  "reference": "Book Chapter:Verse (Translation)",
  "application": "2-3 sentences applying the verse to advisor practice"
}`;

async function swapBannedVerse(
  client: Anthropic,
  issueDate: string,
  headline: string,
  topicSummary: string,
  banned: string[],
  temperature = 0.6,
  forceNonProverbs = false,
): Promise<{
  verse: string;
  reference: string;
  application: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const bookConstraint = forceNonProverbs
    ? `\n\nMANDATORY: Do NOT pick a verse from Proverbs. Use Ecclesiastes, Psalms, James, Luke, Matthew, Mark, John, Acts, 1 Corinthians, Philippians, or Colossians. Proverbs is exhausted for this issue.`
    : "";

  const userPrompt = `Issue date: ${issueDate}
Issue headline: ${headline}
Issue theme (1-line): ${topicSummary}

BANNED VERSES — DO NOT use any of these (or any verse that's the most-common AI default like Proverbs 21:5):
${banned.map((b) => `- ${b}`).join("\n")}

Pick a different verse that fits the theme.${bookConstraint}`;

  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: VERSE_SWAP_MAX_TOKENS,
    temperature,
    system: VERSE_SWAP_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== "text") {
    throw new Error("verse_swap: response missing text block");
  }
  const json = extractJsonObject(firstBlock.text);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  return {
    verse: requireString(parsed, "verse", "verse_swap"),
    reference: requireString(parsed, "reference", "verse_swap"),
    application: requireString(parsed, "application", "verse_swap"),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
  };
}

async function runWriterPhase(
  client: Anthropic,
  issueDate: string,
  research: ResearchBundle,
  recentTopics: string[],
  recentVerses: string[],
  recentConcepts: string[],
): Promise<{
  content: DailyGrindContent;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const userPrompt = buildWriterUserPrompt(
    issueDate,
    research,
    recentTopics,
    recentVerses,
    [],
    recentConcepts,
  );

  const start = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: WRITER_MAX_TOKENS,
    temperature: WRITER_TEMPERATURE,
    // Cache the large voice modules block. 5-min TTL — cache hits save
    // 90% on input tokens for any closely-timed retries or batch runs.
    system: [
      {
        type: "text",
        text: DAILY_GRIND_VOICE_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });
  let totalLatency = Date.now() - start;
  let totalInput = response.usage.input_tokens;
  let totalOutput = response.usage.output_tokens;

  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== "text") {
    throw new Error("writer: response missing text block");
  }
  let content = parseContent(firstBlock.text);
  // Strip banned dashes globally before any further processing.
  // Voice modules forbid em/en/figure dashes — the model still emits them
  // occasionally despite the rules. This belt-and-suspenders pass replaces
  // them with proper punctuation so the rendered email is always clean.
  content = deepStripDashes(content);
  validateAgainstResearch(content.worthKnowing, research);

  // Headline pattern check: if the writer produced a headline matching one of
  // the banned formulas (e.g. "Nobody's X"), rewrite it via Haiku rather than
  // ship a weak/repetitive hook. Up to 3 attempts before we accept whatever
  // we have to avoid a generation failure on a recoverable issue.
  const headlineBan = headlineBanMatch(content.headline);
  if (headlineBan) {
    const contextSummary = content.firstPull.paragraphs[0] ?? content.headline;
    let rewritten: string | null = null;
    let bannedPattern = headlineBan;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await rewriteBannedHeadline(
        client,
        issueDate,
        content.headline,
        bannedPattern.name,
        recentTopics,
        contextSummary,
      );
      totalInput += result.inputTokens;
      totalOutput += result.outputTokens;
      totalLatency += result.latencyMs;
      const newMatch = headlineBanMatch(result.headline);
      if (!newMatch) {
        rewritten = result.headline;
        break;
      }
      bannedPattern = newMatch;
    }
    if (rewritten) {
      content = deepStripDashes({ ...content, headline: rewritten });
    }
    // If all 3 rewrites still matched a banned pattern, ship the original
    // rather than fail the issue — at least the rest of the content is good.
  }

  if (
    recentVerses.length > 0 &&
    verseConflictsWithRecent(content.ancientTruth.reference, recentVerses)
  ) {
    const banned = [...recentVerses, content.ancientTruth.reference];
    // Escalate temperature on each retry to shake Haiku out of mode-collapse
    // when the ban list is large. From attempt 3 onward, also force a
    // non-Proverbs book — Haiku tends to mode-collapse on the same Proverbs
    // verse repeatedly when bumping temperature alone doesn't help.
    const temps = [0.6, 0.8, 0.9, 1.0, 1.0];
    let swap: Awaited<ReturnType<typeof swapBannedVerse>> | null = null;
    for (let attempt = 0; attempt < temps.length; attempt++) {
      const result = await swapBannedVerse(
        client,
        issueDate,
        content.headline,
        content.firstPull.paragraphs[0] ?? content.headline,
        banned,
        temps[attempt],
        attempt >= 2, // forceNonProverbs from attempt 3 onward
      );
      totalInput += result.inputTokens;
      totalOutput += result.outputTokens;
      totalLatency += result.latencyMs;
      if (!verseConflictsWithRecent(result.reference, banned)) {
        swap = result;
        break;
      }
      banned.push(result.reference);
    }

    // If all 5 retries still picked a banned verse, ship the writer's original
    // pick rather than fail the entire issue. A repeated verse in one issue out
    // of 125 is far less bad than no issue going out at all. Log so we can
    // monitor frequency — if this fires often, we tighten the swap prompt
    // further or curate a known-safe verse pool.
    if (!swap) {
      console.warn(
        `[daily-grind] verse swap exhausted after ${temps.length} attempts — shipping original verse "${content.ancientTruth.reference}". Banned candidates: ${banned.join(", ")}`,
      );
    } else {
      content.ancientTruth = deepStripDashes({
        verse: swap.verse,
        reference: swap.reference,
        application: swap.application,
      });
    }
  }

  return { content, inputTokens: totalInput, outputTokens: totalOutput, latencyMs: totalLatency };
}

// ─── Public ─────────────────────────────────────────────────────────────────

export async function generateDailyGrindIssue(opts: {
  issueDate: string;
  recentTopics?: string[];
  recentVerses?: string[];
  recentConcepts?: string[];
  topicHint?: string;
  apiKey?: string;
}): Promise<DailyGrindIssue> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey });
  const recentTopics = opts.recentTopics ?? [];
  const recentVerses = opts.recentVerses ?? [];
  const recentConcepts = opts.recentConcepts ?? [];

  // Research phase: prefer Perplexity (mature, structured citations, cheap),
  // fall back to Anthropic web_search if PERPLEXITY_API_KEY not configured.
  let research;
  if (process.env.PERPLEXITY_API_KEY) {
    const perpOpts: Parameters<typeof runPerplexityResearch>[0] = {
      issueDate: opts.issueDate,
      recentTopics,
      recentConcepts,
    };
    if (opts.topicHint) perpOpts.topicHint = opts.topicHint;
    // Retry up to 3 times. Failures mostly come from "items survived URL
    // citation validation: 0" — Perplexity occasionally returns items
    // whose URLs don't match its own citations list, and after normalization
    // we drop them. Retry usually fixes this.
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const perp = await runPerplexityResearch(perpOpts);
        research = {
          bundle: perp.bundle,
          inputTokens: perp.inputTokens,
          outputTokens: perp.outputTokens,
          webSearches: perp.webSearches,
          latencyMs: perp.latencyMs,
        };
        break;
      } catch (err) {
        lastErr = err;
        if (attempt === 3) {
          throw err instanceof Error ? err : new Error(String(err));
        }
        await new Promise((r) => setTimeout(r, attempt * 4000));
      }
    }
    if (!research) {
      throw lastErr instanceof Error ? lastErr : new Error("research: no result after retries");
    }
  } else {
    // Legacy fallback: Anthropic web_search. Kept so the system still works
    // if PERPLEXITY_API_KEY is missing from Vercel.
    const transientHints = [
      "no JSON object",
      "web_search",
      "invalid webhook json",
      "technical limitation",
      "items array is empty",
      "items must be at least",
    ];
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        research = await runResearchPhase(client, opts.issueDate, recentTopics, opts.topicHint);
        break;
      } catch (err) {
        lastErr = err;
        const message = err instanceof Error ? err.message : String(err);
        const transient = transientHints.some((h) => message.includes(h));
        if (!transient || attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 6000));
      }
    }
    if (!research) {
      throw lastErr instanceof Error ? lastErr : new Error("research: no result after retries");
    }
  }
  // Visibility: log research bundle stats so we can diagnose writer
  // mode-collapse failures. If the bundle has <5 items or <3 distinct
  // sources/urls, the writer is forced to reuse items in Worth Knowing.
  {
    const distinctSources = new Set(research.bundle.items.map((r) => r.source));
    const distinctUrls = new Set(research.bundle.items.map((r) => r.url));
    console.log(
      `[daily-grind][research] items=${research.bundle.items.length} distinctSources=${distinctSources.size} distinctUrls=${distinctUrls.size} sources=[${Array.from(distinctSources).join(", ")}]`,
    );
  }
  const writer = await runWriterPhase(
    client,
    opts.issueDate,
    research.bundle,
    recentTopics,
    recentVerses,
    recentConcepts,
  );

  const totalCost = estimateCostUsd(
    research.inputTokens,
    research.outputTokens,
    research.webSearches,
    writer.inputTokens,
    writer.outputTokens,
  );

  return {
    content: writer.content,
    research: research.bundle,
    meta: {
      model: MODEL,
      researchInputTokens: research.inputTokens,
      researchOutputTokens: research.outputTokens,
      researchWebSearches: research.webSearches,
      writerInputTokens: writer.inputTokens,
      writerOutputTokens: writer.outputTokens,
      totalCostUsd: totalCost,
      researchLatencyMs: research.latencyMs,
      writerLatencyMs: writer.latencyMs,
      issueDate: opts.issueDate,
    },
  };
}
