import Anthropic from "@anthropic-ai/sdk";
import {
  CANONICAL_EXAMPLES,
  getDailyGrindVoiceSystemPrompt,
} from "./daily-grind-voice-prompt";
import { RESEARCH_SYSTEM_PROMPT } from "./daily-grind-research-prompt";
import { runPerplexityResearch } from "./daily-grind-research-perplexity";
import { runGeminiResearch } from "./daily-grind-research-gemini";
import { buildTopicProposerPrompt } from "./pipeline-blocks/topic-proposer";
import {
  buildResearchWeekdayPrompt,
  type StructuredResearchOutput,
} from "./pipeline-blocks/research-weekday";
import { buildDraftWeekdayPrompt } from "./pipeline-blocks/draft-weekday";
import { buildStylePassPrompt } from "./pipeline-blocks/style-pass";
import { buildEditorPassPrompt } from "./pipeline-blocks/editor-pass";
import { buildFactCheckPrompt } from "./pipeline-blocks/fact-check";
import {
  buildPersonaEvaluatePrompt,
  type PersonaEvaluation,
} from "./pipeline-blocks/persona-evaluate";
import { PERSONAS } from "./pipeline-blocks/personas";
import { scoreAggregate, type ScoreAggregateResult } from "./pipeline-blocks/score-aggregate";
import { buildPersonaRevisionPrompt } from "./pipeline-blocks/persona-revision";
import { applySurgicalRewrites } from "./pipeline-blocks/surgical-rewrites";
import {
  buildAssembleHtmlPrompt,
  type AssembleHtmlOutput,
} from "./pipeline-blocks/assemble-html";
import {
  buildIssueSummaryPrompt,
  type IssueSummary,
} from "./pipeline-blocks/issue-summary";
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
  // Structured research from the spec'd research_weekday block.
  // When present, the writer sees the full structured shape (primaryFindings,
  // frameworkAlignments, scriptsOrLanguage, worthKnowingItems, proverbCandidates,
  // researchNotes) instead of just a flat items list. items[] is derived
  // from worthKnowingItems[] as an adapter for legacy validators.
  structured?: StructuredResearchOutput;
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
  /**
   * Handoff input: what this stage RECEIVED from prior stages.
   * Captures the contract / instruction it was given, so we can see if its
   * output actually honored the handoff.
   */
  input?: Record<string, unknown>;
  /**
   * Handoff output: the structured product of this stage that downstream
   * stages will (or should) consume. Pair (input, output) lets us debug
   * drift — e.g. proposer says "tactic about referrals," writer outputs
   * a take about M&A → output.cluster will reveal the break.
   */
  output?: Record<string, unknown>;
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
    issueSummary?: IssueSummary;
    /**
     * Final quality-gate status per spec `04_content_pipeline.spec.md:728`.
     *  - "passed": all gates clean, ship normally
     *  - "pending_review_with_warnings": at least one gate produced a
     *    warning serious enough to flag — issue is published but trace
     *    surface should show it as needing human review
     */
    qualityGateStatus?: "passed" | "pending_review_with_warnings";
    /**
     * List of reasons the issue is flagged. Empty when status=passed.
     */
    qualityGateWarnings?: string[];
  };
};

const MODEL = "claude-sonnet-4-5-20250929";
const RESEARCH_TEMPERATURE = 0;
const RESEARCH_MAX_TOKENS = 5000;
const WRITER_TEMPERATURE = 0.45;
const WRITER_MAX_TOKENS = 5000;
const WEB_SEARCH_MAX_USES = 8;

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

// ─── Pipeline drift detection ───────────────────────────────────────────────
//
// At each handoff between blocks (proposer → research → writer → summary),
// compare what the upstream stage DECLARED its intent to be against what the
// downstream stage actually produced. Flag mismatches so Mark/Austin can
// debug "the proposer wanted X but the writer shipped Y."

type DriftFlag = {
  code: string;
  fromStage: string;
  toStage: string;
  detail: string;
};

type DriftInput = {
  proposerCluster: string | null;
  proposerContentType: string | null;
  proposerTopic: string | null;
  summaryCluster: string | null;
  finalContentType: string;
  finalHeadline: string;
  researchSources: string[];
};

/**
 * Cluster keywords mined from `pipeline-blocks/issue-summary.ts` reference list.
 * Used to *guess* the cluster of a free-text proposer topic when we don't yet
 * have a structured cluster field on the proposer output. (Issue_summary emits
 * the canonical cluster — this is just a heuristic for the handoff check.)
 */
const CLUSTER_KEYWORDS: Array<{ cluster: string; patterns: RegExp[] }> = [
  { cluster: "prospecting-prep", patterns: [/discovery call/i, /prospecting/i, /linkedin intel/i, /pre.?meeting/i, /coi lunch/i] },
  { cluster: "referral-mechanics", patterns: [/referral/i, /center.? of influence/i, /\bcoi\b/i] },
  { cluster: "compliance-documentation", patterns: [/\bwsp\b/i, /sec exam/i, /\badv\b/i, /marketing rule/i, /compliance documentation/i] },
  { cluster: "m-and-a-buyer-vetting", patterns: [/\bm&a\b/i, /\bm and a\b/i, /buyer vetting/i, /earnout/i, /due diligence/i, /buyer integration/i, /\bria sale\b/i, /selling your practice/i] },
  { cluster: "m-and-a-valuation", patterns: [/valuation/i, /aum multiple/i, /deal terms/i, /growth.?rate/i] },
  { cluster: "fee-and-pricing", patterns: [/fee compression/i, /pricing/i, /flat.?fee/i, /retainer/i, /free planning/i] },
  { cluster: "team-and-scaling", patterns: [/hiring/i, /succession/i, /capacity/i, /founder bottleneck/i, /team building/i] },
  { cluster: "compliance-supervision", patterns: [/supervisory/i, /principal review/i, /audit trail/i] },
  { cluster: "tax-scenarios", patterns: [/roth conversion/i, /year.?end planning/i, /estate transition/i, /tax scenario/i] },
  { cluster: "client-communication", patterns: [/annual review/i, /market panic/i, /client retention/i, /client communication/i] },
  { cluster: "tech-and-tools", patterns: [/\bcrm\b/i, /ai tool/i, /integration sprawl/i] },
  { cluster: "positioning-and-niche", patterns: [/niche/i, /positioning/i, /demographic vs transition/i, /contrarian positioning/i] },
];

function detectClusterFromString(s: string | null): string | null {
  if (!s) return null;
  for (const entry of CLUSTER_KEYWORDS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(s)) return entry.cluster;
    }
  }
  return null;
}

