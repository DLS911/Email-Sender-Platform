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

/**
 * Ask Haiku vision to verify a candidate reference image actually shows
 * the requested car (year + make + model + variant match). Used as a
 * gate between fetching a candidate and using it as the edit input, so
 * a wrong-generation photo from Wikipedia doesn't get shipped as-is.
 *
 * Returns { match: true, reason } if the image visibly matches the
 * requested car. Returns { match: false, reason } if the image is a
 * DIFFERENT year / generation / variant / body style of the same
 * nameplate. Never throws — a Haiku failure returns { match: true,
 * reason: "verifier unavailable, assuming ok" } so the pipeline
 * doesn't stall.
 */
async function verifyCarReferenceMatch(
  bytes: Uint8Array,
  mimeType: string,
  carName: string,
): Promise<{ match: boolean; reason: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { match: true, reason: "verifier disabled (no ANTHROPIC_API_KEY)" };
  try {
    const client = new Anthropic({ apiKey });
    const b64 = Buffer.from(bytes).toString("base64");
    const imageMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 300,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are verifying a car photograph.

Is this photo specifically a ${carName}? Match must be exact on:
- Year and generation (a "2018 Porsche 911 GT3 RS" is the 991.2 generation — the 992-gen shown from 2022 onward is NOT a 2018)
- Nameplate variant (a "McLaren F1 LM" is NOT a standard McLaren F1 — the LM has a wide rear wing, single center exhaust, and matte magnesium wheels)
- Trim / body style (an "M2" is NOT an M4; a "GT3" is NOT a GT3 RS; a "Cayman GT4 RS" is NOT a base Cayman)

Return JSON only: {"match": true, "reason": "brief"} or {"match": false, "reason": "brief description of what the photo actually shows"}. No preamble.`,
            },
            {
              type: "image",
              source: {
                type: "base64",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                media_type: imageMime as any,
                data: b64,
              },
            },
          ],
        },
      ],
    });
    let text = "";
    for (const block of response.content) if (block.type === "text") text += block.text;
    const stripped = text.replace(/```json\s*|\s*```/g, "").trim();
    const first = stripped.indexOf("{");
    const last = stripped.lastIndexOf("}");
    if (first === -1 || last === -1) return { match: true, reason: "no verdict JSON; assuming ok" };
    const parsed = JSON.parse(stripped.slice(first, last + 1)) as { match?: boolean; reason?: string };
    return {
      match: parsed.match !== false,
      reason: parsed.reason ?? "",
    };
  } catch (err) {
    console.warn(
      "car-image.verify_threw",
      err instanceof Error ? err.message : String(err),
    );
    return { match: true, reason: "verifier threw, assuming ok" };
  }
}

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

// ─── Commons category / search — multi-candidate pool ─────────────────

/**
 * Search Wikimedia Commons for image files matching the car name. Returns
 * up to N candidate photos with direct URLs and dimensions. Commons is
 * organized as a media library — search restricted to File: namespace
 * (namespace 6) finds all photos in one query.
 *
 * Why this exists: Wikipedia's infobox image is one static shot per model.
 * For action scenes (panning shots, cornering) we want a reference photo
 * that already shows the car in a matching pose. Commons has 20-100
 * photos per popular model — side profiles, driving shots, static,
 * garage, track. Pull the pool, then pick the pose that matches the scene.
 */
export async function findCommonsCandidateImages(
  carName: string,
  limit = 15,
): Promise<Array<{ title: string; url: string; width?: number; height?: number }>> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", carName);
  url.searchParams.set("gsrnamespace", "6"); // File namespace
  url.searchParams.set("gsrlimit", String(Math.max(5, Math.min(50, limit))));
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|size|mime");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": WIKIPEDIA_UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`commons search: HTTP ${res.status}`);
  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          imageinfo?: Array<{ url?: string; width?: number; height?: number; mime?: string }>;
        }
      >;
    };
  };
  const pages = data.query?.pages ?? {};
  const out: Array<{ title: string; url: string; width?: number; height?: number }> = [];
  for (const key of Object.keys(pages)) {
    const p = pages[key];
    if (!p) continue;
    const info = p.imageinfo?.[0];
    if (!info?.url || !info.mime?.startsWith("image/")) continue;
    if ((info.width ?? 0) < 800) continue;
    const title = (p.title ?? "").toLowerCase();
    // Race-variant filter: Commons hosts road cars and race cars of the
    // same nameplate in the same namespace. A search for "Lexus RC F"
    // returns "File:Lexus RC F GT3 at Suzuka.jpg" alongside real road-
    // car photos. Drop any candidate whose filename indicates a race
    // variant or event; the writer picked a road car, so the reference
    // must be a road car.
    if (
      /\bgt3\b|\bgt4\b|\bgte\b|\blmp1\b|\blmp2\b|\bimsa\b|\bdtm\b|\bwec\b|\bnascar\b|\bindycar\b|\bformula\b|\btouring[ _-]?car\b|\brace[ _-]?car\b|\bracing\b|\brolex\b|\bdaytona\b|\ble[ _-]?mans\b|\bsebring\b|\bnürburgring\b|\bnurburgring\b|\bwatkins[ _-]?glen\b|\bsuzuka\b|\blaguna[ _-]?seca\b|\brallye?\b|\bmotorsport\b|\bpaddock\b/i.test(title)
    ) {
      continue;
    }
    const entry: { title: string; url: string; width?: number; height?: number } = {
      title: p.title ?? "",
      url: info.url,
    };
    if (typeof info.width === "number") entry.width = info.width;
    if (typeof info.height === "number") entry.height = info.height;
    out.push(entry);
  }
  return out;
}

/**
 * Ask Haiku with vision to pick the reference photo that best matches
 * the writer's scene intent. Sends up to 6 candidate URLs (Haiku can
 * fetch and view them) with a short prompt describing the shot type
 * being composed.
 *
 * Returns the URL of the winner, or the first candidate if the vision
 * pass fails.
 */
export async function pickReferenceForScene(
  candidates: Array<{ title: string; url: string }>,
  sceneIntent: string,
): Promise<string> {
  if (candidates.length === 0) throw new Error("pickReference: no candidates");
  if (candidates.length === 1) return candidates[0]!.url;

  const shortlist = candidates.slice(0, 6);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return shortlist[0]!.url;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 300,
      temperature: 0.5, // higher temperature so the picker doesn't lock onto the same pose every time
      system: `You are picking the best reference photo for an editorial car image edit. You will be shown several candidate photos of the same car and a description of the target scene / shot type. Pick the ONE candidate whose POSE and ANGLE best matches what the target scene needs.

**ROAD CAR ONLY.** If any candidate is a race-spec variant (sponsor livery / painted number panels / roll cage visible / racing slicks with no tread / racecar tow strap on the splitter / on a race track paddock), DO NOT pick it — pick a road-going candidate instead. The writer picked a road car; the reference must show the road car, not the GT3/GT4/racing variant of the same nameplate.

CRITICAL PRINCIPLE: The image editing model preserves the reference car's pose. If asked to rotate the car (e.g. reference is a rear view but scene needs to show the front), the model synthesizes the missing angles and DRIFTS AWAY from the correct year/generation. So the reference pose must be COMPATIBLE with what the scene will show.

**Pose types to recognize:**
- **3/4 front** - car angled slightly, showing front + one side. The car's face is prominent.
- **3/4 rear** - car angled the other way, showing rear + one side. The tail lights and rear quarter are prominent.
- **Side profile** - camera perpendicular to car, full flank shown.
- **Direct front** - camera dead-on the nose.
- **Direct rear** - camera dead-on the tail.
- **Action pose** - car photographed while driving (weight transfer, wheels turned).

**Match to scene:**
- Panning-shot / cornering / mid-turn / apex / drifting / motorsport → side profile or action pose.
- Static beauty / parked / showroom / dealership → 3/4 front OR 3/4 rear (both work; pick based on what candidates offer).
- Garage / driveway / arrival scenes → 3/4 front usually reads best.
- Scenic road / mountain / coastal / open highway cruise (car moving but not panning) → 3/4 front usually, but 3/4 rear works for "driving away" framing.

**VARIETY PRINCIPLE:** Do not always pick the same pose type. If two candidates match the scene equally, pick the one with the LESS common angle (side profile or driving-away rear-3/4 over the default 3/4 front). This creates variety across issues so the newsletter doesn't always show the car from the same predictable angle. The reader benefits from seeing the same car from different perspectives across time.

**Tiebreakers when scene is ambiguous:**
- Prefer non-obvious angles when candidates offer variety.
- Prefer clean backgrounds over cluttered ones.
- Prefer photos where the car is prominent (fills 50-70% of the frame) over ones where it's a small element.
- Prefer daylight neutrality (studio, overcast) over strong-directional-sun photos.

Return ONLY the number (1-based index) of the winning candidate. No explanation.`,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Target scene: ${sceneIntent}\n\nCandidate photos (numbered):` },
            ...shortlist.flatMap((c, i) => [
              { type: "text" as const, text: `\n\nCandidate ${i + 1}:` },
              { type: "image" as const, source: { type: "url" as const, url: c.url } },
            ]),
            { type: "text", text: "\n\nReturn only the number of the best-matching candidate." },
          ],
        },
      ],
    });
    let text = "";
    for (const block of response.content) if (block.type === "text") text += block.text;
    const match = text.match(/\d+/);
    if (!match) return shortlist[0]!.url;
    const idx = parseInt(match[0], 10) - 1;
    if (idx < 0 || idx >= shortlist.length) return shortlist[0]!.url;
    return shortlist[idx]!.url;
  } catch (err) {
    console.warn(
      "car-image.vision_pick_failed",
      err instanceof Error ? err.message : String(err),
    );
    return shortlist[0]!.url;
  }
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Overload: if sceneIntent is provided, use the multi-candidate pipeline
 * (Commons search + vision pose picker). Otherwise fall back to the
 * single-infobox path.
 */
