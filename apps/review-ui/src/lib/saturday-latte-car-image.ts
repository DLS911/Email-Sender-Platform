/**
 * Reference-image lookup for the theDrive slot.
 *
 * The car in each Latte issue must render as the exact year + generation +
 * factory-spec model. Text-to-image models (Gemini, DALL-E) either default
 * to the previous generation of a nameplate or strip performance-variant
 * styling. The reliable fix is to use a real manufacturer press photo.
 *
 * Sourcing strategy (in order):
 *
 * 1. **Wikipedia REST API.** For the vast majority of production cars,
 *    Wikipedia has an article with a manufacturer press photo in the
 *    infobox. Wikipedia's REST summary endpoint returns the actual
 *    resolved image URL — no hallucination. This is the primary path.
 *
 * 2. **Anthropic Haiku with web_search.** For cars Wikipedia doesn't
 *    cover (very new releases, obscure trims), Haiku can search
 *    manufacturer press sites. HAIKU-RETURNED URLS ARE HEAD-CHECKED
 *    before download because Haiku is prone to hallucinating URLs.
 *
 * Uses ANTHROPIC_API_KEY (already in env). No new secrets.
 *
 * Wikimedia policy compliance: our User-Agent identifies the project
 * and provides a contact email, per
 * https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy.
 */

import Anthropic from "@anthropic-ai/sdk";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const HAIKU_MAX_TOKENS = 800;
const WEB_SEARCH_MAX_USES = 2;

const WIKIPEDIA_UA =
  "CastorAbbottLatte/1.0 (https://castorabbott.com; austin@castorabbott.com)";

export type CarReferenceImage = {
  bytes: Uint8Array;
  mimeType: string;
  sourceUrl: string;
  searchQuery: string;
};

// ─── Wikipedia primary path ────────────────────────────────────────────

type WikiSearchResult = {
  title: string;
  snippet?: string;
};

async function wikipediaSearch(query: string): Promise<WikiSearchResult[]> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", "5");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": WIKIPEDIA_UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`wiki search: HTTP ${res.status}`);
  const data = (await res.json()) as {
    query?: { search?: Array<{ title: string; snippet?: string }> };
  };
  return (data.query?.search ?? []).map((r) => {
    const out: WikiSearchResult = { title: r.title };
    if (typeof r.snippet === "string") out.snippet = r.snippet;
    return out;
  });
}

type WikiSummary = {
  title: string;
  originalimage?: { source: string; width?: number; height?: number };
  thumbnail?: { source: string; width?: number; height?: number };
  description?: string;
};

