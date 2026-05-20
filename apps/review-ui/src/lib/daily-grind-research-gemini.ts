/**
 * Gemini-backed research phase for Daily Grind.
 *
 * Uses Gemini 2.5 Flash with Google Search grounding — the native Google
 * Search index, accessed directly without the Anthropic web_search middleman.
 * Advisor industry publications (ThinkAdvisor, WealthManagement, Kitces,
 * etc.) are well-indexed in Google Search, so this hits the right corpus.
 *
 * Cost per call: ~$0.05 (input + output + $0.035 grounding tool fee).
 * That's roughly 10x cheaper than the Anthropic Sonnet 4.5 + web_search
 * combo measured empirically at ~$0.50/call.
 *
 * Same ResearchBundle return shape as the other backends so the caller
 * doesn't care which one ran.
 */

import type { ResearchBundle, ResearchFunnel, ResearchItem } from "./daily-grind-generator";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = (model: string, apiKey: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

const RESEARCH_SYSTEM_PROMPT = `You are the research analyst for The Daily Grind, a weekday newsletter for independent financial advisors. Your job is to find REAL, RECENT, CITED news and data for today's issue using the Google Search tool.

# WHAT MATTERS FOR THIS AUDIENCE
Independent financial advisors, RIAs, breakaway brokers, fee-only fiduciaries. They care about:
- SEC / FINRA regulatory changes (rules, enforcement actions, exam priorities)
- RIA industry trends (M&A, fee compression, custodian changes, breakaway movement)
- Practice management research (referral rates, AUM growth, retention, time studies)
- Fintech and AI tools for advisors (CRM, planning software, meeting AI, portfolio platforms)
- Compliance and audit topics
- Tax law and estate planning updates

# QUALITY BAR
- Only items from credible advisor industry publishers. Skip random blogs and general consumer news.
- Skip pure marketing content (vendor press releases without substance).
- Skip items older than 60 days unless foundational.
- Prefer items with at least one concrete number the writer can build around.
- Every URL must be a deep article URL (with slug), NOT a homepage or section page.

# OUTPUT FORMAT
Return ONLY this JSON object — no preamble, no markdown fences, no commentary:

{
  "items": [
    {
      "category": "Regulation" | "Practice" | "Tech" | "Compliance" | "M&A" | "Tax" | "Markets" | "Industry",
      "title": "the article's actual headline (don't rewrite)",
      "url": "the real deep article URL",
      "source": "publisher name (e.g. ThinkAdvisor, WealthManagement, Kitces.com)",
      "publishedDate": "YYYY-MM-DD or approximate",
      "summary": "2-3 sentence neutral factual summary",
      "keyStats": [
        { "number": "exact figure as it appears (e.g. 6.2x, 41%, $847,000)", "label": "6-12 word description" }
      ]
    }
  ]
}

Aim for 8-12 items across at least 4 different advisor industry publishers.`;

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
      `\nTopic focus for this issue: ${opts.topicHint}. Bias searches toward this area.`,
    );
  }
  if (opts.recentTopics.length > 0) {
    parts.push(
      `\nRecently covered headlines (find different angles — don't repeat these stories):\n${opts.recentTopics.map((t) => `- ${t}`).join("\n")}`,
    );
  }
  if (opts.recentConcepts.length > 0) {
    parts.push(
      `\nConcepts already discussed (find news on different concepts):\n${opts.recentConcepts.map((c) => `- ${c}`).join("\n")}`,
    );
  }
  parts.push(
    `\n# SEARCH QUERIES — RUN THESE AGAINST GOOGLE SEARCH
Run multiple specific queries against the advisor industry press. Do NOT search general consumer news.

1. site:thinkadvisor.com OR site:wealthmanagement.com OR site:investmentnews.com — most recent RIA M&A activity
2. site:sec.gov OR site:finra.org — recent enforcement actions against registered investment advisers
3. site:kitces.com — recent practice management or planning research
4. site:advisorperspectives.com OR site:fa-mag.com OR site:financial-planning.com — fee compression, benchmarking, growth studies
5. site:planadviser.com — retirement plan / fiduciary updates
6. site:rethinking65.com OR site:advisorhub.com — industry trends, breakaway broker movement
7. site:riaintel.com — RIA aggregator activity, custodian platform news
8. Cerulli OR Morningstar advisor industry study 2026

Run multiple queries. Each search should hit a different angle. Aim for 8-12 distinct articles total from advisor industry publishers.

Return the structured JSON specified in the system prompt. No preamble, no markdown fences.`,
  );
  return parts.join("\n");
}

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

function isBareDomainUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    const path = parsed.pathname.replace(/\/+$/, "");
    if (path === "" || path === "/" || path === "/index.html") return true;
    const segments = path.replace(/^\/+/, "").split("/").filter(Boolean);
    if (segments.length === 0) return true;
    const cleanedSegments = segments.map((s) =>
      s.replace(/\.(html?|pdf|aspx?|php|jsp)$/i, ""),
    );
    const hasArticleLikeSegment = cleanedSegments.some((s) => {
      if (s.includes("-")) return true;
      if (s.length >= 10) return true;
      if (/^\d{4,}$/.test(s)) return true;
      return false;
    });
    return !hasArticleLikeSegment;
  } catch {
    return true;
  }
}

const APPROVED_DOMAINS = [
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

function isApprovedDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return APPROVED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      searchEntryPoint?: unknown;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

function extractJsonObject(text: string): string {
  const cleaned = stripCodeFences(text);
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    throw new Error(`gemini: no JSON object in response: ${cleaned.slice(0, 200)}`);
  }
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
  throw new Error(`gemini: unbalanced JSON in response: ${cleaned.slice(0, 200)}`);
}

export type GeminiResearchResult = {
  bundle: ResearchBundle;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  latencyMs: number;
  costUsd: number;
  funnel: ResearchFunnel;
};

export async function runGeminiResearch(opts: {
  issueDate: string;
  recentTopics: string[];
  recentConcepts?: string[];
  topicHint?: string;
  apiKey?: string;
}): Promise<GeminiResearchResult> {
  const apiKey = opts.apiKey ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("gemini: GOOGLE_API_KEY missing");

  const userPrompt = buildUserPrompt({
    issueDate: opts.issueDate,
    recentTopics: opts.recentTopics,
    recentConcepts: opts.recentConcepts ?? [],
    ...(opts.topicHint ? { topicHint: opts.topicHint } : {}),
  });

  const start = Date.now();
  const response = await fetch(GEMINI_ENDPOINT(GEMINI_MODEL, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: RESEARCH_SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0,
        // Bumped from 8000 → 32000. Stress test of 5 calls (Jun 29 – Jul 6)
        // showed ALL 5 truncated mid-URL. Gemini 2.5 Flash supports up to
        // 65K output, so 32K gives ample headroom for grounded reasoning
        // (search results in context) + 10+ items of structured JSON output.
        maxOutputTokens: 32000,
      },
    }),
  });

  const latencyMs = Date.now() - start;

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`gemini: HTTP ${response.status} — ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as GeminiResponse;
  const candidate = data.candidates?.[0];
  const textOutput = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!textOutput) {
    throw new Error("gemini: empty response content");
  }

  // Collect citations from groundingMetadata
  const groundingChunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const rawCitations: string[] = [];
  const rawCitationDomains: string[] = [];
  for (const chunk of groundingChunks) {
    const uri = chunk.web?.uri;
    if (typeof uri === "string" && uri.trim() !== "") {
      rawCitations.push(uri);
      try {
        rawCitationDomains.push(new URL(uri).hostname.replace(/^www\./, ""));
      } catch {
        rawCitationDomains.push("(invalid)");
      }
    }
  }
  console.log(
    `[gemini-research] rawCitations=${rawCitations.length} domains=[${rawCitationDomains.join(", ")}]`,
  );

  // Parse the model's items array
  const json = extractJsonObject(textOutput);
  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `gemini: JSON parse failed: ${err instanceof Error ? err.message : String(err)}\nfirst 200: ${json.slice(0, 200)}`,
    );
  }
  if (!Array.isArray(parsed.items)) {
    throw new Error("gemini: missing items array");
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
    if (isBareDomainUrl(url)) {
      droppedBareDomain++;
      continue;
    }
    // STRICT: items must come from approved advisor publications, period.
    // The previous "OR in groundingMetadata" fallback let in tech vendors
    // and consulting blogs (Atlant Security, E-N Computers, SoftPak) when
    // Gemini's grounding pulled them — same off-topic problem Perplexity
    // had with The Mary Sue / CBS News. No exceptions: approved domain or drop.
    if (!isApprovedDomain(url)) {
      droppedDeadUrl++;
      continue;
    }
    const item: ResearchItem = { category, title, url, source, summary };
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

  const funnel: ResearchFunnel = {
    rawItemCount,
    citationCount: rawCitations.length,
    rawCitationCount: rawCitations.length,
    rawCitationDomains,
    droppedMissingFields,
    droppedBareDomain,
    droppedDeadUrl,
    survived: items.length,
  };

  if (items.length === 0) {
    throw new Error(
      `gemini: no valid items survived URL validation. funnel=${JSON.stringify(funnel)}`,
    );
  }

  // Token + cost estimation. Gemini 2.5 Flash: $0.30/M input, $2.50/M output.
  // Plus $0.035 per grounded response.
  const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
  const costUsd =
    (inputTokens / 1_000_000) * 0.3 +
    (outputTokens / 1_000_000) * 2.5 +
    0.035; // grounding tool fee

  return {
    bundle: { researchedOn: opts.issueDate, items },
    inputTokens,
    outputTokens,
    webSearches: rawCitations.length,
    latencyMs,
    costUsd,
    funnel,
  };
}