export async function fetchCarReferenceImage(
  carName: string,
  sceneIntent?: string,
): Promise<CarReferenceImage> {
  // PRIMARY PATH: Wikipedia REST first. The Wikipedia article for a
  // specific car nameplate has ONE infobox photo which is the canonical
  // press image for the current generation. That's dramatically more
  // accurate than picking from Commons at random — Commons has 20+ M2
  // photos across F87/G87 generations and race variants, and picking
  // by pose alone regularly grabs the wrong generation.
  //
  // We accept the loss of per-issue pose variety for the accuracy gain:
  // the same M2 gets the same canonical Wikipedia photo every time, and
  // Gemini rewrites the background/lighting. Austin's explicit priority:
  // "just find the wiki version and change the bg."
  // Track the best-effort candidate across all paths so we ship
  // something even if nothing verifies clean.
  let fallbackCandidate: CarReferenceImage | null = null;

  try {
    const wiki = await fetchFromWikipedia(carName);
    if (wiki) {
      const verdict = await verifyCarReferenceMatch(wiki.bytes, wiki.mimeType, carName);
      if (verdict.match) {
        console.info("car-image.wiki_primary_hit_verified", { car: carName, source: wiki.sourceUrl, reason: verdict.reason });
        return wiki;
      }
      console.warn("car-image.wiki_primary_rejected_by_verifier", { car: carName, source: wiki.sourceUrl, reason: verdict.reason });
      fallbackCandidate = wiki;
    } else {
      console.info("car-image.wiki_primary_miss", { car: carName });
    }
  } catch (err) {
    console.error(
      "car-image.wiki_primary_threw",
      err instanceof Error ? err.message : String(err),
    );
  }

  // SECONDARY: Commons multi-candidate. Try each candidate and verify.
  if (sceneIntent) {
    try {
      const candidates = await findCommonsCandidateImages(carName, 15);
      for (const cand of candidates.slice(0, 5)) {
        try {
          const dl = await downloadImage(cand.url, WIKIPEDIA_UA);
          const verdict = await verifyCarReferenceMatch(dl.bytes, dl.mimeType, carName);
          if (verdict.match) {
            console.info("car-image.commons_hit_verified", { car: carName, picked: cand.url, reason: verdict.reason });
            return {
              bytes: dl.bytes,
              mimeType: dl.mimeType,
              sourceUrl: cand.url,
              searchQuery: `commons+verify:${carName}`,
            };
          }
          console.info("car-image.commons_candidate_rejected", { car: carName, url: cand.url, reason: verdict.reason });
          if (!fallbackCandidate) {
            fallbackCandidate = {
              bytes: dl.bytes,
              mimeType: dl.mimeType,
              sourceUrl: cand.url,
              searchQuery: `commons+fallback:${carName}`,
            };
          }
        } catch (err) {
          console.warn(
            "car-image.commons_candidate_download_failed",
            cand.url,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      if (candidates.length === 0) console.info("car-image.commons_no_candidates", { car: carName });
    } catch (err) {
      console.warn(
        "car-image.commons_path_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // TERTIARY: Haiku web_search — fires when Wikipedia/Commons couldn't
  // give us a verified match. Explicitly searches for the specific
  // year/variant string and verifies each candidate against the
  // requested car.
  console.info("car-image.falling_back_to_haiku_websearch", { car: carName });
  const candidates = await findCandidateImageUrlsViaHaiku(carName);
  const errors: string[] = [];
  for (const url of candidates) {
    try {
      const dl = await downloadImage(url);
      const verdict = await verifyCarReferenceMatch(dl.bytes, dl.mimeType, carName);
      if (verdict.match) {
        console.info("car-image.haiku_hit_verified", { car: carName, url, reason: verdict.reason });
        return {
          bytes: dl.bytes,
          mimeType: dl.mimeType,
          sourceUrl: url,
          searchQuery: `haiku+verify:${carName}`,
        };
      }
      console.info("car-image.haiku_candidate_rejected", { car: carName, url, reason: verdict.reason });
      if (!fallbackCandidate) {
        fallbackCandidate = {
          bytes: dl.bytes,
          mimeType: dl.mimeType,
          sourceUrl: url,
          searchQuery: `haiku+fallback:${carName}`,
        };
      }
    } catch (err) {
      errors.push(`${url.slice(0, 60)}… : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Final fallback: nothing verified clean. Ship the best-effort
  // candidate we saw along the way so the pipeline doesn't throw, and
  // log loudly so Austin sees a "shipped unverified reference" line
  // in the logs.
  if (fallbackCandidate) {
    console.warn("car-image.shipped_unverified_fallback", {
      car: carName,
      source: fallbackCandidate.sourceUrl,
      searchQuery: fallbackCandidate.searchQuery,
    });
    return fallbackCandidate;
  }
  throw new Error(
    `car-image: Wikipedia + Commons + Haiku all returned zero candidates for "${carName}"; errors: ${errors.slice(0, 3).join(" | ")}`,
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
