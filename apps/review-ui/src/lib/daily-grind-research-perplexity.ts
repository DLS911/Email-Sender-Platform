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

// Lock Perplexity's search to known advisor-industry domains. Without this
// the model searches the open web and returns results matching the word
// "research" or "advisor" from unrelated sources (The Mary Sue, EBSCO, FTC
// Consumer). Perplexity API enforces a max of 20 domains; this is the
// canonical set, prioritized by signal quality for Mark's audience.
const ADVISOR_INDUSTRY_DOMAINS = [
  "thinkadvisor.com",
  "wealthmanagement.com",
  "investmentnews.com",
  "advisorhub.com",
  "kitces.com",
  "riaintel.com",
  "fa-mag.com",
  "financial-planning.com",
  "barrons.com",
  "wsj.com",
  "morningstar.com",
  "cerulli.com",
  "fpa.org",
  "sec.gov",
  "finra.org",
  "irs.gov",
  "planadviser.com",
  "rethinking65.com",
  "advisorperspectives.com",
  "michaelkitces.com",
];

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

# URL REQUIREMENTS — HARD RULE
- The "url" field MUST be a deep article URL with a slug, NOT a homepage or section page.
- VALID: https://www.investmentnews.com/regulation/dol-revives-2021-rule/123456
- INVALID: https://www.investmentnews.com (homepage)
- INVALID: https://www.investmentnews.com/news (section page)
- INVALID: https://www.investmentnews.com/regulation (section page)
- If you cannot find a deep article URL for an item, DO NOT INCLUDE THE ITEM. Drop it and return fewer items.
- The reader will click "Source: [Publisher]" and expect to land on the actual article. A homepage link breaks trust.

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

