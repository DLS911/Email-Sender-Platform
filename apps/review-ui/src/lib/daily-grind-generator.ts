import Anthropic from "@anthropic-ai/sdk";
import {
  CANONICAL_EXAMPLES,
  getDailyGrindVoiceSystemPrompt,
} from "./daily-grind-voice-prompt";
import { RESEARCH_SYSTEM_PROMPT } from "./daily-grind-research-prompt";
import { runPerplexityResearch } from "./daily-grind-research-perplexity";
import { runGeminiResearch } from "./daily-grind-research-gemini";
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

export type ResearchFunnel = {
  rawItemCount: number;
  citationCount: number;
  rawCitationCount?: number;
  rawCitationDomains?: string[];
  droppedMissingFields: number;
  droppedBareDomain: number;
  droppedDeadUrl: number;
  survived: number;
};

export type PipelineStageRecord = {
  name: string;
  status: "success" | "skipped" | "failed" | "retried" | "warning";
  latencyMs?: number;
  notes?: string;
  data?: Record<string, unknown>;
};

export type DailyGrindIssue = {
  content: DailyGrindContent;
  research: ResearchBundle;
  pipeline: PipelineStageRecord[];
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
    researchFunnel?: ResearchFunnel;
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
  recentConcepts: string[],
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
  if (recentConcepts.length > 0) {
    userPromptParts.push(
      `\nConcepts the newsletter has already discussed in recent issues (don't return items that just rehash these):\n${recentConcepts.map((c) => `- ${c}`).join("\n")}`,
    );
  }
  userPromptParts.push(
    `\nUse the web_search tool to run these specific queries against the advisor industry press. Do NOT search general consumer news. Run multiple queries and gather citations from each:

1. site:thinkadvisor.com OR site:wealthmanagement.com OR site:investmentnews.com — most recent RIA M&A activity
2. site:sec.gov OR site:finra.org — recent enforcement actions against registered investment advisers or broker-dealers
3. site:kitces.com OR site:michaelkitces.com — recent practice management or planning research
4. site:advisorperspectives.com OR site:fa-mag.com OR site:financial-planning.com — fee compression, practice benchmarking, growth studies
5. site:planadviser.com — retirement plan / fiduciary updates
6. site:rethinking65.com OR site:advisorhub.com — recent industry trends, breakaway broker movement
7. site:riaintel.com — RIA aggregator activity, custodian platform news
8. recent Cerulli OR Morningstar advisor industry study (any of: site:morningstar.com, site:cerulli.com)

Each search should hit a different angle. Aim for 8-12 distinct cited articles total from the advisor industry press, NOT from general news outlets like CBS, ABC, NBC, Reuters, AP, or random blogs. Quality bar: every cited URL must be a deep article page (with slug), never a homepage or section page.

Return the structured JSON specified in the system prompt. No preamble.`,
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
}

function findDuplicateSourceUrls(items: WorthKnowingItem[]): string[] {
  const urlCounts = new Map<string, number>();
  for (const item of items) {
    urlCounts.set(item.sourceUrl, (urlCounts.get(item.sourceUrl) ?? 0) + 1);
  }
  return [...urlCounts.entries()].filter(([, n]) => n > 1).map(([u]) => u);
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

/**
 * Repair common LLM JSON output errors before parsing. The writer
 * occasionally emits malformed JSON (missing comma between array elements,
 * trailing comma, smart quotes). These are ALL recoverable — we don't need
 * to regenerate the whole issue just because of a comma.
 *
 * Repairs applied in order:
 * 1. Smart quotes → straight quotes inside string boundaries
 * 2. Missing comma between adjacent }, { array elements
 * 3. Missing comma between adjacent ", " object keys on new lines
 * 4. Trailing commas before } or ]
 */
function repairJson(raw: string): string {
  let s = raw;
  // Smart quotes → straight quotes (only catches them outside content,
  // but content-internal smart quotes shouldn't break JSON anyway since
  // we'd escape only the boundary " marks)
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  // Missing comma between array elements: `}\n  {` or `}\n{` etc.
  s = s.replace(/\}(\s*\n\s*)\{/g, "},$1{");
  // Missing comma between adjacent quoted strings on separate lines (object keys)
  s = s.replace(/"(\s*\n\s*)"/g, '",$1"');
  // Trailing commas before } or ]
  s = s.replace(/,(\s*[\]\}])/g, "$1");
  return s;
}

