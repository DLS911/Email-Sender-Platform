/**
 * Perplexity-backed research phase.
 *
 * Replaces the Anthropic web_search-based research with Perplexity's
 * sonar-pro model. Trades the per-org tool quota flakiness of Anthropic
 * for a mature, purpose-built citation engine that returns structured
 * JSON with grounded URLs in a single API call.
 *
 * Cost per research call: ~$0.02-0.04 (vs $0.10-0.30 for Anthropic).
 * Latency: ~15-30s single round trip.
 *
 * Same return shape as the previous runResearchPhase so the caller in
 * daily-grind-generator.ts doesn't care which backend produced it.
 */

import type { ResearchBundle, ResearchItem } from "./daily-grind-generator";

const PERPLEXITY_MODEL = "sonar-pro";
const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";

const RESEARCH_SYSTEM_PROMPT = `You are the research analyst for The Daily Grind, a weekday newsletter for independent financial advisors. Your job is to find REAL, RECENT, CITED news and data for today's issue. The model running you (Perplexity sonar-pro) already has live web search; use it to find genuinely current items.

# WHAT MATTERS FOR THIS AUDIENCE
Independent financial advisors, RIAs, breakaway brokers, fee-only fiduciaries. They care about:
- SEC / FINRA regulatory changes (rules, enforcement actions, exam priorities)
- RIA industry trends (M&A, fee compression, custodian changes, breakaway movement)
- Practice management research (referral rates, AUM growth, retention, time studies)
- Fintech and AI tools for advisors (CRM, planning software, meeting AI, portfolio platforms)
- Compliance and audit topics
- Tax law and estate planning updates
- Studies from credible sources: Cerulli, Kitces, FPA, JD Power, McKinsey, Schwab/Fidelity reports, ThinkAdvisor, WealthManagement.com, AdvisorHub, Investment News

# QUALITY BAR
- Only include items from credible publishers. Skip random blog posts.
- Skip pure marketing content (vendor press releases without substance).
- Skip items older than 60 days unless foundational.
- Prefer items with at least one concrete number the writer can build around.
- If a category has no fresh items, return fewer items rather than padding with weak ones.

# OUTPUT FORMAT
Return ONLY this JSON object — no preamble, no markdown fences, no commentary outside the JSON:

{
  "items": [
    {
      "category": "Regulation" | "Practice" | "Tech" | "Compliance" | "M&A" | "Tax" | "Markets" | "Industry",
      "title": "the article's actual headline (don't rewrite)",
      "url": "the real URL — must be one Perplexity actually retrieved",
      "source": "publisher name (e.g. ThinkAdvisor, WealthManagement, Kitces.com, SEC.gov)",
      "publishedDate": "YYYY-MM-DD or approximate (e.g. April 2026)",
      "summary": "2-3 sentence neutral factual summary",
      "keyStats": [
        { "number": "exact figure as it appears (e.g. 6.2x, 41%, $847,000)", "label": "6-12 word description of what the number represents" }
      ]
    }
  ]
}

# QUANTITY
At least 5 items, ideally 6-10, spanning at least 3 different categories. Quality over quantity.`;

type PerplexityResponse = {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string;
    message: { role: string; content: string };
  }>;
  citations?: string[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost?: { total_cost?: number };
  };
};

function stripCodeFences(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) {
    const lines = t.split("\n");
    if (lines.length >= 3 && lines[lines.length - 1]!.startsWith("```")) {
      return lines.slice(1, -1).join("\n").trim();
    }
  }
  return t;
}

function buildUserPrompt(opts: {
  issueDate: string;
  recentTopics: string[];
  topicHint?: string;
}): string {
  const parts: string[] = [];
  parts.push(`Today is ${opts.issueDate}.`);
  if (opts.topicHint) {
    parts.push(
      `\nTopic focus for this issue: ${opts.topicHint}. Bias your searches toward this area but still include 1-2 items from other categories for variety.`,
    );
  }
  if (opts.recentTopics.length > 0) {
    parts.push(
      `\nRecently covered headlines (find DIFFERENT angles — don't return items that just repeat these stories):\n${opts.recentTopics.map((t) => `- ${t}`).join("\n")}`,
    );
  }
  parts.push(
    `\nFind 6-10 fresh, real, recent (last 30-60 days) news items relevant to independent financial advisors. Return the structured JSON specified in the system prompt. No preamble.`,
  );
  return parts.join("\n");
}

function normalizeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    // Drop trailing slash + query string + hash + 'www.' prefix
    const host = parsed.hostname.replace(/^www\./, "");
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${host}${pathname}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

function urlMatchesCitation(url: string, citations: string[]): string | null {
  const normUrl = normalizeUrl(url);
  for (const c of citations) {
    if (normalizeUrl(c) === normUrl) return c;
  }
  // Loose substring fallback — handles short URLs that may have been
  // expanded by Perplexity or vice versa
  for (const c of citations) {
    const normC = normalizeUrl(c);
    if (normC.length > 20 && (normC.includes(normUrl) || normUrl.includes(normC))) {
      return c;
    }
  }
  return null;
}

function parseResearchItems(content: string, citations: string[]): ResearchItem[] {
  const cleaned = stripCodeFences(content);
  // Find the JSON object boundaries
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error(`perplexity: no JSON in response: ${cleaned.slice(0, 200)}`);
  }
  const json = cleaned.slice(firstBrace, lastBrace + 1);
  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `perplexity: JSON parse failed: ${err instanceof Error ? err.message : String(err)}\nfirst 200: ${json.slice(0, 200)}`,
    );
  }
  if (!Array.isArray(parsed.items)) {
    throw new Error("perplexity: missing items array");
  }
  const items: ResearchItem[] = [];
  for (const raw of parsed.items) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const category = typeof obj.category === "string" ? obj.category.trim() : "";
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    const url = typeof obj.url === "string" ? obj.url.trim() : "";
    const source = typeof obj.source === "string" ? obj.source.trim() : "";
    const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
    if (!category || !title || !url || !source || !summary) continue;
    // Match the item's URL against Perplexity's citations with normalization
    // (strips trailing slash, www, params, hash, case). If a match is found,
    // use the canonical citation URL — that's what was actually fetched.
    const matchedCitation = urlMatchesCitation(url, citations);
    let canonicalUrl: string;
    if (matchedCitation) {
      canonicalUrl = matchedCitation;
    } else {
      // No citation match. Skip this item — the URL is likely hallucinated.
      continue;
    }
    const item: ResearchItem = {
      category,
      title,
      url: canonicalUrl,
      source,
      summary,
    };
    if (typeof obj.publishedDate === "string" && obj.publishedDate.trim() !== "") {
      item.publishedDate = obj.publishedDate.trim();
    }
    if (Array.isArray(obj.keyStats)) {
      const stats = obj.keyStats
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
        .map((s) => ({
          number: typeof s.number === "string" ? s.number.trim() : "",
          label: typeof s.label === "string" ? s.label.trim() : "",
        }))
        .filter((s) => s.number && s.label);
      if (stats.length > 0) item.keyStats = stats;
    }
    items.push(item);
  }
  return items;
}

export type PerplexityResearchResult = {
  bundle: ResearchBundle;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  latencyMs: number;
  costUsd: number;
  rawCitations: string[];
};

export async function runPerplexityResearch(opts: {
  issueDate: string;
  recentTopics: string[];
  topicHint?: string;
  apiKey?: string;
}): Promise<PerplexityResearchResult> {
  const apiKey = opts.apiKey ?? process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("perplexity: PERPLEXITY_API_KEY missing");

  const userPrompt = buildUserPrompt(opts);
  const start = Date.now();

  const response = await fetch(PERPLEXITY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages: [
        { role: "system", content: RESEARCH_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      search_recency_filter: "month",
      return_citations: true,
    }),
  });

  const latencyMs = Date.now() - start;

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`perplexity: HTTP ${response.status} — ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as PerplexityResponse;
  const choice = data.choices[0];
  if (!choice?.message?.content) {
    throw new Error("perplexity: empty response content");
  }

  const citations = data.citations ?? [];
  const items = parseResearchItems(choice.message.content, citations);

  if (items.length === 0) {
    throw new Error("perplexity: no valid items survived URL-citation validation");
  }

  const costUsd = data.usage.cost?.total_cost ?? 0;

  return {
    bundle: {
      researchedOn: opts.issueDate,
      items,
    },
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
    webSearches: citations.length,
    latencyMs,
    costUsd,
    rawCitations: citations,
  };
}