# QUANTITY POLICY
Return one item per source you ACTUALLY searched. If you searched 8 sources, return 8 items. The downstream pipeline cross-references every URL against your citations list — items with URLs you didn't actually retrieve will be dropped as fabrications. Padding the response with invented items hurts the writer; quality search beats quantity output every time. Aim to search 8-15 distinct publishers per request so the writer has range to pick from.`;

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
  recentConcepts: string[];
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
      `\n# RECENTLY COVERED HEADLINES — DO NOT SEARCH FOR THESE STORIES
The newsletter has already covered these in the last 30 issues. Any item you return that retreads one of these stories will be DROPPED by the post-processor. Search around them, not toward them.

${opts.recentTopics.map((t) => `- ${t}`).join("\n")}`,
    );
  }
  if (opts.recentConcepts.length > 0) {
    parts.push(
      `\n# CONCEPTS ALREADY DISCUSSED IN RECENT ISSUES — DO NOT RETURN ITEMS THAT REHASH THESE
These are the substantive ideas/themes the newsletter has covered. Find news on DIFFERENT concepts, not new angles on these. The writer will reject items that overlap with these concepts.

${opts.recentConcepts.map((c) => `- ${c}`).join("\n")}`,
    );
  }
  parts.push(
    `\n# WHAT TO RETURN — CRITICAL
Search for fresh news items (last 30-60 days) relevant to independent financial advisors. Then return ONE item per source you ACTUALLY retrieved during search. DO NOT invent items. DO NOT pad the list with plausible-looking entries for URLs you didn't actually search.

If your search retrieved 5 article sources, return 5 items. If it retrieved 12, return 12. Each item's "url" field MUST be a URL you actually visited — every URL you return will be cross-referenced against your citations list. Items with URLs not in your citations will be dropped.

Aim to search broadly: at least 8 different publishers, prioritizing ThinkAdvisor, WealthManagement, AdvisorHub, Investment News, Cerulli, Kitces, RIA Channel, FPA, ALM Publications, SEC.gov, FINRA, regulatory filings. The MORE sources you search, the MORE items survive — but every item must trace to a real search retrieval.

Return the structured JSON specified in the system prompt. No preamble.`,
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

/**
 * Returns true if the URL is a bare site (homepage or top-level section) and
 * NOT a specific article URL. A real article URL almost always ends with a
 * slug — hyphen-separated words, a long unique token, or a numeric ID.
 *
 * Rules:
 * - Path empty, "/", or "/index.html" → bare
 * - Multi-segment paths with any segment containing a hyphen → keep
 *   (e.g. /news/sec-fines-firm)
 * - Multi-segment paths where deep enough that one segment looks article-like
 *   (>= 10 chars OR numeric ID >= 4 digits) → keep
 * - Single-segment paths require a hyphen or be very long
 *
 * The old version was too aggressive — dropped legitimate URLs like
 * "https://news.example.com/finra-fines" (path length 12).
 */
function isBareDomainUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    const path = parsed.pathname.replace(/\/+$/, "");
    if (path === "" || path === "/" || path === "/index.html") return true;
    const segments = path.replace(/^\/+/, "").split("/").filter(Boolean);
    if (segments.length === 0) return true;
    // Strip a trailing ".html" / ".htm" / ".pdf" from segments for analysis
    const cleanedSegments = segments.map((s) =>
      s.replace(/\.(html?|pdf|aspx?|php|jsp)$/i, ""),
    );
    // Any segment that looks article-like: has a hyphen, OR is long (10+
    // chars), OR is a multi-digit numeric ID (4+ digits, common for CMS IDs).
    const hasArticleLikeSegment = cleanedSegments.some((s) => {
      if (s.includes("-")) return true;
      if (s.length >= 10) return true;
      if (/^\d{4,}$/.test(s)) return true;
      return false;
    });
    if (hasArticleLikeSegment) return false;
    // Otherwise it's a section/category path — bare
    return true;
  } catch {
    return true;
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

async function urlIsLive(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timeoutId);
    if (response.status === 405) return true; // HEAD not allowed, treat as live
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

type ParseResult = {
  items: ResearchItem[];
  funnel: {
    rawItemCount: number;
    citationCount: number;
    rawCitationCount?: number;
    droppedMissingFields: number;
    droppedBareDomain: number;
    droppedDeadUrl: number;
    survived: number;
    rawCitationDomains?: string[];
  };
};

async function parseResearchItems(content: string, citations: string[]): Promise<ParseResult> {
  const cleaned = stripCodeFences(content);
  // String-aware brace matching: find the close brace that matches the first
  // open brace, ignoring braces inside string literals. Robust against
  // trailing commentary appended after the JSON block.
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    throw new Error(`perplexity: no JSON in response: ${cleaned.slice(0, 200)}`);
  }
  let endIndex = -1;
  {
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
        if (depth === 0) { endIndex = i; break; }
      }
    }
  }
  if (endIndex === -1) {
    throw new Error(`perplexity: unbalanced JSON in response: ${cleaned.slice(0, 200)}`);
  }
  const json = cleaned.slice(firstBrace, endIndex + 1);
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
  const rawItemCount = parsed.items.length;
  let droppedMissingFields = 0;
  let droppedBareDomain = 0;
  let droppedDeadUrl = 0;
  const items: ResearchItem[] = [];
  for (const raw of parsed.items) {
    if (!raw || typeof raw !== "object") {
      droppedMissingFields++;
      continue;
    }
    const obj = raw as Record<string, unknown>;
    const category = typeof obj.category === "string" ? obj.category.trim() : "";
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    const url = typeof obj.url === "string" ? obj.url.trim() : "";
    const source = typeof obj.source === "string" ? obj.source.trim() : "";
    const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
    if (!category || !title || !url || !source || !summary) {
      droppedMissingFields++;
      continue;
    }
    // Drop bare-domain URLs (homepages, section pages) — they don't cite
    // the actual story. Reader clicks "Source: Foo News" and lands on the
    // homepage instead of the article. Quality bar: only article-deep URLs.
    if (isBareDomainUrl(url)) {
      droppedBareDomain++;
      continue;
    }
    // STRICT: only accept items whose URL is in Perplexity's citations list.
    // Empirical data (Jun 18 diagnostic): of 18 items returned, only 5 had
    // matching citations — the other 13 had URLs Perplexity invented to pad
    // the response. The HEAD-fallback was masking this: if a made-up URL
    // happened to be live (different content), we'd accept it and ship a
    // fake source. Now: no citation match = drop. Trust the search index,
    // not the model's URL generation.
    const matchedCitation = urlMatchesCitation(url, citations);
    if (!matchedCitation) {
      droppedDeadUrl++;
      continue;
    }
    if (isBareDomainUrl(matchedCitation)) {
      droppedBareDomain++;
      continue;
    }
    const canonicalUrl = matchedCitation;
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
  const funnel = {
    rawItemCount,
    citationCount: citations.length,
    droppedMissingFields,
    droppedBareDomain,
    droppedDeadUrl,
    survived: items.length,
  };
  console.log(
    `[perplexity-research] funnel: raw=${rawItemCount} citations=${citations.length} droppedMissingFields=${droppedMissingFields} droppedBareDomain=${droppedBareDomain} droppedDeadUrl=${droppedDeadUrl} survived=${items.length}`,
  );
  return { items, funnel };
}