function parseContent(rawText: string): DailyGrindContent {
  const json = extractJsonObject(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (firstErr) {
    // Try to repair common LLM JSON output errors, then parse again. This
    // recovers writers that produced almost-valid JSON (missing comma,
    // trailing comma, smart quotes) rather than failing the whole issue.
    try {
      parsed = JSON.parse(repairJson(json));
    } catch (secondErr) {
      throw new Error(
        `writer: failed to parse JSON (even after repair): ${secondErr instanceof Error ? secondErr.message : String(secondErr)}\noriginal err: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}\nfirst 200 chars: ${json.slice(0, 200)}`,
      );
    }
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
  contentType: DailyGrindContentType,
  _recentTopics: string[],
  _recentVerses: string[],
  _bannedVerses: string[],
  _recentConcepts: string[] = [],
): string {
  // Heavy per-issue activation. Voice modules teach Mark's voice broadly in
  // the system prompt; this user prompt PRIMES specific sections with the
  // canonical archive examples so the writer has concrete patterns to imitate
  // instead of defaulting to competent-but-generic financial-analyst prose.
  const sections: string[] = [];

  sections.push(
    `Today is ${issueDate}. Write today's Daily Grind in Mark's voice.\n\nContent type for this issue: ${contentType.toUpperCase()}. Use the ${contentType} structure exactly — Main Content must follow the structure spec for ${contentType} in the system prompt, not any other content type.`,
  );

  sections.push(
    `# RESEARCH BUNDLE\n\nUse these for Worth Knowing and any cited statistics. Everything else (The Unspoken, The Flip, Main Content commentary, Grounds for Thought, Ancient Truth) draws on Mark's pattern recognition — no citations needed there.\n\n${JSON.stringify(research, null, 2)}`,
  );

  // The Unspoken — show the writer EXACTLY what production-shipped looks like
  sections.push(
    `# THE UNSPOKEN — write at this caliber\n\nThese are real published Castor Abbott Unspokens. Notice:\n- Specific named counts (twelve CPAs, three CPAs, eighteen months)\n- A SCENE (lunch, charity event, phone call, dog)\n- Dollar-amount punchline tied to the failure ($187, $847)\n- Wry self-recognition (reader laughs and winces)\n\nExample 1 (theme: ${CANONICAL_EXAMPLES.unspoken[0]!.theme}):\n"${CANONICAL_EXAMPLES.unspoken[0]!.text}"\n\nExample 2 (theme: ${CANONICAL_EXAMPLES.unspoken[1]!.theme}):\n"${CANONICAL_EXAMPLES.unspoken[1]!.text}"\n\nProduce work at this level. The Unspoken is a SHORT STORY with a financial backdrop, not a financial analysis with personality bolted on.`,
  );

  // First Pull — show the opening pattern (narrative tension, not stat dump)
  sections.push(
    `# FIRST PULL — write at this caliber\n\nOpening paragraphs from real Castor Abbott First Pulls. Notice each opens with either (a) a 2-character contrast/narrative, or (b) naming conventional wisdom about to be flipped. Neither opens with a stat dump.\n\nExample 1 (${CANONICAL_EXAMPLES.firstPullOpener[0]!.theme}):\n"${CANONICAL_EXAMPLES.firstPullOpener[0]!.text}"\n\nExample 2 (${CANONICAL_EXAMPLES.firstPullOpener[1]!.theme}):\n"${CANONICAL_EXAMPLES.firstPullOpener[1]!.text}"\n\nYour First Pull should ARGUE or NARRATE, not summarize.`,
  );

  // The Flip Reality — 12-20 words, sharp reframe
  sections.push(
    `# THE FLIP REALITY — keep it 12-20 words\n\nReal Mark Flip Realities are compressed reframes, not analytical explanations:\n${CANONICAL_EXAMPLES.flipReality.map((f) => `- "${f}"`).join("\n")}\n\nIf yours runs over 25 words, you're explaining instead of reframing. Cut it.`,
  );

  // Worth Knowing my-take — judgment, not summary
  sections.push(
    `# WORTH KNOWING myTake — judgment, not summary\n\nReal Mark my-takes don't summarize the article. They REFRAME it as a position on what advisors are doing wrong or right:\n${CANONICAL_EXAMPLES.myTake.map((m) => `- "${m}"`).join("\n")}\n\nEach myTake should NAME a specific failure mode or contrarian read. 20-40 words.`,
  );

  // Grounds for Thought
  sections.push(
    `# GROUNDS FOR THOUGHT — one italic sentence, non-obvious\n\nExamples:\n${CANONICAL_EXAMPLES.groundsForThought.map((g) => `- "${g}"`).join("\n")}`,
  );

  // Ancient Truth application — concrete metaphor, not preachy
  sections.push(
    `# ANCIENT TRUTH application — concrete, NOT preachy\n\nExample 1:\nVerse: "${CANONICAL_EXAMPLES.ancientTruthApplication[0]!.verse}"\nApplication: "${CANONICAL_EXAMPLES.ancientTruthApplication[0]!.application}"\n\nExample 2:\nVerse: "${CANONICAL_EXAMPLES.ancientTruthApplication[1]!.verse}"\nApplication: "${CANONICAL_EXAMPLES.ancientTruthApplication[1]!.application}"\n\nNotice: a concrete metaphor (farmer / blindsided) + direct application to advisor practice. Two sentences. No "as believers..." preaching.`,
  );

  // Closing landings + P.S. format
  sections.push(
    `# CLOSING LANDINGS — Main Content closing must land somewhere NEW\n\nReal closes from the archive (notice: zero hedging, no softening, no apology, lands a position):\n${CANONICAL_EXAMPLES.closingLandings.map((c) => `- "${c}"`).join("\n")}\n\nThe Closing must NOT restate The Number. Land somewhere new — a directive, a fresh framing, a twist.`,
  );

  // The activation reminder — final check the writer runs through
  sections.push(
    `# BEFORE YOU RETURN — voice activation checklist\n\n1. The Unspoken has a physical scene + dollar punchline (not just stats)\n2. Each section adds a NEW angle — no single theme word appears across 3+ sections\n3. The Flip Reality is 12-20 words\n4. First Pull opens with narrative/argument, not a stat dump\n5. At least 3 sentences in the body run under 8 words for rhythm\n6. The Closing lands somewhere The Number didn't already cover\n7. Ancient Truth uses a concrete metaphor — not "as believers" or "trust in His plan"\n\nReturn the JSON object specified in the system prompt. No preamble, no fences.`,
  );

  return sections.join("\n\n");
}

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const VERSE_SWAP_MAX_TOKENS = 800;
const HEADLINE_REWRITE_MAX_TOKENS = 300;
const CONTENT_TYPE_PICKER_MAX_TOKENS = 200;
const VOICE_REVIEW_MAX_TOKENS = 500;

/**
 * Pick the best content-type for today's issue BEFORE the writer runs.
 * Lets us load only the relevant content-type voice module into the system
 * prompt instead of all 5 at once. ~$0.002 per call.
 */
async function pickContentType(
  client: Anthropic,
  research: ResearchBundle,
  recentTopics: string[],
): Promise<{ contentType: DailyGrindContentType; reason: string; inputTokens: number; outputTokens: number; latencyMs: number }> {
  const userPrompt = `Pick the best content type for today's Daily Grind issue, based on the research bundle.

Research items available:
${research.items.map((i) => `- ${i.category}: ${i.title} (${i.source})`).join("\n")}

Recently covered headlines (avoid same content type as the last 1-2):
${recentTopics.slice(0, 5).map((t) => `- ${t}`).join("\n") || "(none)"}

Content type options:
- tactic: specific implementable move ("how to do X right now"). Best when research has a concrete operational angle.
- take: contrarian position challenging conventional wisdom. Best when research lets you flip an accepted norm.
- story: narrative about a specific advisor scenario. Best when research suggests a character/situation arc.
- rant: heated piece naming bad industry behavior. Best when research exposes harm/exploitation.
- special: technical deep-dive (compliance, ops, tax, regulatory). Best when research is procedural / requires precision.

Return ONLY this JSON:
{ "contentType": "tactic" | "take" | "story" | "rant" | "special", "reason": "1 short sentence" }`;

  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: CONTENT_TYPE_PICKER_MAX_TOKENS,
    temperature: 0.3,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("content_type_picker: missing text block");
  }
  let parsed: Record<string, unknown> | undefined;
  try {
    const json = extractJsonObject(block.text);
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    // Default to "take" if parsing fails — most flexible content type
  }
  const raw = typeof parsed?.contentType === "string" ? parsed.contentType.toLowerCase() : "take";
  const valid: DailyGrindContentType[] = ["tactic", "take", "story", "rant", "special"];
  const contentType: DailyGrindContentType = (valid.includes(raw as DailyGrindContentType)
    ? raw
    : "take") as DailyGrindContentType;
  const reason = typeof parsed?.reason === "string" ? parsed.reason : "fallback default";
  return {
    contentType,
    reason,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
  };
}

/**
 * Post-generation voice review pass. Scans the generated content for
 * hollowness markers Mark flagged in real feedback:
 *  - The Unspoken lacks scene/dollar-anchor (just stats, no story)
 *  - One theme word repeated across 3+ sections (mode-collapse)
 *  - The Closing restates The Number with no new angle
 *  - Sentence rhythm uniform (no short punch lines)
 *
 * Returns a pass/fail + specific defects. If failed, caller runs the
 * rewrite-to-sharpen pass. ~$0.005 per call.
 */
async function voiceReview(
  client: Anthropic,
  content: DailyGrindContent,
): Promise<{
  passed: boolean;
  score: number;
  defects: string[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const userPrompt = `Review this Daily Grind issue against Mark's voice bar. Mark's hallmarks: scene-anchored Unspoken with dollar punchline, sharp 12-20 word Flip reframe, First Pull with narrative tension (not stat dump), each section adds a NEW angle (no theme-word repetition), Closing lands somewhere The Number didn't already say, sentence rhythm varies (short punches + longer development).

ISSUE TO REVIEW:
- Headline: ${content.headline}
- The Number: ${content.openingTrifecta.theNumber.stat} — ${content.openingTrifecta.theNumber.description.slice(0, 200)}
- The Unspoken: ${content.openingTrifecta.theUnspoken}
- The Flip Reality: ${content.openingTrifecta.theFlip.reality}
- First Pull para 1: ${content.firstPull.paragraphs[0]}
- Main Content closing: ${content.mainContent.closing}
- Grounds for Thought: ${content.groundsForThought}

Check for these specific defects:
1. hollow_unspoken: Unspoken has stats/analysis but NO physical scene (no lunch, no scene-detail, no dollar punchline tied to a specific moment)
2. theme_repetition: same theme word (e.g. "the gap") appears across 3+ sections
3. closing_repeats_number: Closing restates the same claim as The Number with no new angle
4. flip_too_long: The Flip Reality is over 25 words OR sounds analytical instead of punchy
5. no_position: First Pull para 1 is a stat dump with no narrative or argument
6. uniform_rhythm: all sentences in the same length range (no short punch lines under 8 words)

Return ONLY this JSON:
{
  "score": <1-10>,
  "passed": <true if score >= 7 AND no critical defects>,
  "defects": [<list of defect keys from above that fired>]
}`;

  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: VOICE_REVIEW_MAX_TOKENS,
    temperature: 0.1,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    return {
      passed: false,
      score: 0,
      defects: ["review_failed_no_text"],
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  }
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(extractJsonObject(block.text)) as Record<string, unknown>;
  } catch {
    return {
      passed: false,
      score: 0,
      defects: ["review_parse_failed"],
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  }
  const score = typeof parsed.score === "number" ? parsed.score : 0;
  const passed = parsed.passed === true;
  const defects = Array.isArray(parsed.defects)
    ? parsed.defects.filter((d): d is string => typeof d === "string")
    : [];
  return {
    passed,
    score,
    defects,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
  };
}

/**
 * If voice review fails, run a Sonnet rewrite pass to sharpen the content
 * in Mark's voice. Reuses the same prompt logic as the admin rewrite endpoint
 * but in-pipeline. ~$0.05 per call. Triggered only when voiceReview flags defects.
 */
const VOICE_SHARPEN_SYSTEM = `You sharpen an existing Daily Grind issue in Mark's voice. Mark's voice is direct, contrarian, scene-anchored, specific. The reader is an independent financial advisor.

Preserve EXACTLY:
- All facts, numbers, statistics
- All sourceUrls and source names in worthKnowing
- The ancientTruth verse and reference (keep the verse text and book reference identical)
- The contentType
- The JSON schema

Sharpen these specific defects (only address the ones in the defects list provided):
- hollow_unspoken: Rewrite the Unspoken to include a SPECIFIC SCENE — a named lunch order, a CRM tag, a charity-event moment, a physical detail — plus a dollar-amount punchline tied to that scene. Mark's Unspokens look like the lobster lunch in 2022 / the COI named "HOT COI" / the dog hearing the same speech.
- theme_repetition: Find the theme word/phrase repeated across 3+ sections and rewrite the lower-priority instances with fresh language. Each section should add a NEW angle, not restate the thesis.
- closing_repeats_number: Rewrite the Main Content closing to land somewhere the Number paragraph didn't already say — a directive, a new twist, or a fresh framing.
- flip_too_long: Compress The Flip Reality to 12-20 words. One sharp reframe.
- no_position: Rewrite First Pull para 1 to either (a) name conventional wisdom and signal the flip, or (b) tell a 2-character narrative with contrast. Not a stat dump.
- uniform_rhythm: Add at least 3 sentences under 8 words somewhere in the body for impact.

Do NOT:
- Add em dashes (use commas, periods, "...")
- Use AI vocabulary (crucial, robust, comprehensive, delve, leverage)
- Hedge ("of course this depends," "your mileage may vary")

Return the FULL revised JSON object with the same schema. No preamble, no fences.`;

async function voiceSharpenRewrite(
  client: Anthropic,
  content: DailyGrindContent,
  defects: string[],
): Promise<{
  content: DailyGrindContent | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const userPrompt = `Defects to address: ${defects.join(", ")}

Original issue JSON:
${JSON.stringify(content, null, 2)}

Return the revised JSON only.`;

  const start = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: WRITER_MAX_TOKENS,
    temperature: 0.55,
    system: VOICE_SHARPEN_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    return {
      content: null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  }
  try {
    const revised = parseContent(block.text);
    return {
      content: deepStripDashes(revised),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  } catch {
    return {
      content: null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  }
}

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
  contentType: DailyGrindContentType,
  pipeline: PipelineStageRecord[] = [],
): Promise<{
  content: DailyGrindContent;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const userPrompt = buildWriterUserPrompt(
    issueDate,
    research,
    contentType,
    recentTopics,
    recentVerses,
    [],
    recentConcepts,
  );

  // Load ONLY the content-type-specific voice module via getDailyGrindVoiceSystemPrompt(contentType).
  // Previously the const DAILY_GRIND_VOICE_SYSTEM_PROMPT was used, which
  // composed ALL 5 content-type modules into a single ~51K-token prompt.
  // That left the writer guessing which structure to use. Now the writer sees
  // only the relevant content-type spec for this issue.
  const contentTypeVoicePrompt = getDailyGrindVoiceSystemPrompt(contentType);
  const start = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: WRITER_MAX_TOKENS,
    temperature: WRITER_TEMPERATURE,
    system: [
      {
        type: "text",
        text: contentTypeVoicePrompt,
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

  // Validate Worth Knowing URLs against research bundle. If the writer
  // hallucinated a URL not in research, do one targeted retry pointing at
  // the specific items that are actually available. Same recovery pattern
  // as the duplicate-URL case — better to ship a corrected issue than fail.
  const researchUrlSet = new Set(research.items.map((r) => r.url));
  const invalidUrlIndices = content.worthKnowing
    .map((w, i) => (researchUrlSet.has(w.sourceUrl) ? -1 : i))
    .filter((i) => i >= 0);
  if (invalidUrlIndices.length === 0) {
    pipeline.push({
      name: "worth_knowing_url_check",
      status: "success",
      notes: "all 3 sourceUrls match research items",
    });
  }
  if (invalidUrlIndices.length > 0) {
    const goodUrls = new Set(
      content.worthKnowing
        .filter((w) => researchUrlSet.has(w.sourceUrl))
        .map((w) => w.sourceUrl),
    );
    const unused = research.items.filter((r) => !goodUrls.has(r.url));
    if (unused.length >= invalidUrlIndices.length) {
      const retryPrompt = `${userPrompt}

(Retry note: the previous draft cited ${invalidUrlIndices.length} URL${invalidUrlIndices.length > 1 ? "s" : ""} that don't appear in the research bundle (invented sources). Every Worth Knowing item's sourceUrl must EXACTLY MATCH one of the URLs in the research array above. Available research items you haven't used yet:
${unused.slice(0, 8).map((u) => `- ${u.source}: ${u.title} (${u.url})`).join("\n")}

Pick from those for the Worth Knowing slots. Use the URL verbatim.)`;
      const retryStart = Date.now();
      const retry = await client.messages.create({
        model: MODEL,
        max_tokens: WRITER_MAX_TOKENS,
        temperature: WRITER_TEMPERATURE,
        system: [
          {
            type: "text",
            text: contentTypeVoicePrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: retryPrompt }],
      });
      totalLatency += Date.now() - retryStart;
      totalInput += retry.usage.input_tokens;
      totalOutput += retry.usage.output_tokens;
      const retryBlock = retry.content[0];
      let retrySucceeded = false;
      if (retryBlock && retryBlock.type === "text") {
        try {
          let retryContent = parseContent(retryBlock.text);
          retryContent = deepStripDashes(retryContent);
          // Only accept retry if it produces a valid bundle
          const retryUnknownUrls = retryContent.worthKnowing.filter(
            (w) => !researchUrlSet.has(w.sourceUrl),
          );
          if (retryUnknownUrls.length === 0) {
            content = retryContent;
            retrySucceeded = true;
          }
        } catch {
          // Retry failed — fall through to the validate call below which
          // will throw with the original invalid-URL error.
        }
      }
      pipeline.push({
        name: "worth_knowing_url_check",
        status: retrySucceeded ? "retried" : "warning",
        notes: retrySucceeded
          ? `writer hallucinated ${invalidUrlIndices.length} URL(s); retry produced valid bundle`
          : `writer hallucinated ${invalidUrlIndices.length} URL(s); retry did not recover`,
      });
    }
  }
  // Final validation — if still invalid, this throws (an unrecoverable case).
  validateAgainstResearch(content.worthKnowing, research);

  // Worth Knowing distinctness retry: if the writer cited the same story 2-3
  // ways, do one targeted retry pointing at specific UNUSED research items.
  // This used to throw and kill the issue; the new behavior keeps the writer
  // free of negative-constraint noise in the main prompt while still
  // guaranteeing 3 distinct stories ship.
  const dupes = findDuplicateSourceUrls(content.worthKnowing);
  if (dupes.length === 0) {
    pipeline.push({
      name: "worth_knowing_distinctness",
      status: "success",
      notes: "all 3 sourceUrls distinct",
    });
  }
  if (dupes.length > 0) {
    const usedUrls = new Set(content.worthKnowing.map((w) => w.sourceUrl));
    const unused = research.items.filter((r) => !usedUrls.has(r.url));
    if (unused.length >= 1) {
      const retryPrompt = `${userPrompt}

(Retry note: the previous draft used the same sourceUrl in multiple Worth Knowing slots. Each Worth Knowing item must point to a different research item. Suggested replacements drawn from research items you didn't use yet — pick any of these for the duplicated slot(s):
${unused.slice(0, 5).map((u) => `- ${u.source}: ${u.title} (${u.url})`).join("\n")})`;
      const retryStart = Date.now();
      const retry = await client.messages.create({
        model: MODEL,
        max_tokens: WRITER_MAX_TOKENS,
        temperature: WRITER_TEMPERATURE,
        system: [
          {
            type: "text",
            text: contentTypeVoicePrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: retryPrompt }],
      });
      totalLatency += Date.now() - retryStart;
      totalInput += retry.usage.input_tokens;
      totalOutput += retry.usage.output_tokens;
      const retryBlock = retry.content[0];
      let dupeRetrySucceeded = false;
      if (retryBlock && retryBlock.type === "text") {
        try {
          let retryContent = parseContent(retryBlock.text);
          retryContent = deepStripDashes(retryContent);
          validateAgainstResearch(retryContent.worthKnowing, research);
          if (findDuplicateSourceUrls(retryContent.worthKnowing).length === 0) {
            content = retryContent;
            dupeRetrySucceeded = true;
          }
        } catch {
          // Retry parse failed — keep the original (with dupes). Better to
          // ship the issue with one repeated URL than fail the whole send.
        }
      }
      pipeline.push({
        name: "worth_knowing_distinctness",
        status: dupeRetrySucceeded ? "retried" : "warning",
        notes: dupeRetrySucceeded
          ? `writer used ${dupes.length} duplicate URL(s); retry produced distinct bundle`
          : `writer used ${dupes.length} duplicate URL(s); retry did not recover, shipping with duplicates`,
      });
    }
  }

  // Headline pattern check: if the writer produced a headline matching one of
  // the banned formulas (e.g. "Nobody's X"), rewrite it via Haiku rather than
  // ship a weak/repetitive hook. Up to 3 attempts before we accept whatever
  // we have to avoid a generation failure on a recoverable issue.
  const headlineBan = headlineBanMatch(content.headline);
  if (!headlineBan) {
    pipeline.push({
      name: "headline_check",
      status: "success",
      notes: `headline does not match any banned pattern: "${content.headline}"`,
    });
  }
  if (headlineBan) {
    const contextSummary = content.firstPull.paragraphs[0] ?? content.headline;
    const originalHeadline = content.headline;
    let rewritten: string | null = null;
    let bannedPattern = headlineBan;
    let headlineAttempts = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      headlineAttempts++;
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
      pipeline.push({
        name: "headline_check",
        status: "retried",
        notes: `original "${originalHeadline}" matched ${headlineBan.name}; Haiku rewrite (${headlineAttempts} attempts) → "${rewritten}"`,
      });
    } else {
      pipeline.push({
        name: "headline_check",
        status: "warning",
        notes: `original "${originalHeadline}" matched ${headlineBan.name}; ${headlineAttempts} rewrites also matched, shipping original`,
      });
    }
    // If all 3 rewrites still matched a banned pattern, ship the original
    // rather than fail the issue — at least the rest of the content is good.
  }

  if (
    recentVerses.length === 0 ||
    !verseConflictsWithRecent(content.ancientTruth.reference, recentVerses)
  ) {
    pipeline.push({
      name: "verse_swap",
      status: "skipped",
      notes: `verse "${content.ancientTruth.reference}" not in ban list (${recentVerses.length} recent verses tracked)`,
    });
  }
  if (
    recentVerses.length > 0 &&
    verseConflictsWithRecent(content.ancientTruth.reference, recentVerses)
  ) {
    const originalVerse = content.ancientTruth.reference;
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
      pipeline.push({
        name: "verse_swap",
        status: "warning",
        notes: `"${originalVerse}" in ban list; ${temps.length} Haiku swaps also picked banned verses, shipping original`,
      });
    } else {
      pipeline.push({
        name: "verse_swap",
        status: "retried",
        notes: `"${originalVerse}" in ban list → Haiku picked "${swap.reference}"`,
      });
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
  const pipeline: PipelineStageRecord[] = [];

  // Research phase backend selection.
  // - "anthropic" (DEFAULT): Anthropic Sonnet 4.5 + web_search tool. ~$0.50/call.
  //   Read-the-content-inline architecture means citations are reliable and
  //   URLs are real article URLs (not redirect proxies). 5/5 success rate
  //   in empirical testing 2026-05-19.
  // - "gemini": Gemini 2.5 Flash + Google Search grounding. Cheaper (~$0.05)
  //   but topic-dependent — Gemini sometimes returns vertex redirect URLs in
  //   item.url instead of real article URLs, causing strict-domain-filter
  //   drops. 1 in 5 usable bundles in empirical testing. Kept as opt-in
  //   experiment but NOT default.
  // - "perplexity": only useful for Latte-style consumer content. Does not
  //   surface advisor industry publications for Daily Grind.
  const backend = (process.env.RESEARCH_BACKEND ?? "anthropic").toLowerCase();
  let research;
  if (backend === "gemini" && process.env.GOOGLE_API_KEY) {
    const gemOpts: Parameters<typeof runGeminiResearch>[0] = {
      issueDate: opts.issueDate,
      recentTopics,
      recentConcepts,
    };
    if (opts.topicHint) gemOpts.topicHint = opts.topicHint;
    let lastGemErr: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const gem = await runGeminiResearch(gemOpts);
        research = {
          bundle: gem.bundle,
          inputTokens: gem.inputTokens,
          outputTokens: gem.outputTokens,
          webSearches: gem.webSearches,
          latencyMs: gem.latencyMs,
          funnel: gem.funnel,
        };
        break;
      } catch (err) {
        lastGemErr = err;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    // Anthropic fallback: if Gemini failed both attempts, fall through to
    // Anthropic web_search rather than throw. Anthropic is more expensive
    // but produces real advisor sources reliably.
    if (!research) {
      console.warn(
        `[daily-grind] Gemini research exhausted (2 attempts), falling back to Anthropic web_search. Last error: ${lastGemErr instanceof Error ? lastGemErr.message : String(lastGemErr)}`,
      );
      try {
        research = await runResearchPhase(
          client,
          opts.issueDate,
          recentTopics,
          recentConcepts,
          opts.topicHint,
        );
      } catch (anthropicErr) {
        const gemMsg = lastGemErr instanceof Error ? lastGemErr.message : String(lastGemErr);
        const antMsg =
          anthropicErr instanceof Error ? anthropicErr.message : String(anthropicErr);
        throw new Error(
          `research: both Gemini and Anthropic fallback failed. Gemini: ${gemMsg}. Anthropic: ${antMsg}`,
        );
      }
    }
  } else if (backend === "perplexity" && process.env.PERPLEXITY_API_KEY) {
    const perpOpts: Parameters<typeof runPerplexityResearch>[0] = {
      issueDate: opts.issueDate,
      recentTopics,
      recentConcepts,
    };
    if (opts.topicHint) perpOpts.topicHint = opts.topicHint;
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
          funnel: perp.funnel,
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
    // Primary: Anthropic web_search. Hits Google search directly, supports
    // site: operators, returns real advisor industry sources for the queries
    // we hand it.
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
        research = await runResearchPhase(
          client,
          opts.issueDate,
          recentTopics,
          recentConcepts,
          opts.topicHint,
        );
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
    pipeline.push({
      name: "research",
      status: "success",
      latencyMs: research.latencyMs,
      notes: `backend=${backend}, items=${research.bundle.items.length}, distinctSources=${distinctSources.size}`,
      data: {
        backend,
        itemCount: research.bundle.items.length,
        distinctSources: distinctSources.size,
        sources: Array.from(distinctSources),
      },
    });
  }
  // STAGE: content-type picker — decide before writer runs so the system
  // prompt loads only the relevant content-type spec.
  const pickStart = Date.now();
  let chosenContentType: DailyGrindContentType = "take";
  let contentTypeReason = "default fallback";
  let contentTypePickerCost = { input: 0, output: 0, latency: 0 };
  try {
    const picked = await pickContentType(client, research.bundle, recentTopics);
    chosenContentType = picked.contentType;
    contentTypeReason = picked.reason;
    contentTypePickerCost = {
      input: picked.inputTokens,
      output: picked.outputTokens,
      latency: picked.latencyMs,
    };
    pipeline.push({
      name: "content_type_picker",
      status: "success",
      latencyMs: Date.now() - pickStart,
      notes: `picked ${chosenContentType}: ${contentTypeReason}`,
    });
  } catch (err) {
    pipeline.push({
      name: "content_type_picker",
      status: "warning",
      latencyMs: Date.now() - pickStart,
      notes: `picker failed, defaulting to "take": ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const writerStart = Date.now();
  const writer = await runWriterPhase(
    client,
    opts.issueDate,
    research.bundle,
    recentTopics,
    recentVerses,
    recentConcepts,
    chosenContentType,
    pipeline,
  );
  pipeline.push({
    name: "writer",
    status: "success",
    latencyMs: Date.now() - writerStart,
    notes: `headline="${writer.content.headline}", contentType=${chosenContentType}`,
    data: {
      inputTokens: writer.inputTokens,
      outputTokens: writer.outputTokens,
    },
  });

  // STAGE: voice review + conditional sharpen rewrite
  // Cheap Haiku scoring pass catches hollow-voice drift the writer's
  // post-process validators don't see (the Unspoken without a scene, theme
  // mode-collapse across sections, closing that restates The Number). If
  // the review flags defects, run one Sonnet rewrite to sharpen.
  let finalContent = writer.content;
  let voiceReviewCost = { input: 0, output: 0, latency: 0 };
  let sharpenCost = { input: 0, output: 0, latency: 0 };
  try {
    const reviewStart = Date.now();
    const review = await voiceReview(client, finalContent);
    voiceReviewCost = {
      input: review.inputTokens,
      output: review.outputTokens,
      latency: review.latencyMs,
    };
    pipeline.push({
      name: "voice_review",
      status: review.passed ? "success" : "warning",
      latencyMs: Date.now() - reviewStart,
      notes: `score=${review.score}/10, defects=[${review.defects.join(", ") || "none"}]`,
    });

    if (!review.passed && review.defects.length > 0) {
      const sharpenStart = Date.now();
      const sharpened = await voiceSharpenRewrite(client, finalContent, review.defects);
      sharpenCost = {
        input: sharpened.inputTokens,
        output: sharpened.outputTokens,
        latency: sharpened.latencyMs,
      };
      if (sharpened.content) {
        finalContent = sharpened.content;
        pipeline.push({
          name: "voice_sharpen",
          status: "retried",
          latencyMs: Date.now() - sharpenStart,
          notes: `addressed defects: ${review.defects.join(", ")}`,
        });
      } else {
        pipeline.push({
          name: "voice_sharpen",
          status: "warning",
          latencyMs: Date.now() - sharpenStart,
          notes: `sharpen attempted but parse failed, shipping original`,
        });
      }
    }
  } catch (err) {
    pipeline.push({
      name: "voice_review",
      status: "warning",
      notes: `review skipped due to error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const totalCost = estimateCostUsd(
    research.inputTokens,
    research.outputTokens,
    research.webSearches,
    writer.inputTokens + contentTypePickerCost.input + voiceReviewCost.input + sharpenCost.input,
    writer.outputTokens + contentTypePickerCost.output + voiceReviewCost.output + sharpenCost.output,
  );

  return {
    content: finalContent,
    research: research.bundle,
    pipeline,
    meta: {
      model: MODEL,
      researchInputTokens: research.inputTokens,
      researchOutputTokens: research.outputTokens,
      researchWebSearches: research.webSearches,
      writerInputTokens: writer.inputTokens,
      writerOutputTokens: writer.outputTokens,
      totalCostUsd: totalCost,
      researchLatencyMs: research.latencyMs,
      writerLatencyMs:
        writer.latencyMs + contentTypePickerCost.latency + voiceReviewCost.latency + sharpenCost.latency,
      issueDate: opts.issueDate,
      ...("funnel" in research && research.funnel ? { researchFunnel: research.funnel } : {}),
    },
  };
}