async function wikipediaSummary(title: string): Promise<WikiSummary | null> {
  const slug = encodeURIComponent(title.replace(/ /g, "_"));
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`, {
    headers: { "User-Agent": WIKIPEDIA_UA, Accept: "application/json" },
    redirect: "follow",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`wiki summary: HTTP ${res.status}`);
  return (await res.json()) as WikiSummary;
}

/**
 * Score a Wikipedia search result for how likely it is to be the correct
 * article for the car. Prefers exact-match titles that contain the model
 * name; deprioritizes disambiguation and general-topic pages.
 */
function scoreWikipediaMatch(carName: string, title: string): number {
  const car = carName.toLowerCase();
  const t = title.toLowerCase();
  let score = 0;
  // Extract key tokens from the car name (make + model + gen code)
  const carTokens = car.replace(/[()]/g, " ").split(/\s+/).filter((x) => x.length > 1);
  for (const tok of carTokens) {
    if (t.includes(tok)) score += 2;
  }
  // Penalize disambiguation / list / list-of pages
  if (t.includes("(disambiguation)")) score -= 5;
  if (t.startsWith("list of")) score -= 5;
  // Boost exact-model matches
  if (t === car) score += 10;
  return score;
}

async function fetchFromWikipedia(carName: string): Promise<CarReferenceImage | null> {
  // Strip parenthetical gen codes for the search — they hurt more than help
  const cleanName = carName.replace(/\([^)]*\)/g, "").trim();

  let results: WikiSearchResult[];
  try {
    results = await wikipediaSearch(cleanName);
  } catch (err) {
    console.error("car-image.wiki_search_failed", err instanceof Error ? err.message : String(err));
    return null;
  }

  if (results.length === 0) return null;

  // Rank by fit
  const ranked = results
    .map((r) => ({ ...r, score: scoreWikipediaMatch(carName, r.title) }))
    .sort((a, b) => b.score - a.score);

  for (const candidate of ranked.slice(0, 3)) {
    try {
      const summary = await wikipediaSummary(candidate.title);
      const imgUrl = summary?.originalimage?.source ?? summary?.thumbnail?.source;
      if (!imgUrl) continue;

      const dl = await downloadImage(imgUrl, WIKIPEDIA_UA);
      return {
        bytes: dl.bytes,
        mimeType: dl.mimeType,
        sourceUrl: imgUrl,
        searchQuery: `wikipedia:${candidate.title}`,
      };
    } catch (err) {
      console.warn(
        "car-image.wiki_candidate_failed",
        candidate.title,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return null;
}

// ─── Haiku fallback path ───────────────────────────────────────────────

async function findCandidateImageUrlsViaHaiku(carName: string): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("car-image: ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey });

  const system = `You find direct image URLs for a specific year and generation of a car. Use the web_search tool to find factory-spec press photos.

**Do NOT hallucinate URLs.** Only return URLs that appeared verbatim in web_search results. If you did not see the URL in a search result, do not include it.

Preferred sources:
- Manufacturer press / media sites (media.audi.com, press.bmwgroup.com, press.porsche.com, media.lexus.com, media.toyota.com, media.ford.com, etc.)
- Reputable automotive journalism (Car and Driver, MotorTrend, Road & Track, Autoblog, Autoweek) when the photo is confirmed factory-spec press

Reject: enthusiast forums, tuner sites, Instagram, Pinterest, used-car listings, stock photo sites.

The URL must be a DIRECT image file URL (.jpg, .jpeg, .png, .webp) that appeared as an actual result in a search — not a page URL you assume contains an image.

Return ONLY JSON:
{"candidates": ["https://...jpg", "..."]}

Empty array is fine if you can't find real factory-spec image URLs.`;

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: HAIKU_MAX_TOKENS,
    temperature: 0.1,
    system,
    tools: [
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: "web_search_20260209" as any,
        name: "web_search",
        max_uses: WEB_SEARCH_MAX_USES,
        allowed_callers: ["direct"],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ],
    messages: [
      {
        role: "user",
        content: `Find 2-3 direct image URLs for a factory-spec press photo of: ${carName}. URLs must appear verbatim in your search results, no guessing.`,
      },
    ],
  });

  let textOutput = "";
  for (const block of response.content) {
    if (block.type === "text") textOutput += block.text;
  }
  if (!textOutput) return [];

  const stripped = textOutput.replace(/```json\s*|\s*```/g, "").trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return [];
  try {
    const parsed = JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as { candidates?: unknown };
    if (!Array.isArray(parsed.candidates)) return [];
    return parsed.candidates
      .filter((c): c is string => typeof c === "string" && c.trim() !== "")
      .map((c) => c.trim());
  } catch {
    return [];
  }
}

// ─── Shared download primitive ─────────────────────────────────────────