function computePipelineDrift(input: DriftInput): {
  flags: DriftFlag[];
  handoffs: Record<string, unknown>;
} {
  const flags: DriftFlag[] = [];
  const handoffs: Record<string, unknown> = {
    proposer_to_research: {
      proposerTopic: input.proposerTopic,
      proposerCluster: input.proposerCluster,
      researchSources: input.researchSources,
    },
    research_to_writer: {
      proposerContentType: input.proposerContentType,
      finalContentType: input.finalContentType,
    },
    writer_to_summary: {
      finalHeadline: input.finalHeadline,
      summaryCluster: input.summaryCluster,
      proposerCluster: input.proposerCluster,
    },
  };

  if (input.proposerCluster && input.summaryCluster && input.proposerCluster !== input.summaryCluster) {
    flags.push({
      code: "cluster_drift",
      fromStage: "topic_proposer",
      toStage: "issue_summary",
      detail: `proposer aimed for cluster "${input.proposerCluster}" but final draft summary cluster is "${input.summaryCluster}"`,
    });
  }
  if (input.proposerContentType && input.proposerContentType !== input.finalContentType) {
    flags.push({
      code: "content_type_drift",
      fromStage: "topic_proposer",
      toStage: "writer",
      detail: `proposer picked "${input.proposerContentType}" but final shipped as "${input.finalContentType}"`,
    });
  }
  const headlineCluster = detectClusterFromString(input.finalHeadline);
  if (input.proposerCluster && headlineCluster && headlineCluster !== input.proposerCluster) {
    flags.push({
      code: "headline_cluster_drift",
      fromStage: "topic_proposer",
      toStage: "assemble_html",
      detail: `proposer aimed for cluster "${input.proposerCluster}" but final inbox headline reads as cluster "${headlineCluster}"`,
    });
  }
  return { flags, handoffs };
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

/**
 * Run the spec'd weekday research block. Uses Anthropic web_search with the
 * structured prompt from pipeline-blocks/research-weekday.ts. Returns the
 * full structured output (primaryFindings + frameworkAlignments +
 * scriptsOrLanguage + worthKnowingItems + proverbCandidates + researchNotes)
 * AND a legacy ResearchBundle.items[] adapter for backward-compat with
 * existing post-process validators.
 */
async function runStructuredResearchWeekday(
  client: Anthropic,
  issueDate: string,
  proposal: {
    contentType: string;
    topic: string;
    angle: string;
    frameworkReferences: string[];
  },
  recentTopics: string[],
  expandQueries: boolean = false,
): Promise<ResearchResult> {
  let userPrompt = buildResearchWeekdayPrompt({
    brandId: "castor_abbott",
    issueDate,
    approvedTopic: proposal,
    recentlyUsedSources: [],
    factCheckHistory: recentTopics,
  });

  if (expandQueries) {
    // Second-attempt augmentation: the first attempt returned <5 items. Push
    // the model to broaden its search strategy and try adjacent angles
    // before giving up.
    userPrompt += `\n\n## RETRY CONTEXT — READ CAREFULLY\n\nThe first research pass returned fewer than 5 items, which is insufficient. Broaden your search strategy:\n\n1. Run MORE web_search calls (you have ${WEB_SEARCH_MAX_USES} max — use 6-8 of them, not 2-3).\n2. Try ADJACENT angles: if "${proposal.topic}" returned thin results, search for related terms (synonyms, broader category names, vendor/product names in the space, regulatory keywords).\n3. Search MULTIPLE source domains in parallel: thinkadvisor.com, wealthmanagement.com, kitces.com, investmentnews.com, financial-planning.com, fa-mag.com, riaintel.com, advisorhub.com.\n4. If you still can't find ${WEB_SEARCH_MAX_USES} unique items, return what you have but include them all — do NOT return fewer than your first pass.`;
  }

  const start = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    temperature: RESEARCH_TEMPERATURE,
    system: `You are the research analyst for The Daily Grind, a weekday newsletter for independent financial advisors. You have access to the web_search tool — use it aggressively to find real, cited, recent material on the approved topic. The writer block needs 5-8 distinct cited items minimum; fewer than 5 forces the writer to repeat sources, which damages quality.

Be specific: dollar amounts, percentages, specific scripts, real publication names. Avoid generic claims.

Return only the JSON output specified in the user message.`,
    tools: [
      {
        type: "web_search_20260209",
        name: "web_search",
        max_uses: WEB_SEARCH_MAX_USES,
        allowed_callers: ["direct"],
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
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
    throw new Error("research_weekday: no text block in response");
  }

  // Parse the structured output
  const jsonText = extractJsonObject(textOutput);
  let structured: StructuredResearchOutput;
  try {
    structured = JSON.parse(jsonText) as StructuredResearchOutput;
  } catch (err) {
    throw new Error(
      `research_weekday: failed to parse JSON: ${err instanceof Error ? err.message : String(err)}\nfirst 300 chars: ${jsonText.slice(0, 300)}`,
    );
  }

  // Validate structure. We throw at < 3 (catastrophic — writer can't ship)
  // but accept 3-4 with a downstream gate flag (the retry loop in the
  // caller will trigger a broader-query retry if itemCount < 5).
  if (!Array.isArray(structured.worthKnowingItems) || structured.worthKnowingItems.length < 3) {
    throw new Error(
      `research_weekday: need at least 3 worthKnowingItems, got ${structured.worthKnowingItems?.length ?? 0}`,
    );
  }

  // Adapter: derive legacy items[] from worthKnowingItems[] so the existing
  // post-process validators (URL match, distinctness) keep working.
  const items: ResearchItem[] = structured.worthKnowingItems.map((w) => {
    const item: ResearchItem = {
      category: "Industry",
      title: w.headline,
      url: w.url,
      source: w.source,
      summary: w.summary,
    };
    if (w.stat) {
      item.keyStats = [{ number: w.stat, label: w.relevance }];
    }
    return item;
  });

  const bundle: ResearchBundle = {
    researchedOn: issueDate,
    items,
    structured,
  };

  return {
    bundle,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    webSearches,
    latencyMs,
  };
}

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
 * Topic Proposer — uses the spec'd prompt from apps/pipeline/.../topic_proposer.ts.
 *
 * Runs BEFORE research so the topic decision drives research, not the
 * reverse. Outputs: contentType + topic + angle + framework references +
 * rationale. Replaces the previous pickContentType which only picked the
 * type after-the-fact based on whatever research came back.
 */
async function runTopicProposer(
  client: Anthropic,
  issueDate: string,
  recentHeadlines: string[],
  blockedConcepts: string[],
  recentIssueSummaries: Array<{
    publishedAt: string;
    contentType: string;
    topic: string;
    cluster?: string;
    mainAngle?: string;
    keyTakes?: string[];
    scenesUsed?: string;
    frameworksApplied?: string[];
    freshAfter?: string;
  }> = [],
): Promise<{
  contentType: DailyGrindContentType;
  topic: string;
  angle: string;
  frameworkReferences: string[];
  rationale: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  // Build RecentIssue list. Prefer structured summaries when available
  // (carries cluster/angle/keyTakes/scenes/frameworks) — fall back to
  // headline-only for older issues that pre-date the issue_summary block.
  const summaryByTopic = new Map(recentIssueSummaries.map((s) => [s.topic, s]));
  const recentIssues = recentHeadlines.slice(0, 30).map((h) => {
    const summary = summaryByTopic.get(h);
    if (summary) {
      return {
        publishedAt: summary.publishedAt,
        contentType: summary.contentType,
        topic: summary.topic,
        ...(summary.cluster ? { cluster: summary.cluster } : {}),
        ...(summary.mainAngle ? { mainAngle: summary.mainAngle } : {}),
        ...(summary.keyTakes ? { keyTakes: summary.keyTakes } : {}),
        ...(summary.scenesUsed ? { scenesUsed: summary.scenesUsed } : {}),
        ...(summary.frameworksApplied ? { frameworksApplied: summary.frameworksApplied } : {}),
        ...(summary.freshAfter ? { freshAfter: summary.freshAfter } : {}),
      };
    }
    return {
      publishedAt: new Date().toISOString(),
      contentType: "unknown",
      topic: h,
    };
  });

  const userPrompt = buildTopicProposerPrompt({
    brandId: "castor_abbott",
    edition: "weekday",
    issueDate,
    recentIssues,
    blockedConcepts,
  });

  // Day-of-week affinity per the spec content_pipeline.spec.md:
  // Mon=Tactic, Tue=Take, Wed=Tactic, Thu=Story or Special, Fri=Tactic+Digital Grind.
  // The proposer prompt sees this as a calendar hint to bias selection.
  const issueDow = new Date(issueDate + "T12:00:00Z").getUTCDay();
  const dowHints: Record<number, string> = {
    1: "Mondays favor Tactic (specific implementable move)",
    2: "Tuesdays favor Take (contrarian position)",
    3: "Wednesdays favor Tactic (different angle than Monday)",
    4: "Thursdays alternate Story (narrative) or Special (technical deep-dive)",
    5: "Fridays favor Tactic plus a Digital Grind angle",
  };
  const dowHint = dowHints[issueDow];
  const fullPrompt = dowHint
    ? `${userPrompt}\n\n## Day-of-Week Affinity\n${dowHint}`
    : userPrompt;

  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 600,
    temperature: 0.4,
    messages: [{ role: "user", content: fullPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("topic_proposer: missing text block");
  }

  let parsed: Record<string, unknown> | undefined;
  try {
    const json = extractJsonObject(block.text);
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    // fallback handled below
  }
  const validTypes: DailyGrindContentType[] = ["tactic", "take", "story", "rant", "special"];
  const raw = typeof parsed?.contentType === "string" ? parsed.contentType.toLowerCase() : "take";
  const contentType: DailyGrindContentType = (validTypes.includes(raw as DailyGrindContentType)
    ? raw
    : "take") as DailyGrindContentType;
  const topic = typeof parsed?.topic === "string" ? parsed.topic : "Advisor practice operations";
  const angle = typeof parsed?.angle === "string" ? parsed.angle : "Operational discipline drives outcomes";
  const frameworkReferences = Array.isArray(parsed?.frameworkReferences)
    ? (parsed.frameworkReferences as unknown[]).filter((f): f is string => typeof f === "string")
    : [];
  const rationale = typeof parsed?.rationale === "string" ? parsed.rationale : "fallback default";

  return {
    contentType,
    topic,
    angle,
    frameworkReferences,
    rationale,
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

/**
 * Style pass — narrow surface-level polish using the spec'd prompt from
 * apps/pipeline/.../style_pass.ts. Catches em dashes, banned phrases,
 * rhythm issues, hedge softening. Does NOT rewrite for substance.
 *
 * Uses Haiku for cost efficiency. ~$0.01 per call. Runs immediately after
 * the writer phase and before the validators / voice review.
 */
async function runStylePass(
  client: Anthropic,
  content: DailyGrindContent,
  contentType: DailyGrindContentType,
  issueDate: string,
): Promise<{
  content: DailyGrindContent;
  emDashesRemoved: number;
  bannedPhrasesReplaced: string[];
  hedgesRemoved: number;
  summary: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const userPrompt = buildStylePassPrompt({
    brandId: "castor_abbott",
    edition: "weekday",
    issueDate,
    draftJson: JSON.stringify(content, null, 2),
    contentType,
  });

  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 8000,
    temperature: 0.2,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("style_pass: missing text block");
  }

  // Parse the styled draft (same shape as input, plus styleNotes)
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonObject(block.text)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `style_pass: failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const styleNotes = parsed.styleNotes as Record<string, unknown> | undefined;
  delete parsed.styleNotes; // remove from content payload — we keep stats separately
  const styledContent = parsed as unknown as DailyGrindContent;

  return {
    content: deepStripDashes(styledContent),
    emDashesRemoved: (styleNotes?.emDashesRemoved as number) ?? 0,
    bannedPhrasesReplaced: (styleNotes?.bannedPhrasesReplaced as string[]) ?? [],
    hedgesRemoved: (styleNotes?.hedgesRemoved as number) ?? 0,
    summary: (styleNotes?.summary as string) ?? "no summary",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
  };
}

/**
 * Editor pass — spec'd substantive editorial review. Sonnet-based since
 * the review requires real judgment (framework honesty, earned-line
 * presence, content-type structural beats). ~$0.03 per call.
 *
 * Returns one of four verdicts:
 *  - approve: ship the approvedDraft (editor may have lightly polished)
 *  - approve_with_concerns: ship but flag for human review
 *  - revise: caller runs writer rewrite with revisionRequest
 *  - rewrite_section: caller runs writer section-rewrite with rewriteInstructions
 */
async function runEditorPass(
  client: Anthropic,
  content: DailyGrindContent,
  contentType: DailyGrindContentType,
  issueDate: string,
  iterationNumber: number,
  maxIterations: number,
): Promise<{
  verdict: "approve" | "revise" | "rewrite_section" | "approve_with_concerns";
  summary: string;
  specificFlags: Array<{ section: string; issue: string; severity: string; instruction: string }>;
  approvedDraft: DailyGrindContent | null;
  revisionRequest: string | null;
  rewriteSection: string | null;
  rewriteInstructions: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const userPrompt = buildEditorPassPrompt({
    brandId: "castor_abbott",
    edition: "weekday",
    issueDate,
    contentType,
    styledDraftJson: JSON.stringify(content, null, 2),
    iterationNumber,
    maxIterations,
  });

  const start = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    temperature: 0.3,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("editor_pass: missing text block");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonObject(block.text)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `editor_pass: failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const verdictRaw = typeof parsed.verdict === "string" ? parsed.verdict : "approve_with_concerns";
  const validVerdicts = ["approve", "revise", "rewrite_section", "approve_with_concerns"] as const;
  const verdict = (validVerdicts.includes(verdictRaw as (typeof validVerdicts)[number])
    ? verdictRaw
    : "approve_with_concerns") as (typeof validVerdicts)[number];

  const approvedDraft =
    parsed.approvedDraft && typeof parsed.approvedDraft === "object"
      ? (parsed.approvedDraft as DailyGrindContent)
      : null;

  return {
    verdict,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    specificFlags: Array.isArray(parsed.specificFlags)
      ? (parsed.specificFlags as Array<{
          section: string;
          issue: string;
          severity: string;
          instruction: string;
        }>)
      : [],
    approvedDraft,
    revisionRequest: typeof parsed.revisionRequest === "string" ? parsed.revisionRequest : null,
    rewriteSection: typeof parsed.rewriteSection === "string" ? parsed.rewriteSection : null,
    rewriteInstructions:
      typeof parsed.rewriteInstructions === "string" ? parsed.rewriteInstructions : null,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
  };
}

/**
 * Persona-driven substantive revision. Unlike runEditorRevision which says
 * "apply ONLY the flagged changes," this one tells the model to make the
 * structural changes needed so that the audience actually loves the piece.
 *
 * Used when score_aggregate returns verdict=fail. The revisionRequest carries
 * specific complaints from the lowest-love personas + benchmark-driven
 * priorities. The model is allowed (and pushed) to change scenes, framings,
 * earned lines, and Unspoken architecture — anything except facts, sources,
 * the verse, and the JSON schema.
 */
async function runPersonaRevision(
  client: Anthropic,
  content: DailyGrindContent,
  revisionRequest: string,
): Promise<{
  content: DailyGrindContent | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const userPrompt = `You are substantively revising a Daily Grind draft based on AUDIENCE FEEDBACK from a panel of 10 advisor personas. They did NOT love the current draft. You must change what they did not love.

Preserve EXACTLY:
- All facts, statistics, dollar amounts
- All sourceUrls and source names in worthKnowing
- The ancientTruth verse + reference
- The contentType
- The JSON schema shape

CHANGE freely:
- The Unspoken's scene, character action, and quotable line
- The framing of arguments in firstPull and mainContent
- The earned lines (the quotable, share-worthy positions)
- Closing direction (if it duplicates The Number)
- Section subheads if they read as generic

${revisionRequest}

Original draft:
${JSON.stringify(content, null, 2)}

Return the revised draft as a JSON object with the same schema. No preamble, no fences.`;

  const personaRevisionSystem = `You are rewriting a Daily Grind draft in Mark's voice to address specific audience complaints. The panel of advisors DIDN'T LOVE IT. Your job is to make changes that would change their love rating to YES. Be willing to rewrite scenes, redo earned lines, sharpen positions. Do NOT take the path of least resistance — superficial edits that ship the same draft with new words. If a section is fundamentally broken, REPLACE it.

Mark's voice: direct, contrarian, scene-anchored, specific. No AI vocabulary. No hedges. No em dashes.

Preserve facts, sources, URLs, verse, schema. Everything else is on the table.`;

  const start = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: WRITER_MAX_TOKENS,
    temperature: 0.55,
    system: personaRevisionSystem,
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

/**
 * If the editor flags revision needed, run a Sonnet rewrite of the full draft
 * with the editor's specific revision instructions. Same shape as voice
 * sharpen but with editor-level feedback (substantive, not surface).
 */
async function runEditorRevision(
  client: Anthropic,
  content: DailyGrindContent,
  revisionRequest: string,
  flags: Array<{ section: string; issue: string; instruction: string }>,
): Promise<{
  content: DailyGrindContent | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const flagsText = flags
    .map((f) => `- [${f.section}] ${f.issue} — ${f.instruction}`)
    .join("\n");

  const userPrompt = `You are revising a Daily Grind draft per editor feedback. Preserve facts, sources, URLs, the ancientTruth verse, the contentType, and the JSON schema EXACTLY. Apply the editor's specific revisions:

Editor revision request:
${revisionRequest}

Specific section flags:
${flagsText}

Original draft:
${JSON.stringify(content, null, 2)}

Return the revised draft as a JSON object with the same schema. No preamble, no fences.`;

  const editorRevisionSystem = `You are revising a Daily Grind draft in Mark's voice. Mark talks like a sharp colleague who has watched 1000+ advisors fail or succeed. Direct, opinionated, contrarian. Apply ONLY the editor's specific revisions. Do NOT rewrite for substance beyond what the editor flagged. Do NOT change facts, source URLs, or the ancientTruth verse. Do NOT add em dashes. Do NOT hedge.`;

  const start = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: WRITER_MAX_TOKENS,
    temperature: 0.45,
    system: editorRevisionSystem,
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

/**
 * Fact check — spec'd verification of every factual claim against the
 * original research. Catches cross-contamination, stat mismatches, unsourced
 * claims, anonymization failures. ~$0.03 per call. Sonnet-based since it
 * needs to reason about whether a claim is supported by research.
 */
async function runFactCheck(
  client: Anthropic,
  content: DailyGrindContent,
  research: ResearchBundle,
  issueDate: string,
): Promise<{
  verdict: "pass" | "fix_required" | "reject";
  summary: string;
  verifiedClaims: number;
  issues: Array<{
    section: string;
    claimInDraft: string;
    issueType: string;
    severity: string;
    fix: string;
  }>;
  fixedDraft: DailyGrindContent | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  // Use structured research if present, else the legacy items[] list
  const researchPayload = research.structured ?? { items: research.items };

  const userPrompt = buildFactCheckPrompt({
    brandId: "castor_abbott",
    edition: "weekday",
    issueDate,
    finalDraftJson: JSON.stringify(content, null, 2),
    originalResearchJson: JSON.stringify(researchPayload, null, 2),
  });

  const start = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    temperature: 0.1,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("fact_check: missing text block");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonObject(block.text)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `fact_check: failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const verdictRaw = typeof parsed.verdict === "string" ? parsed.verdict : "pass";
  const verdict: "pass" | "fix_required" | "reject" = ["pass", "fix_required", "reject"].includes(
    verdictRaw,
  )
    ? (verdictRaw as "pass" | "fix_required" | "reject")
    : "pass";

  const fixedDraft =
    parsed.fixedDraft && typeof parsed.fixedDraft === "object"
      ? (parsed.fixedDraft as DailyGrindContent)
      : null;

  return {
    verdict,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    verifiedClaims: typeof parsed.verifiedClaims === "number" ? parsed.verifiedClaims : 0,
    issues: Array.isArray(parsed.issues)
      ? (parsed.issues as Array<{
          section: string;
          claimInDraft: string;
          issueType: string;
          severity: string;
          fix: string;
        }>)
      : [],
    fixedDraft,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
  };
}

/**
 * Single-persona evaluation. Uses Haiku for cost (~$0.005 per call).
 * 10 of these run in parallel via runPersonaPanel.
 */
async function runPersonaEvaluate(
  client: Anthropic,
  content: DailyGrindContent,
  contentType: DailyGrindContentType,
  issueDate: string,
  personaSlug: string,
  personaSystemPrompt: string,
): Promise<{
  evaluation: PersonaEvaluation | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const userPrompt = buildPersonaEvaluatePrompt({
    brandId: "castor_abbott",
    edition: "weekday",
    issueDate,
    contentType,
    personaSlug: personaSlug as PersonaEvaluation["personaSlug"],
    factCheckedDraftJson: JSON.stringify(content, null, 2),
  });

  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2000,
    temperature: 0.4,
    system: personaSystemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    return {
      evaluation: null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  }
  try {
    const parsed = JSON.parse(extractJsonObject(block.text)) as PersonaEvaluation;
    return {
      evaluation: parsed,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  } catch {
    return {
      evaluation: null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  }
}

/**
 * Run all 10 persona evaluations in parallel. Failed individual evaluations
 * are filtered out; the score aggregator works on whatever survived.
 * Total cost: ~$0.05-0.10 (10 × Haiku calls).
 */
async function runPersonaPanel(
  client: Anthropic,
  content: DailyGrindContent,
  contentType: DailyGrindContentType,
  issueDate: string,
): Promise<{
  evaluations: PersonaEvaluation[];
  totalInputTokens: number;
  totalOutputTokens: number;
  maxLatencyMs: number;
  failedCount: number;
}> {
  const results = await Promise.all(
    PERSONAS.map((persona) =>
      runPersonaEvaluate(
        client,
        content,
        contentType,
        issueDate,
        persona.slug,
        persona.systemPrompt,
      ).catch((err) => ({
        evaluation: null,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      })),
    ),
  );

  const evaluations: PersonaEvaluation[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let maxLatencyMs = 0;
  let failedCount = 0;

  for (const r of results) {
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
    maxLatencyMs = Math.max(maxLatencyMs, r.latencyMs);
    if (r.evaluation) {
      evaluations.push(r.evaluation);
    } else {
      failedCount++;
    }
  }

  return {
    evaluations,
    totalInputTokens,
    totalOutputTokens,
    maxLatencyMs,
    failedCount,
  };
}

/**
 * Assemble HTML — generates inbox-optimized subject line + preview text.
 * Body HTML rendering itself is deterministic (handled by renderDailyGrindHtml);
 * this block focuses on the inbox-presentation layer only.
 *
 * Uses Haiku (~$0.005). Runs at the end of runWriterPhase so it has access
 * to the final-final content.
 */
async function runAssembleHtml(
  client: Anthropic,
  content: DailyGrindContent,
  contentType: DailyGrindContentType,
  issueDate: string,
  recentSubjectLines: string[],
): Promise<{
  result: AssembleHtmlOutput | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const userPrompt = buildAssembleHtmlPrompt({
    brandId: "castor_abbott",
    edition: "weekday",
    issueDate,
    contentType,
    finalDraftJson: JSON.stringify(content, null, 2),
    recentSubjectLines,
    baselineOpenRate: 0.42, // Solo Operator baseline; representative of segment
  });

  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 800,
    temperature: 0.5,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    return {
      result: null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  }
  try {
    const parsed = JSON.parse(extractJsonObject(block.text)) as AssembleHtmlOutput;
    return {
      result: parsed,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  } catch {
    return {
      result: null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  }
}

/**
 * Issue summary — runs at the very end of generation. Writes a structured
 * AI-readable summary of what the issue covered (topic, cluster, angle,
 * scenes, frameworks, sources, fresh-after window, revisit trigger).
 *
 * The topic_proposer reads these summaries when picking the next issue.
 * This is how the system actually KNOWS what's been done, not just sees
 * recent headlines. Haiku (~$0.005).
 */
async function runIssueSummary(
  client: Anthropic,
  content: DailyGrindContent,
  contentType: DailyGrindContentType,
  issueDate: string,
): Promise<{
  summary: IssueSummary | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const userPrompt = buildIssueSummaryPrompt({
    issueDate,
    contentType,
    finalDraftJson: JSON.stringify(content, null, 2),
  });

  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1500,
    temperature: 0.2,
    messages: [{ role: "user", content: userPrompt }],
  });
  const latencyMs = Date.now() - start;
  const block = response.content[0];
  if (!block || block.type !== "text") {
    return {
      summary: null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  }
  try {
    const parsed = JSON.parse(extractJsonObject(block.text)) as IssueSummary;
    return {
      summary: parsed,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  } catch {
    return {
      summary: null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  }
}

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

1. unspoken_timeline: The Unspoken is a TIMELINE of business events ("then you did X, then you did Y, then you did Z") instead of ONE specific moment with physical action. AI-ish failure mode. Canonical Unspokens drop into ONE moment (a single lunch, a single phone-screening habit, a single conference conversation) and STAY there. They do NOT chronicle a sequence of business changes.

2. unspoken_no_character_action: The Unspoken has no HUMAN DOING something physical. Canonical examples have: ordering the lobster, aggressive eye contact at a charity event, pretending to take a phone call, screening calls, rehearsing the "stay the course" speech. If the only verb in the Unspoken is "you built / you documented / you added / you launched" — that's state-of-affairs writing, not narrative.

3. unspoken_no_quotable_line: No single sentence in the Unspoken would survive being read alone. Canonical examples have: "The dog seems unconvinced about your long-term equity allocation." / "Their contact is still in your CRM tagged 'HOT COI'." / "$187 and exactly zero referrals." A reader should be able to screenshot one line.

4. theme_repetition: same theme word (e.g. "the gap") appears across 3+ sections.

5. closing_repeats_number: Closing restates the same claim as The Number with no new angle.

6. flip_too_long: The Flip Reality is over 25 words OR sounds analytical instead of punchy.

7. no_position: First Pull para 1 is a stat dump with no narrative or argument.

8. uniform_rhythm: all sentences in the same length range (no short punch lines under 8 words).

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

- unspoken_timeline: The Unspoken is a TIMELINE of business events ("then you did X, then Y, then Z") instead of ONE specific moment. REWRITE: pick ONE specific moment from the topic (a single lunch / a single phone call / a single conference bar conversation / a single file-opening scene with WHO ELSE was there) and stay in it. Do NOT chronicle a sequence of business changes. The Unspoken is a SHORT STORY of one scene, not a recap of how the firm got here.

- unspoken_no_character_action: The Unspoken has no HUMAN doing something physical. REWRITE: add a character action. Examples from Mark's canonical: ordering the lobster, aggressive eye contact at a charity event, pretending to take a phone call, screening calls, rehearsing the "stay the course" speech so many times you could do it in your sleep. The verbs should be PHYSICAL not institutional ("you ordered" / "you nodded" / "you avoided" — NOT "you built" / "you documented" / "you added").

- unspoken_no_quotable_line: No single sentence in the Unspoken would survive being read alone. REWRITE: add one line of absurd or comic specificity that could be screenshot and shared. Examples: "(The dog seems unconvinced about your long-term equity allocation.)" / "Their contact is still in your CRM tagged 'HOT COI.'" / "You could've bought a nice watch. At least the watch would tell you something useful."

- hollow_unspoken: Combines the above three — the Unspoken lacks scene, action, and quotable line.

- theme_repetition: Find the theme word/phrase repeated across 3+ sections and rewrite the lower-priority instances with fresh language.

- closing_repeats_number: Rewrite the Main Content closing to land somewhere the Number paragraph didn't already say.

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

const VERSE_SWAP_SYSTEM_PROMPT = `You pick a Bible verse for The Daily Grind, a newsletter for independent financial advisors. The host is Mark at Castor Abbott.

This is **daily standalone wisdom** — the verse does NOT need to relate to the issue's topic. Pick something that teaches general wisdom on living, working, character, integrity, humility, prudence, patience, or counsel. Variety across books is good.

Avoid these AI-default verses: Proverbs 21:5, Proverbs 24:27, Proverbs 16:9, Proverbs 16:3, Proverbs 15:22, Proverbs 22:3.

Pull from a wide range: less-cited Proverbs (3, 11, 14, 18, 20, 25, 27, 29), Matthew (Sermon on the Mount, parables), James, Ecclesiastes, Psalms, Luke. Rotate books across issues.

The application is 2-3 sentences explaining the verse's PLAIN meaning. Do not tie it to a specific advisor tactic or topic. Direct, not preachy. No "as believers" or "trust in His plan."

Return ONLY this JSON, no preamble:
{
  "verse": "the verse text in quotes",
  "reference": "Book Chapter:Verse (Translation)",
  "application": "2-3 sentences explaining the verse's general wisdom"
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
Issue headline (for context only — verse does NOT need to match): ${headline}

BANNED VERSES — DO NOT use any of these (or any verse that's the most-common AI default like Proverbs 21:5):
${banned.map((b) => `- ${b}`).join("\n")}

Pick a different verse for general daily wisdom. Do NOT match the headline's topic.${bookConstraint}`;

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
  proposal?: {
    contentType: string;
    topic: string;
    angle: string;
    frameworkReferences: string[];
  },
): Promise<{
  content: DailyGrindContent;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  panelResult: ScoreAggregateResult | null;
}> {
  // If we have a topic proposal AND structured research, use the spec'd
  // draft_weekday prompt (per-type structure + production rules + canonical
  // few-shot examples + structured research with primaryFindings etc).
  // Otherwise fall back to the legacy buildWriterUserPrompt path.
  const useStructuredDraft = proposal && research.structured;
  const userPrompt = useStructuredDraft
    ? buildDraftWeekdayPrompt({
        issueDate,
        approvedTopic: proposal,
        structuredResearch: research.structured!,
      })
    : buildWriterUserPrompt(
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

  // STAGE: style_pass — spec'd narrow polish (em dash + banned phrases +
  // hedge softening + rhythm). Haiku-based, ~$0.01 per call. Surgical:
  // doesn't rewrite substance, only surface-level violations.
  const styleStart = Date.now();
  try {
    const styled = await runStylePass(client, content, contentType, issueDate);
    content = styled.content;
    totalLatency += Date.now() - styleStart;
    totalInput += styled.inputTokens;
    totalOutput += styled.outputTokens;
    pipeline.push({
      name: "style_pass",
      status: "success",
      latencyMs: Date.now() - styleStart,
      notes: `em-dashes removed: ${styled.emDashesRemoved}, banned phrases: ${styled.bannedPhrasesReplaced.length}, hedges: ${styled.hedgesRemoved}. ${styled.summary}`,
      data: {
        emDashesRemoved: styled.emDashesRemoved,
        bannedPhrasesReplaced: styled.bannedPhrasesReplaced,
        hedgesRemoved: styled.hedgesRemoved,
      },
    });
  } catch (err) {
    pipeline.push({
      name: "style_pass",
      status: "warning",
      latencyMs: Date.now() - styleStart,
      notes: `style_pass failed, shipping unstyled draft: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

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

  // STAGE: editor_pass — spec'd substantive editorial review with revision
  // loop. Sonnet evaluates voice integrity, framework honesty, earned-line
  // presence, strong close, content-type-specific structural beats.
  // Up to 2 iterations before forced approve_with_concerns.
  const MAX_EDITOR_ITERATIONS = 2;
  let editorFinalVerdict: string = "no_verdict";
  let editorIterationsUsed = 0;
  for (let iter = 1; iter <= MAX_EDITOR_ITERATIONS; iter++) {
    editorIterationsUsed = iter;
    const editorStart = Date.now();
    try {
      const editor = await runEditorPass(
        client,
        content,
        contentType,
        issueDate,
        iter,
        MAX_EDITOR_ITERATIONS,
      );
      totalLatency += editor.latencyMs;
      totalInput += editor.inputTokens;
      totalOutput += editor.outputTokens;

      if (editor.verdict === "approve" || editor.verdict === "approve_with_concerns") {
        // Use the approved draft if the editor provided one (lightly polished),
        // otherwise keep current content.
        if (editor.approvedDraft) {
          content = deepStripDashes(editor.approvedDraft);
        }
        pipeline.push({
          name: "editor_pass",
          status: editor.verdict === "approve" ? "success" : "warning",
          latencyMs: Date.now() - editorStart,
          notes: `iter ${iter}/${MAX_EDITOR_ITERATIONS} verdict=${editor.verdict}: ${editor.summary}${editor.specificFlags.length > 0 ? ` (${editor.specificFlags.length} flags)` : ""}`,
          data: { verdict: editor.verdict, flagCount: editor.specificFlags.length },
        });
        editorFinalVerdict = editor.verdict;
        break;
      }

      // Revision needed — re-run writer with editor feedback
      const revisionRequest =
        editor.verdict === "revise"
          ? editor.revisionRequest ?? ""
          : `Rewrite the ${editor.rewriteSection ?? "flagged"} section. Instructions: ${editor.rewriteInstructions ?? ""}`;

      if (!revisionRequest) {
        pipeline.push({
          name: "editor_pass",
          status: "warning",
          latencyMs: Date.now() - editorStart,
          notes: `iter ${iter} verdict=${editor.verdict} but no revision text; shipping as-is`,
        });
        break;
      }

      pipeline.push({
        name: "editor_pass",
        status: "retried",
        latencyMs: Date.now() - editorStart,
        notes: `iter ${iter}/${MAX_EDITOR_ITERATIONS} verdict=${editor.verdict}: ${editor.summary}. Running revision.`,
      });

      const revStart = Date.now();
      const revised = await runEditorRevision(
        client,
        content,
        revisionRequest,
        editor.specificFlags,
      );
      totalLatency += revised.latencyMs;
      totalInput += revised.inputTokens;
      totalOutput += revised.outputTokens;

      if (revised.content) {
        content = revised.content;
        editorFinalVerdict = `${editor.verdict}_revised_iter${iter}`;
        pipeline.push({
          name: "editor_revision",
          status: "retried",
          latencyMs: Date.now() - revStart,
          notes: `applied editor's revision instructions`,
        });
      } else {
        pipeline.push({
          name: "editor_revision",
          status: "warning",
          latencyMs: Date.now() - revStart,
          notes: `revision call failed to parse, keeping current draft`,
        });
        break;
      }
    } catch (err) {
      pipeline.push({
        name: "editor_pass",
        status: "warning",
        latencyMs: Date.now() - editorStart,
        notes: `editor_pass error: ${err instanceof Error ? err.message : String(err)}`,
      });
      editorFinalVerdict = `error_iter${iter}`;
      break;
    }
  }
  // ─── editor_gate ──────────────────────────────────────────────────────────
  // Explicit decision record: did the editor loop terminate by approval, by
  // exhausting iterations, or by error?
  {
    const exhausted = editorIterationsUsed >= MAX_EDITOR_ITERATIONS && !editorFinalVerdict.startsWith("approve");
    const passed = editorFinalVerdict === "approve";
    const gateStatus: PipelineStageRecord["status"] = passed
      ? "success"
      : exhausted
        ? "warning"
        : "warning";
    pipeline.push({
      name: "editor_gate",
      status: gateStatus,
      notes: passed
        ? `editor approved on iter ${editorIterationsUsed}`
        : exhausted
          ? `exhausted ${MAX_EDITOR_ITERATIONS} editor iterations without clean approve (final: ${editorFinalVerdict}); shipping anyway`
          : `editor loop ended early (final: ${editorFinalVerdict})`,
      input: {
        maxIterations: MAX_EDITOR_ITERATIONS,
        iterationsUsed: editorIterationsUsed,
      },
      output: {
        finalVerdict: editorFinalVerdict,
        decision: passed ? "proceed" : "proceed_with_warning",
        reason: passed
          ? "clean approval"
          : exhausted
            ? "iterations exhausted, accepting current draft"
            : "loop ended without approval",
      },
    });
  }

  // STAGE: fact_check — verify every factual claim against original research.
  // Catches stat mismatches, cross-contamination, unsourced claims,
  // anonymization failures. Three verdicts:
  //  - pass: ship as-is
  //  - fix_required: use the fixedDraft auto-correction
  //  - reject: ship with warning (we don't loop back to writer; ship with flag)
  const factCheckStart = Date.now();
  try {
    const factResult = await runFactCheck(client, content, research, issueDate);
    totalLatency += factResult.latencyMs;
    totalInput += factResult.inputTokens;
    totalOutput += factResult.outputTokens;

    if (factResult.verdict === "fix_required" && factResult.fixedDraft) {
      content = deepStripDashes(factResult.fixedDraft);
      pipeline.push({
        name: "fact_check",
        status: "retried",
        latencyMs: Date.now() - factCheckStart,
        notes: `verdict=fix_required, ${factResult.issues.length} issue(s) auto-corrected. ${factResult.summary}`,
        data: { verdict: factResult.verdict, issueCount: factResult.issues.length },
      });
    } else if (factResult.verdict === "reject") {
      pipeline.push({
        name: "fact_check",
        status: "warning",
        latencyMs: Date.now() - factCheckStart,
        notes: `verdict=reject (${factResult.issues.length} high-severity issues), shipping with warning. ${factResult.summary}`,
        data: { verdict: factResult.verdict, issueCount: factResult.issues.length, issues: factResult.issues },
      });
    } else {
      pipeline.push({
        name: "fact_check",
        status: "success",
        latencyMs: Date.now() - factCheckStart,
        notes: `verdict=pass, ${factResult.verifiedClaims} claims verified. ${factResult.summary}`,
        data: { verdict: factResult.verdict, verifiedClaims: factResult.verifiedClaims },
      });
    }
  } catch (err) {
    pipeline.push({
      name: "fact_check",
      status: "warning",
      latencyMs: Date.now() - factCheckStart,
      notes: `fact_check failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // STAGE: persona_panel — 10 calibrated audience personas read the issue in
  // parallel. Each produces open/read/click/reply/forward/unsubscribe
  // probabilities + love rating + voice fit + flags + persona-voice reaction.
  // ~$0.05-0.10 total (10 Haiku calls). Score aggregator computes pass/fail.
  //
  // GATING: if verdict=fail and we have revision budget, run a persona-driven
  // editor_revision pass that addresses specific complaints, then re-run the
  // panel ONCE to confirm. Max 1 revision (cost-bounded).
  let panelResult: ScoreAggregateResult | null = null;
  let panelEvaluations: Awaited<ReturnType<typeof runPersonaPanel>>["evaluations"] = [];
  const panelStart = Date.now();
  try {
    const panel = await runPersonaPanel(client, content, contentType, issueDate);
    totalLatency += panel.maxLatencyMs;
    totalInput += panel.totalInputTokens;
    totalOutput += panel.totalOutputTokens;
    panelEvaluations = panel.evaluations;

    if (panel.evaluations.length === 0) {
      pipeline.push({
        name: "persona_panel",
        status: "failed",
        latencyMs: Date.now() - panelStart,
        notes: `all 10 persona evaluations failed`,
      });
    } else {
      panelResult = scoreAggregate(panel.evaluations, contentType);
      pipeline.push({
        name: "persona_panel",
        status: panel.failedCount === 0 ? "success" : "warning",
        latencyMs: Date.now() - panelStart,
        notes: `${panel.evaluations.length}/10 personas evaluated (${panel.failedCount} failed). ${panelResult.summary}`,
        data: {
          evaluations: panel.evaluations.length,
          failed: panel.failedCount,
          loveRate: panelResult.metrics.loveRate,
          shareRate: panelResult.metrics.shareRate,
          weightedUnsubscribeProb: panelResult.metrics.weightedUnsubscribeProb,
          voiceFitAvg: panelResult.metrics.voiceFitAvg,
        },
      });

      pipeline.push({
        name: "score_aggregate",
        status: panelResult.verdict === "pass" ? "success" : "warning",
        notes: `verdict=${panelResult.verdict}. ${panelResult.hardStops.length > 0 ? `Hard stops: ${panelResult.hardStops.join("; ")}` : "no hard stops"}`,
        data: {
          verdict: panelResult.verdict,
          metrics: panelResult.metrics,
          benchmarks: panelResult.benchmarks,
          benchmarkResults: panelResult.benchmarkResults,
          hardStops: panelResult.hardStops,
          perPersona: panelResult.perPersonaSummary,
        },
      });
    }
  } catch (err) {
    pipeline.push({
      name: "persona_panel",
      status: "warning",
      latencyMs: Date.now() - panelStart,
      notes: `persona_panel error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ─── persona_gate ────────────────────────────────────────────────────────
  // Per spec `04_content_pipeline.spec.md:708`: `while (!qualityResult.passed
  // && revisionCycle < 3)`. The spec's "passed" is binary — ALL benchmarks
  // met, no hard stops. Anything else triggers the revision loop, regardless
  // of whether it's pass_with_concerns (1 miss) or fail (2+ misses).
  if (panelResult && panelEvaluations.length > 0) {
    const verdict = panelResult.verdict;
    if (verdict === "pass") {
      pipeline.push({
        name: "persona_gate",
        status: "success",
        notes: `verdict=pass → shipping as-is`,
        input: { verdict, metrics: panelResult.metrics, benchmarks: panelResult.benchmarks },
        output: { decision: "proceed", reason: "all benchmarks met" },
      });
    } else if (panelResult.hardStops.length > 0) {
      // Hard stops mean catastrophic — skip revision, ship with warning so
      // we can debug the persona behaviour rather than mask it.
      pipeline.push({
        name: "persona_gate",
        status: "warning",
        notes: `verdict=fail with hard stops → shipping with warning (no revision will help)`,
        input: { verdict, hardStops: panelResult.hardStops },
        output: {
          decision: "proceed_with_warning",
          reason: `hard stops present: ${panelResult.hardStops.join("; ")}`,
        },
      });
    } else {
      // verdict is pass_with_concerns OR fail with no hard stops → run the
      // spec'd quality-gate revision loop, up to 3 cycles per
      // `04_content_pipeline.spec.md:708`. Each cycle:
      //   1. Build revision recommendations from current panel feedback
      //   2. Apply persona-driven revision
      //   3. Re-run persona panel
      //   4. If pass, exit; otherwise loop.
      const MAX_REVISION_CYCLES = 3;
      pipeline.push({
        name: "persona_gate",
        status: "retried",
        notes: `verdict=fail (no hard stops) → entering revision loop (up to ${MAX_REVISION_CYCLES} cycles per spec)`,
        input: { verdict, metrics: panelResult.metrics, benchmarks: panelResult.benchmarks },
        output: {
          decision: "revise_with_loop",
          reason: `soft fail — multiple benchmarks missed; running up to ${MAX_REVISION_CYCLES} revision cycles`,
          initialMetrics: panelResult.metrics,
        },
      });

      let revisionCycle = 0;
      let lastMetrics = panelResult.metrics;
      while (panelResult.verdict !== "pass" && revisionCycle < MAX_REVISION_CYCLES) {
        revisionCycle++;
        const cycleStart = Date.now();
        const promptBuild = buildPersonaRevisionPrompt(panelEvaluations, panelResult);
        // Augment the revision request with the spec's structured
        // revision_recommendations field (built from benchmarks + flags +
        // low-love reactions). This is what the spec passes to the editor
        // block on each revision cycle.
        const combinedRevisionRequest = `${promptBuild.revisionRequest}

## Structured revision_recommendations (from score_aggregator, per spec)

${panelResult.revisionRecommendations.map((r) => `- ${r}`).join("\n")}

## Common flags (CONSIDER priority — address this cycle)

${panelResult.commonFlags
  .filter((f) => f.priority === "CONSIDER")
  .map((f) => `- "${f.trigger}" (raised by ${f.personas.length} personas: ${f.personas.join(", ")})`)
  .join("\n") || "(none)"}`;

        let revisedOk = false;
        try {
          const revised = await runPersonaRevision(client, content, combinedRevisionRequest);
          totalLatency += revised.latencyMs;
          totalInput += revised.inputTokens;
          totalOutput += revised.outputTokens;
          if (revised.content) {
            content = revised.content;
            revisedOk = true;
            pipeline.push({
              name: `persona_revision_cycle${revisionCycle}`,
              status: "retried",
              latencyMs: Date.now() - cycleStart,
              notes: `cycle ${revisionCycle}/${MAX_REVISION_CYCLES}: applied persona-driven revision (${promptBuild.prioritizedFixes.length} fixes + ${panelResult.revisionRecommendations.length} structured recs)`,
              input: {
                cycle: revisionCycle,
                prioritizedFixes: promptBuild.prioritizedFixes,
                revisionRecommendations: panelResult.revisionRecommendations,
                considerFlags: panelResult.commonFlags
                  .filter((f) => f.priority === "CONSIDER")
                  .map((f) => f.trigger),
              },
              output: { reviseStatus: "applied" },
            });
          } else {
            pipeline.push({
              name: `persona_revision_cycle${revisionCycle}`,
              status: "warning",
              latencyMs: Date.now() - cycleStart,
              notes: `cycle ${revisionCycle}: revision call failed to parse; keeping prior draft and exiting loop`,
            });
            break;
          }
        } catch (err) {
          pipeline.push({
            name: `persona_revision_cycle${revisionCycle}`,
            status: "warning",
            latencyMs: Date.now() - cycleStart,
            notes: `cycle ${revisionCycle} revision error: ${err instanceof Error ? err.message : String(err)} — exiting loop`,
          });
          break;
        }

        if (!revisedOk) break;

        // Re-run persona panel after this cycle's revision
        const recheckStart = Date.now();
        try {
          const recheck = await runPersonaPanel(client, content, contentType, issueDate);
          totalLatency += recheck.maxLatencyMs;
          totalInput += recheck.totalInputTokens;
          totalOutput += recheck.totalOutputTokens;
          if (recheck.evaluations.length > 0) {
            const recheckResult = scoreAggregate(recheck.evaluations, contentType);
            const deltaLove = recheckResult.metrics.loveRate - lastMetrics.loveRate;
            const deltaShare = recheckResult.metrics.shareRate - lastMetrics.shareRate;
            panelEvaluations = recheck.evaluations;
            panelResult = recheckResult;
            lastMetrics = recheckResult.metrics;
            pipeline.push({
              name: `persona_panel_cycle${revisionCycle}`,
              status:
                recheckResult.verdict === "pass"
                  ? "success"
                  : recheckResult.verdict === "pass_with_concerns"
                    ? "warning"
                    : "warning",
              latencyMs: Date.now() - recheckStart,
              notes: `cycle ${revisionCycle}/${MAX_REVISION_CYCLES} post-revision verdict=${recheckResult.verdict}. ${recheckResult.summary}`,
              input: { cycle: revisionCycle },
              output: {
                verdict: recheckResult.verdict,
                metrics: recheckResult.metrics,
                deltaLoveRate: deltaLove,
                deltaShareRate: deltaShare,
                improved: recheckResult.metrics.loveRate > lastMetrics.loveRate || recheckResult.verdict === "pass",
              },
            });
          } else {
            pipeline.push({
              name: `persona_panel_cycle${revisionCycle}`,
              status: "warning",
              latencyMs: Date.now() - recheckStart,
              notes: `cycle ${revisionCycle}: recheck produced zero evaluations — exiting loop`,
            });
            break;
          }
        } catch (err) {
          pipeline.push({
            name: `persona_panel_cycle${revisionCycle}`,
            status: "warning",
            latencyMs: Date.now() - recheckStart,
            notes: `cycle ${revisionCycle} recheck failed: ${err instanceof Error ? err.message : String(err)} — exiting loop`,
          });
          break;
        }
      }

      // Loop terminated — log final cycle outcome
      pipeline.push({
        name: "persona_revision_loop_end",
        status: panelResult.verdict === "pass" ? "success" : "warning",
        notes:
          panelResult.verdict === "pass"
            ? `revision loop converged on cycle ${revisionCycle}/${MAX_REVISION_CYCLES} (verdict=pass)`
            : revisionCycle >= MAX_REVISION_CYCLES
              ? `exhausted ${MAX_REVISION_CYCLES} revision cycles, final verdict=${panelResult.verdict} (will mark pending_review_with_warnings per spec)`
              : `loop exited early on cycle ${revisionCycle} due to revision/recheck error`,
        input: { maxCycles: MAX_REVISION_CYCLES, cyclesUsed: revisionCycle },
        output: {
          finalVerdict: panelResult.verdict,
          finalMetrics: panelResult.metrics,
        },
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

  return {
    content,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    latencyMs: totalLatency,
    panelResult,
  };
}

// ─── Public ─────────────────────────────────────────────────────────────────

export async function generateDailyGrindIssue(opts: {
  issueDate: string;
  recentTopics?: string[];
  recentVerses?: string[];
  recentConcepts?: string[];
  recentIssueSummaries?: Array<{
    publishedAt: string;
    contentType: string;
    topic: string;
    cluster?: string;
    mainAngle?: string;
    keyTakes?: string[];
    scenesUsed?: string;
    frameworksApplied?: string[];
    freshAfter?: string;
  }>;
  topicHint?: string;
  apiKey?: string;
}): Promise<DailyGrindIssue> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey });
  const recentTopics = opts.recentTopics ?? [];
  const recentVerses = opts.recentVerses ?? [];
  const recentConcepts = opts.recentConcepts ?? [];
  const recentIssueSummaries = opts.recentIssueSummaries ?? [];
  const pipeline: PipelineStageRecord[] = [];

  // STAGE: topic_proposer — picks contentType + topic + angle + framework
  // BEFORE research. Replaces the old after-research pickContentType.
  // Uses the spec'd prompt from apps/pipeline/.../topic_proposer.ts.
  // Day-of-week affinity is built into the prompt: Mon=Tactic, Tue=Take,
  // Wed=Tactic, Thu=Story/Special, Fri=Tactic+Digital Grind.
  const proposerStart = Date.now();
  let proposal: Awaited<ReturnType<typeof runTopicProposer>> | null = null;
  const proposerInput = {
    recentHeadlines: recentTopics.slice(0, 10),
    recentIssueSummariesCount: recentIssueSummaries.length,
    recentClusters: recentIssueSummaries
      .map((s) => s.cluster)
      .filter((c): c is string => typeof c === "string")
      .slice(0, 10),
    blockedConceptsCount: recentConcepts.length,
    explicitTopicHint: opts.topicHint ?? null,
  };
  try {
    proposal = await runTopicProposer(
      client,
      opts.issueDate,
      recentTopics,
      recentConcepts,
      recentIssueSummaries,
    );
    pipeline.push({
      name: "topic_proposer",
      status: "success",
      latencyMs: Date.now() - proposerStart,
      notes: `${proposal.contentType.toUpperCase()}: ${proposal.topic}. Angle: ${proposal.angle}`,
      input: proposerInput,
      output: {
        contentType: proposal.contentType,
        topic: proposal.topic,
        angle: proposal.angle,
        frameworkReferences: proposal.frameworkReferences,
        rationale: proposal.rationale,
      },
      data: {
        contentType: proposal.contentType,
        topic: proposal.topic,
        angle: proposal.angle,
        frameworkReferences: proposal.frameworkReferences,
        rationale: proposal.rationale,
      },
    });
  } catch (err) {
    pipeline.push({
      name: "topic_proposer",
      status: "warning",
      latencyMs: Date.now() - proposerStart,
      notes: `proposer failed: ${err instanceof Error ? err.message : String(err)}`,
      input: proposerInput,
    });
  }

  // Use the proposer's topic + angle as research bias. Pass as topicHint
  // so research goes looking for content supporting THIS angle instead
  // of generic news.
  const researchTopicHint = proposal
    ? `${proposal.topic} — angle: ${proposal.angle}`
    : opts.topicHint;
  const lockedContentType: DailyGrindContentType = proposal?.contentType ?? "take";

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
    if (researchTopicHint) gemOpts.topicHint = researchTopicHint;
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
        research = proposal
          ? await runStructuredResearchWeekday(
              client,
              opts.issueDate,
              proposal,
              recentTopics,
            )
          : await runResearchPhase(
              client,
              opts.issueDate,
              recentTopics,
              recentConcepts,
              researchTopicHint,
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
    if (researchTopicHint) perpOpts.topicHint = researchTopicHint;
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
    // Primary: Anthropic web_search. When we have a topic_proposer proposal,
    // use the spec'd structured research_weekday block which produces
    // primaryFindings + frameworkAlignments + scriptsOrLanguage + worth-knowing
    // + proverb candidates. Otherwise fall back to the legacy flat research.
    const transientHints = [
      "no JSON object",
      "web_search",
      "invalid webhook json",
      "technical limitation",
      "items array is empty",
      "items must be at least",
      "worthKnowingItems",
    ];
    // ITEM FLOOR: the writer struggles when given <5 items; Worth Knowing
    // needs 3 distinct items and primaryFindings should have several
    // claims. If a first research pass returns thin (<5), run a SECOND
    // research call with broader query hints — feeding back the topics
    // the first pass missed.
    const RESEARCH_ITEM_FLOOR = 5;
    let lastErr: unknown = null;
    let thinAttemptCount = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        research = proposal
          ? await runStructuredResearchWeekday(
              client,
              opts.issueDate,
              proposal,
              recentTopics,
              attempt > 1, // expandQueries on retry
            )
          : await runResearchPhase(
              client,
              opts.issueDate,
              recentTopics,
              recentConcepts,
              researchTopicHint,
            );
        // Item-count gate: if research is thin, retry with broader queries.
        const itemCount = research.bundle.items.length;
        if (itemCount >= RESEARCH_ITEM_FLOOR) break;
        thinAttemptCount = attempt;
        console.warn(
          `[daily-grind][research] attempt ${attempt} returned ${itemCount} items, below floor ${RESEARCH_ITEM_FLOOR}. ${attempt < 3 ? "Retrying with broader queries." : "Shipping with thin research; downstream stages will flag."}`,
        );
        if (attempt === 3) break; // exhausted; let downstream gate flag it
        await new Promise((r) => setTimeout(r, 3000));
      } catch (err) {
        lastErr = err;
        const message = err instanceof Error ? err.message : String(err);
        const transient = transientHints.some((h) => message.includes(h));
        if (!transient || attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 6000));
      }
    }
    if (!research) {
      throw lastErr instanceof Error ? lastErr : new Error("research: no result after retries");
    }
    // Expose retry count for the trace below.
    (research as ResearchResult & { thinRetries?: number }).thinRetries = thinAttemptCount;
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
    const thinRetries =
      (research as ResearchResult & { thinRetries?: number }).thinRetries ?? 0;
    pipeline.push({
      name: "research",
      status: "success",
      latencyMs: research.latencyMs,
      notes: `backend=${backend}, items=${research.bundle.items.length}, distinctSources=${distinctSources.size}${thinRetries > 0 ? `, thinRetries=${thinRetries}` : ""}`,
      input: {
        backend,
        topicHint: researchTopicHint ?? null,
        proposerContentType: proposal?.contentType ?? null,
        proposerTopic: proposal?.topic ?? null,
      },
      output: {
        itemCount: research.bundle.items.length,
        distinctSources: distinctSources.size,
        sources: Array.from(distinctSources),
        itemHeadlines: research.bundle.items.slice(0, 10).map((r) => r.title),
        thinRetries,
      },
      data: {
        backend,
        itemCount: research.bundle.items.length,
        distinctSources: distinctSources.size,
        sources: Array.from(distinctSources),
      },
    });
    // ─── research_quality_gate ─────────────────────────────────────────────
    // Make the floor decision EXPLICIT in the trace. If items >= 5 and
    // distinct sources >= 3, gate passes. Otherwise it's a warning the
    // writer (and the human reading the trace) can see.
    {
      const itemCount = research.bundle.items.length;
      const RESEARCH_ITEM_FLOOR = 5;
      const SOURCE_FLOOR = 3;
      const passed = itemCount >= RESEARCH_ITEM_FLOOR && distinctSources.size >= SOURCE_FLOOR;
      const reasons: string[] = [];
      if (itemCount < RESEARCH_ITEM_FLOOR) {
        reasons.push(`itemCount=${itemCount} < floor=${RESEARCH_ITEM_FLOOR}`);
      }
      if (distinctSources.size < SOURCE_FLOOR) {
        reasons.push(`distinctSources=${distinctSources.size} < floor=${SOURCE_FLOOR}`);
      }
      pipeline.push({
        name: "research_quality_gate",
        status: passed ? "success" : "warning",
        notes: passed
          ? `passed: items=${itemCount}≥${RESEARCH_ITEM_FLOOR}, distinctSources=${distinctSources.size}≥${SOURCE_FLOOR}${thinRetries > 0 ? ` (after ${thinRetries} thin retries)` : ""}`
          : `BELOW FLOOR: ${reasons.join("; ")}. Writer will produce thinner Worth Knowing. ${thinRetries >= 3 ? "Exhausted retries." : "(Retries already attempted: " + thinRetries + ")"}`,
        input: {
          itemCount,
          distinctSources: distinctSources.size,
          itemFloor: RESEARCH_ITEM_FLOOR,
          sourceFloor: SOURCE_FLOOR,
          thinRetries,
        },
        output: {
          gateVerdict: passed ? "pass" : "warning_below_floor",
          decision: passed ? "proceed_to_writer" : "proceed_to_writer_with_warning",
          reasons,
        },
      });
    }
  }
  // Content type was locked by the topic_proposer (Stage 1) BEFORE research.
  // No second picker call needed — research was guided by the proposed topic,
  // and the writer phase below uses lockedContentType to load the correct
  // voice module.
  const contentTypePickerCost = { input: 0, output: 0, latency: 0 };

  const writerStart = Date.now();
  const writer = await runWriterPhase(
    client,
    opts.issueDate,
    research.bundle,
    recentTopics,
    recentVerses,
    recentConcepts,
    lockedContentType,
    pipeline,
    proposal ?? undefined,
  );
  pipeline.push({
    name: "writer",
    status: "success",
    latencyMs: Date.now() - writerStart,
    notes: `headline="${writer.content.headline}", contentType=${lockedContentType}`,
    input: {
      lockedContentType,
      proposerTopic: proposal?.topic ?? null,
      proposerAngle: proposal?.angle ?? null,
      researchItemCount: research.bundle.items.length,
      researchSources: Array.from(new Set(research.bundle.items.map((r) => r.source))),
    },
    output: {
      headline: writer.content.headline,
      preheader: writer.content.preheader,
      contentType: lockedContentType,
      worthKnowingCount: writer.content.worthKnowing?.length ?? 0,
      hasMainContent: Boolean(writer.content.mainContent?.intro),
    },
    data: {
      inputTokens: writer.inputTokens,
      outputTokens: writer.outputTokens,
    },
  });

  // STAGE: voice review + conditional sharpen rewrite
  // CONDITIONAL: skip when persona_panel passed cleanly. The voice review +
  // sharpen pair was the original safety net before editor_pass and
  // persona_panel were wired. Now those are doing the substantive review +
  // audience evaluation. Skip voice_review/sharpen when persona_panel
  // verdict is "pass" to save 25-55s and avoid hitting the 300s function
  // timeout. Still runs when persona_panel had concerns or wasn't able to
  // produce a verdict.
  let finalContent = writer.content;
  let voiceReviewCost = { input: 0, output: 0, latency: 0 };
  let sharpenCost = { input: 0, output: 0, latency: 0 };
  const personaPassed = writer.panelResult?.verdict === "pass";
  if (personaPassed) {
    pipeline.push({
      name: "voice_review",
      status: "skipped",
      notes: `persona_panel verdict=pass — skipping voice review/sharpen to save budget`,
    });
  } else try {
    // Iterative voice review + sharpen. Up to 2 sharpen iterations. After
    // each sharpen, we re-run voice_review to see if the defects were
    // actually addressed. Sharpen only fires when there are concrete
    // defects to address.
    const MAX_SHARPEN_ITERATIONS = 2;
    let lastDefects: string[] = [];
    let lastScore = 0;
    for (let iter = 1; iter <= MAX_SHARPEN_ITERATIONS + 1; iter++) {
      const reviewStart = Date.now();
      const review = await voiceReview(client, finalContent);
      voiceReviewCost = {
        input: voiceReviewCost.input + review.inputTokens,
        output: voiceReviewCost.output + review.outputTokens,
        latency: voiceReviewCost.latency + review.latencyMs,
      };
      const reviewLabel = iter === 1 ? "voice_review" : `voice_review_iter${iter}`;
      pipeline.push({
        name: reviewLabel,
        status: review.passed ? "success" : "warning",
        latencyMs: Date.now() - reviewStart,
        notes: `score=${review.score}/10, defects=[${review.defects.join(", ") || "none"}]`,
        input: { iteration: iter, defectsBeforeSharpen: lastDefects },
        output: {
          passed: review.passed,
          score: review.score,
          defects: review.defects,
          delta: iter > 1 ? { scoreImprovement: review.score - lastScore, defectsResolved: lastDefects.filter((d) => !review.defects.includes(d)) } : null,
        },
      });
      lastDefects = review.defects;
      lastScore = review.score;
      if (review.passed) {
        pipeline.push({
          name: "voice_gate",
          status: "success",
          notes: `voice clean after ${iter - 1} sharpen iteration(s) (score=${review.score}/10)`,
          input: { passed: true, score: review.score },
          output: { decision: "proceed", reason: "voice review passed" },
        });
        break;
      }
      if (review.defects.length === 0) {
        pipeline.push({
          name: "voice_gate",
          status: "warning",
          notes: `voice_review failed but reported no defects — can't sharpen without a target, shipping as-is`,
          input: { passed: false, score: review.score, defects: [] },
          output: { decision: "proceed_with_warning", reason: "no defects to target" },
        });
        break;
      }
      if (iter > MAX_SHARPEN_ITERATIONS) {
        pipeline.push({
          name: "voice_gate",
          status: "warning",
          notes: `exhausted ${MAX_SHARPEN_ITERATIONS} sharpen iterations; ${review.defects.length} defects remain: ${review.defects.join(", ")}`,
          input: { passed: false, score: review.score, defects: review.defects },
          output: {
            decision: "proceed_with_warning",
            reason: `${MAX_SHARPEN_ITERATIONS} sharpen iterations did not clear defects`,
            remainingDefects: review.defects,
          },
        });
        break;
      }
      // Surgical first: section-specific defects (unspoken_*, closing_*, flip_*)
      // get a targeted rewrite that REPLACES the broken section rather than
      // sending the whole JSON for a general edit. Cheap (Haiku) and more
      // reliable because the model isn't preserving the broken text.
      const sharpenStart = Date.now();
      const sectionDefects = review.defects.filter((d) =>
        [
          "unspoken_timeline",
          "unspoken_no_character_action",
          "unspoken_no_quotable_line",
          "hollow_unspoken",
          "closing_repeats_number",
          "flip_too_long",
        ].includes(d),
      );
      let surgicalReport: { sectionsRewritten: string[]; failures: string[] } = {
        sectionsRewritten: [],
        failures: [],
      };
      if (sectionDefects.length > 0) {
        const surgical = await applySurgicalRewrites(client, finalContent, sectionDefects, {
          topic: proposal?.topic ?? finalContent.headline,
        });
        sharpenCost = {
          input: sharpenCost.input + surgical.totalInputTokens,
          output: sharpenCost.output + surgical.totalOutputTokens,
          latency: sharpenCost.latency + surgical.totalLatencyMs,
        };
        if (surgical.sectionsRewritten.length > 0) {
          finalContent = surgical.content;
        }
        surgicalReport = {
          sectionsRewritten: surgical.sectionsRewritten,
          failures: surgical.failures,
        };
        pipeline.push({
          name: `surgical_rewrite_iter${iter}`,
          status: surgical.sectionsRewritten.length > 0 ? "retried" : "warning",
          latencyMs: surgical.totalLatencyMs,
          notes:
            surgical.sectionsRewritten.length > 0
              ? `iter ${iter}: surgically rewrote ${surgical.sectionsRewritten.join(", ")} for defects: ${sectionDefects.join(", ")}${surgical.failures.length > 0 ? ` (failures: ${surgical.failures.join("; ")})` : ""}`
              : `iter ${iter}: surgical rewrite attempted ${sectionDefects.length} sections but none succeeded: ${surgical.failures.join("; ")}`,
          input: { iteration: iter, targetSectionDefects: sectionDefects },
          output: {
            sectionsRewritten: surgical.sectionsRewritten,
            failures: surgical.failures,
          },
        });
      }
      // General sharpen handles any remaining defects (theme_repetition,
      // no_position, uniform_rhythm) AND polishes the whole draft against
      // the freshly-rewritten sections.
      const generalDefects = review.defects.filter((d) => !sectionDefects.includes(d));
      const sharpened = await voiceSharpenRewrite(
        client,
        finalContent,
        generalDefects.length > 0 ? generalDefects : review.defects,
      );
      sharpenCost = {
        input: sharpenCost.input + sharpened.inputTokens,
        output: sharpenCost.output + sharpened.outputTokens,
        latency: sharpenCost.latency + sharpened.latencyMs,
      };
      if (sharpened.content) {
        finalContent = sharpened.content;
        pipeline.push({
          name: `voice_sharpen_iter${iter}`,
          status: "retried",
          latencyMs: Date.now() - sharpenStart,
          notes: `iter ${iter}/${MAX_SHARPEN_ITERATIONS}: addressing ${review.defects.length} defects: ${review.defects.join(", ")}${surgicalReport.sectionsRewritten.length > 0 ? ` (after surgical of ${surgicalReport.sectionsRewritten.join(", ")})` : ""}`,
          input: { iteration: iter, targetDefects: review.defects, surgicalSectionsRewritten: surgicalReport.sectionsRewritten },
          output: { reviseStatus: "applied" },
        });
      } else {
        pipeline.push({
          name: `voice_sharpen_iter${iter}`,
          status: "warning",
          latencyMs: Date.now() - sharpenStart,
          notes: `sharpen iter ${iter} parse failed, breaking loop, shipping with ${review.defects.length} unresolved defects`,
        });
        pipeline.push({
          name: "voice_gate",
          status: "warning",
          notes: `voice sharpen parse failure on iter ${iter}; shipping draft with unresolved defects`,
          input: { passed: false, defects: review.defects },
          output: {
            decision: "proceed_with_warning",
            reason: "sharpen failed to produce parseable output",
            remainingDefects: review.defects,
          },
        });
        break;
      }
    }
  } catch (err) {
    pipeline.push({
      name: "voice_review",
      status: "warning",
      notes: `review skipped due to error: ${err instanceof Error ? err.message : String(err)}`,
    });
    pipeline.push({
      name: "voice_gate",
      status: "warning",
      notes: `voice review threw — no gate decision possible, shipping draft unchanged`,
      output: { decision: "proceed_with_warning", reason: `voice_review threw: ${err instanceof Error ? err.message : String(err)}` },
    });
  }

  // STAGE: assemble_html — final spec'd block. Generates inbox-optimized
  // subject line (35-65 chars) + preview text (60-110 chars). Currently
  // the writer produces headline + preheader directly; this stage replaces
  // them with versions tuned for inbox open rates.
  const assembleStart = Date.now();
  let assembleCost = { input: 0, output: 0, latency: 0 };
  try {
    const assembleResult = await runAssembleHtml(
      client,
      finalContent,
      lockedContentType,
      opts.issueDate,
      recentTopics, // recentTopics = recent headlines = recent subject lines, equivalent for this purpose
    );
    assembleCost = {
      input: assembleResult.inputTokens,
      output: assembleResult.outputTokens,
      latency: assembleResult.latencyMs,
    };
    if (assembleResult.result) {
      const { subjectLine, previewText, characterCounts } = assembleResult.result;
      const writerHeadline = finalContent.headline;
      // Override headline + preheader with the optimized inbox versions.
      // The H1 in the body uses the same field, so this aligns the body H1
      // with the inbox subject for consistency.
      finalContent = {
        ...finalContent,
        headline: subjectLine,
        preheader: previewText,
      };
      pipeline.push({
        name: "assemble_html",
        status: "success",
        latencyMs: Date.now() - assembleStart,
        notes: `subject (${characterCounts?.subjectLineChars ?? subjectLine.length} chars): "${subjectLine}". preview (${characterCounts?.previewTextChars ?? previewText.length} chars).`,
        input: {
          writerHeadline,
          recentSubjectLineCount: recentTopics.length,
        },
        output: {
          subjectLine,
          previewText,
          subjectLineChars: characterCounts?.subjectLineChars ?? subjectLine.length,
          previewTextChars: characterCounts?.previewTextChars ?? previewText.length,
        },
        data: {
          subjectLine,
          previewText,
          subjectLineChars: characterCounts?.subjectLineChars ?? subjectLine.length,
          previewTextChars: characterCounts?.previewTextChars ?? previewText.length,
        },
      });
    } else {
      pipeline.push({
        name: "assemble_html",
        status: "warning",
        latencyMs: Date.now() - assembleStart,
        notes: `assemble_html parse failed, shipping writer's original headline + preheader`,
      });
    }
  } catch (err) {
    pipeline.push({
      name: "assemble_html",
      status: "warning",
      latencyMs: Date.now() - assembleStart,
      notes: `assemble_html error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // STAGE: issue_summary — write AI-readable record of what this issue did,
  // for future topic_proposer calls to read. This is the "brain reads its
  // own work" mechanism — the system actually knows what's been covered.
  const summaryStart = Date.now();
  let issueSummaryResult: IssueSummary | null = null;
  let summaryCost = { input: 0, output: 0, latency: 0 };
  try {
    const summary = await runIssueSummary(client, finalContent, lockedContentType, opts.issueDate);
    summaryCost = {
      input: summary.inputTokens,
      output: summary.outputTokens,
      latency: summary.latencyMs,
    };
    if (summary.summary) {
      issueSummaryResult = summary.summary;
      pipeline.push({
        name: "issue_summary",
        status: "success",
        latencyMs: Date.now() - summaryStart,
        notes: `cluster=${summary.summary.cluster}, topicSlug=${summary.summary.topicSlug}, freshAfter=${summary.summary.freshAfter}`,
        input: {
          finalHeadline: finalContent.headline,
          finalContentType: lockedContentType,
        },
        output: summary.summary as unknown as Record<string, unknown>,
        data: summary.summary as unknown as Record<string, unknown>,
      });
    } else {
      pipeline.push({
        name: "issue_summary",
        status: "warning",
        latencyMs: Date.now() - summaryStart,
        notes: `issue_summary parse failed`,
      });
    }
  } catch (err) {
    pipeline.push({
      name: "issue_summary",
      status: "warning",
      latencyMs: Date.now() - summaryStart,
      notes: `issue_summary error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // STAGE: pipeline_drift_check — compare what each stage was TOLD to do
  // against what downstream stages produced. Flag breaks so we can debug
  // "the proposer wanted X but the writer shipped Y" without rereading
  // the whole trace.
  const drift = computePipelineDrift({
    proposerCluster: detectClusterFromString(proposal?.topic ?? null),
    proposerContentType: proposal?.contentType ?? null,
    proposerTopic: proposal?.topic ?? null,
    summaryCluster: issueSummaryResult?.cluster ?? null,
    finalContentType: lockedContentType,
    finalHeadline: finalContent.headline,
    researchSources: Array.from(new Set(research.bundle.items.map((r) => r.source))),
  });
  pipeline.push({
    name: "pipeline_drift_check",
    status: drift.flags.length === 0 ? "success" : "warning",
    notes:
      drift.flags.length === 0
        ? "no drift detected"
        : `drift detected: ${drift.flags.map((f) => f.code).join(", ")}`,
    input: drift.handoffs,
    output: { flags: drift.flags },
    data: { flags: drift.flags, handoffs: drift.handoffs },
  });

  // ─── final_quality_gate ────────────────────────────────────────────────────
  // Roll up every gate's decision into ONE top-level pass/warning verdict
  // per spec `04_content_pipeline.spec.md:719-728`. Reasons to flag for
  // human review:
  //   - persona panel verdict still != pass after revision loop
  //   - persona panel hard stops triggered
  //   - fact_check verdict=reject
  //   - voice_gate exhausted iterations with defects remaining
  //   - pipeline drift detected
  //   - research below floor after all retries
  //   - editor_gate exhausted iterations without clean approve
  const warnings: string[] = [];
  for (const stage of pipeline) {
    if (stage.name === "persona_gate") {
      const decision = (stage.output as Record<string, unknown> | undefined)?.decision;
      if (decision === "proceed_with_warning") {
        warnings.push(
          `persona_gate: ${(stage.output as Record<string, unknown>)?.reason ?? "ships with hard stops"}`,
        );
      }
    }
    if (stage.name === "persona_revision_loop_end" && stage.status === "warning") {
      const finalVerdict = (stage.output as Record<string, unknown> | undefined)?.finalVerdict;
      const finalMetrics = (stage.output as Record<string, unknown> | undefined)?.finalMetrics as Record<string, unknown> | undefined;
      warnings.push(
        `persona_revision_loop: did not reach pass verdict after up to 3 cycles (final=${finalVerdict ?? "unknown"}${finalMetrics ? ", love=" + ((Number(finalMetrics.loveRate) || 0) * 100).toFixed(0) + "%, share=" + ((Number(finalMetrics.shareRate) || 0) * 100).toFixed(0) + "%" : ""})`,
      );
    }
    if (stage.name === "fact_check" && (stage.data as Record<string, unknown> | undefined)?.verdict === "reject") {
      warnings.push(
        `fact_check: verdict=reject (${(stage.data as Record<string, unknown>)?.issueCount ?? "?"} high-severity issues) — should not ship without human review`,
      );
    }
    if (stage.name === "voice_gate" && stage.status === "warning") {
      const remaining = (stage.output as Record<string, unknown> | undefined)?.remainingDefects;
      if (Array.isArray(remaining) && remaining.length > 0) {
        warnings.push(`voice_gate: ${remaining.length} defects remain after max iterations: ${remaining.join(", ")}`);
      }
    }
    if (stage.name === "pipeline_drift_check" && stage.status === "warning") {
      warnings.push(`pipeline_drift_check: ${stage.notes ?? "drift detected"}`);
    }
    if (stage.name === "research_quality_gate" && stage.status === "warning") {
      warnings.push(`research_quality_gate: ${stage.notes ?? "research below floor"}`);
    }
    if (stage.name === "editor_gate" && stage.status === "warning") {
      warnings.push(`editor_gate: ${stage.notes ?? "editor loop did not produce clean approve"}`);
    }
  }
  const qualityGateStatus: "passed" | "pending_review_with_warnings" =
    warnings.length === 0 ? "passed" : "pending_review_with_warnings";
  pipeline.push({
    name: "final_quality_gate",
    status: qualityGateStatus === "passed" ? "success" : "warning",
    notes:
      qualityGateStatus === "passed"
        ? `all gates clean → status=passed, ship normally`
        : `${warnings.length} warning(s) → status=pending_review_with_warnings (ships but flagged for human review per spec)`,
    input: { stageCount: pipeline.length - 1 },
    output: {
      qualityGateStatus,
      warnings,
      decision: qualityGateStatus === "passed" ? "ship_normally" : "ship_but_flag_for_human_review",
    },
  });

  const totalCost = estimateCostUsd(
    research.inputTokens,
    research.outputTokens,
    research.webSearches,
    writer.inputTokens + contentTypePickerCost.input + voiceReviewCost.input + sharpenCost.input + assembleCost.input + summaryCost.input,
    writer.outputTokens + contentTypePickerCost.output + voiceReviewCost.output + sharpenCost.output + assembleCost.output + summaryCost.output,
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
        writer.latencyMs + contentTypePickerCost.latency + voiceReviewCost.latency + sharpenCost.latency + assembleCost.latency + summaryCost.latency,
      issueDate: opts.issueDate,
      ...("funnel" in research && research.funnel ? { researchFunnel: research.funnel } : {}),
      ...(issueSummaryResult ? { issueSummary: issueSummaryResult } : {}),
      qualityGateStatus,
      qualityGateWarnings: warnings,
    },
  };
}