export type PerplexityResearchResult = {
  bundle: ResearchBundle;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  latencyMs: number;
  costUsd: number;
  rawCitations: string[];
  funnel?: {
    rawItemCount: number;
    citationCount: number;
    droppedMissingFields: number;
    droppedBareDomain: number;
    droppedDeadUrl: number;
    survived: number;
  };
};

export async function runPerplexityResearch(opts: {
  issueDate: string;
  recentTopics: string[];
  recentConcepts?: string[];
  topicHint?: string;
  apiKey?: string;
}): Promise<PerplexityResearchResult> {
  const apiKey = opts.apiKey ?? process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("perplexity: PERPLEXITY_API_KEY missing");

  const userPrompt = buildUserPrompt({
    issueDate: opts.issueDate,
    recentTopics: opts.recentTopics,
    recentConcepts: opts.recentConcepts ?? [],
    ...(opts.topicHint ? { topicHint: opts.topicHint } : {}),
  });
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
      max_tokens: 8000,
      // Search-time domain filter removed (Jun 22 diagnostic): with 20
      // domains locked, Perplexity could only find 4 citations and padded
      // with 13 invented items. Now we let Perplexity search the full web,
      // then filter the resulting citations to only the approved-publisher
      // subset before we hand them to the parser. This gives breadth at
      // search time, curation at output time.
      // Do NOT use search_recency_filter — testing 2026-05-18 showed it
      // returned gardening/food/USDA citations for advisor queries. Recency
      // bias is enforced via the prompt ("fresh items from last 30 days").
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

  const rawCitations = data.citations ?? [];
  // Post-filter citations to only approved advisor-industry domains. This
  // gives Perplexity full-web breadth at search time but enforces source
  // curation at output time — the opposite trade-off from search_domain_filter,
  // and the one that actually works for our use case.
  const approvedDomains = new Set(ADVISOR_INDUSTRY_DOMAINS);
  const rawCitationDomains: string[] = [];
  const citations = rawCitations.filter((c) => {
    try {
      const host = new URL(c).hostname.replace(/^www\./, "");
      rawCitationDomains.push(host);
      return [...approvedDomains].some(
        (d) => host === d || host.endsWith(`.${d}`),
      );
    } catch {
      return false;
    }
  });
  console.log(
    `[perplexity-research] citation filter: raw=${rawCitations.length} approved=${citations.length} rawDomains=[${rawCitationDomains.join(", ")}]`,
  );
  const { items, funnel } = await parseResearchItems(choice.message.content, citations);
  // Enrich funnel with raw counts so failure paths can be diagnosed without
  // Vercel log access.
  funnel.rawCitationCount = rawCitations.length;
  funnel.rawCitationDomains = rawCitationDomains;

  if (items.length === 0) {
    throw new Error(
      `perplexity: no valid items survived URL-citation validation. funnel=${JSON.stringify(funnel)}`,
    );
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
    funnel,
  };
}