async function downloadImage(
  imageUrl: string,
  userAgent = "Mozilla/5.0 (compatible; CastorAbbottLatte/1.0)",
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(imageUrl, {
    headers: { "User-Agent": userAgent },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  const mimeType = contentType.split(";")[0]?.trim() ?? "";
  if (!mimeType.startsWith("image/")) {
    throw new Error(`non-image content-type "${contentType}"`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 5000) {
    throw new Error(`image too small (${buf.byteLength} bytes)`);
  }
  return { bytes: new Uint8Array(buf), mimeType };
}

// ─── Public API ────────────────────────────────────────────────────────

export async function fetchCarReferenceImage(carName: string): Promise<CarReferenceImage> {
  // Primary path: Wikipedia REST API (real URLs, no hallucination)
  try {
    const wiki = await fetchFromWikipedia(carName);
    if (wiki) {
      console.info("car-image.wiki_hit", { car: carName, source: wiki.sourceUrl });
      return wiki;
    }
  } catch (err) {
    console.error(
      "car-image.wiki_path_threw",
      err instanceof Error ? err.message : String(err),
    );
  }

  // Fallback path: Haiku web_search with HEAD verification
  console.info("car-image.wiki_miss_falling_back_to_haiku", { car: carName });
  const candidates = await findCandidateImageUrlsViaHaiku(carName);
  if (candidates.length === 0) {
    throw new Error(`car-image: Wikipedia had no match and Haiku returned no candidates for "${carName}"`);
  }

  const errors: string[] = [];
  for (const url of candidates) {
    try {
      const dl = await downloadImage(url);
      return {
        bytes: dl.bytes,
        mimeType: dl.mimeType,
        sourceUrl: url,
        searchQuery: `haiku:${carName}`,
      };
    } catch (err) {
      errors.push(`${url.slice(0, 60)}… : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(
    `car-image: all ${candidates.length} Haiku candidates failed. errors: ${errors.slice(0, 3).join(" | ")}`,
  );
}

/**
 * Diagnostic sibling of fetchCarReferenceImage. Returns structured info
 * about every step (Wikipedia search, Wikipedia summary, Haiku fallback,
 * per-URL download result) so /api/admin/debug-car-image can show us
 * what path was tried and why it succeeded or failed.
 */
export async function diagnoseCarReferenceLookup(carName: string): Promise<{
  carName: string;
  wikipedia: {
    searched: string;
    results: Array<{ title: string; score: number }>;
    triedTitles: Array<{
      title: string;
      imageUrl?: string;
      downloaded?: boolean;
      contentType?: string;
      byteLength?: number;
      error?: string;
    }>;
    winner?: string;
  };
  haikuFallback?: {
    ran: boolean;
    candidates: string[];
    attempts: Array<{
      url: string;
      ok: boolean;
      contentType?: string;
      byteLength?: number;
      error?: string;
    }>;
    winner?: string;
  };
  overallWinner?: string;
}> {
  const result: Awaited<ReturnType<typeof diagnoseCarReferenceLookup>> = {
    carName,
    wikipedia: {
      searched: carName.replace(/\([^)]*\)/g, "").trim(),
      results: [],
      triedTitles: [],
    },
  };

  // Wikipedia path
  const cleanName = carName.replace(/\([^)]*\)/g, "").trim();
  try {
    const rawResults = await wikipediaSearch(cleanName);
    const ranked = rawResults
      .map((r) => ({ title: r.title, score: scoreWikipediaMatch(carName, r.title) }))
      .sort((a, b) => b.score - a.score);
    result.wikipedia.results = ranked;

    for (const cand of ranked.slice(0, 3)) {
      const tried: {
        title: string;
        imageUrl?: string;
        downloaded?: boolean;
        contentType?: string;
        byteLength?: number;
        error?: string;
      } = { title: cand.title };
      try {
        const summary = await wikipediaSummary(cand.title);
        const imgUrl = summary?.originalimage?.source ?? summary?.thumbnail?.source;
        if (!imgUrl) {
          tried.error = "no infobox image in summary";
        } else {
          tried.imageUrl = imgUrl;
          try {
            const dl = await downloadImage(imgUrl, WIKIPEDIA_UA);
            tried.downloaded = true;
            tried.contentType = dl.mimeType;
            tried.byteLength = dl.bytes.byteLength;
            if (!result.wikipedia.winner) {
              result.wikipedia.winner = imgUrl;
              result.overallWinner = imgUrl;
            }
          } catch (err) {
            tried.downloaded = false;
            tried.error = err instanceof Error ? err.message : String(err);
          }
        }
      } catch (err) {
        tried.error = err instanceof Error ? err.message : String(err);
      }
      result.wikipedia.triedTitles.push(tried);
      if (result.wikipedia.winner) break;
    }
  } catch (err) {
    result.wikipedia.results = [];
    result.wikipedia.triedTitles = [
      { title: "(search threw)", error: err instanceof Error ? err.message : String(err) },
    ];
  }

  // Haiku fallback (only if Wikipedia didn't win)
  if (!result.overallWinner) {
    const fallback: {
      ran: boolean;
      candidates: string[];
      attempts: Array<{
        url: string;
        ok: boolean;
        contentType?: string;
        byteLength?: number;
        error?: string;
      }>;
      winner?: string;
    } = { ran: true, candidates: [], attempts: [] };
    try {
      fallback.candidates = await findCandidateImageUrlsViaHaiku(carName);
    } catch (err) {
      fallback.attempts.push({
        url: "(haiku threw)",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    for (const url of fallback.candidates) {
      try {
        const dl = await downloadImage(url);
        fallback.attempts.push({
          url,
          ok: true,
          contentType: dl.mimeType,
          byteLength: dl.bytes.byteLength,
        });
        if (!fallback.winner) {
          fallback.winner = url;
          result.overallWinner = url;
        }
      } catch (err) {
        fallback.attempts.push({
          url,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    result.haikuFallback = fallback;
  }

  return result;
}
