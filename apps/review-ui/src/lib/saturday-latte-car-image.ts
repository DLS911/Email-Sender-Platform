/**
 * Reference-image lookup for the theDrive slot, powered by Anthropic
 * Haiku with the web_search tool.
 *
 * Why this exists: text-only prompting cannot force Gemini 2.5 Flash
 * Image off its baseline concept of a nameplate (repeated failure: 2024
 * M2 G87 rendering as a 2020-era F87 body). Fix: fetch a real press
 * photo of the correct year+generation and hand it to Gemini as a
 * reference input alongside the editorial-setting prompt.
 *
 * How this fetches: Haiku with web_search searches the web for press
 * photos of the exact year/generation named in the car string, then
 * returns 3-5 candidate direct image URLs as JSON. We fetch each in
 * order and use the first that downloads as an image. If all fail (or
 * Haiku returns nothing usable), the caller falls back to text-only
 * Gemini so the issue still ships.
 *
 * Uses only ANTHROPIC_API_KEY — no new credentials needed.
 */

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1500;
const WEB_SEARCH_MAX_USES = 3;

export type CarReferenceImage = {
  bytes: Uint8Array;
  mimeType: string;
  sourceUrl: string;
  searchQuery: string;
};

/**
 * Ask Haiku (with web_search) for candidate direct-image URLs for the
 * named car. Returns a list of URLs Haiku thinks are correct — we do
 * not trust every URL to be an image; the caller must download and
 * validate.
 */
async function findCandidateImageUrls(carName: string): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("car-image: ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey });

  const system = `You are a car reference image finder for a newsletter's "The Drive" section. Given a specific year and generation of a car, you use the web_search tool to find real press photos of THAT EXACT generation (not earlier or later ones) and return 3-5 candidate direct image URLs.

Priorities in order:
1. Manufacturer press site images (bmwgroup.com, press.porsche.com, media.audi.com, media.mercedesbenz.com, media.toyota.com, media.ford.com, etc.) — these are always accurate and licensed for editorial use.
2. Wikimedia Commons file URLs (upload.wikimedia.org/wikipedia/commons/...) — always free to use, well-labeled with generation info.
3. Reputable automotive publication photos (Car and Driver, MotorTrend, Autoblog, Autoweek, Road & Track) — accurate but check the caption for generation.

CRITICAL RULES:
- The URL must be a DIRECT image file URL — ending in .jpg, .jpeg, .png, .webp, or hosted on an image CDN. Not a webpage URL. If the search result is a page, check whether the page has a direct image URL you can extract.
- The image must match the EXACT year and generation named. A 2024 BMW M2 G87 is NOT a 2020 M2 F87. If the search only turns up the wrong generation, keep searching — do not settle.
- Front three-quarter view is preferred (car angled slightly toward the camera, showing front + one side). Side profile is acceptable. Rear-only shots are not.
- Prefer clean backgrounds (studio, road, mountain, showroom) over cluttered ones.

Return ONLY a JSON object of this exact shape, no preamble or markdown fence:
{"candidates": ["https://...jpg", "https://...png", "https://..."]}

If you truly cannot find any usable image URLs after searching, return {"candidates": []}.`;

  const userMessage = `Find 3-5 candidate direct image URLs for a press photo of this exact car:

${carName}

Front three-quarter view preferred. Must match the EXACT year and generation. Search aggressively — run multiple web_search calls if the first pass returns thin results.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
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
    messages: [{ role: "user", content: userMessage }],
  });

  let textOutput = "";
  for (const block of response.content) {
    if (block.type === "text") {
      textOutput += block.text;
    }
  }
  if (!textOutput) return [];

  // Extract the JSON object from Haiku's response. It sometimes wraps in
  // markdown fences even when told not to; strip those defensively.
  const stripped = textOutput.replace(/```json\s*|\s*```/g, "").trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return [];
  const jsonText = stripped.slice(firstBrace, lastBrace + 1);

  try {
    const parsed = JSON.parse(jsonText) as { candidates?: unknown };
    if (!Array.isArray(parsed.candidates)) return [];
    return parsed.candidates
      .filter((c): c is string => typeof c === "string" && c.trim() !== "")
      .map((c) => c.trim());
  } catch {
    return [];
  }
}

/**
 * Download a candidate URL. Rejects non-image content-types so a page
 * URL that Haiku mistook for a direct-image URL is skipped instead of
 * being fed to Gemini as garbage.
 */
async function downloadImage(imageUrl: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(imageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CastorAbbottLatte/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`car-image: download HTTP ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const mimeType = contentType.split(";")[0]?.trim() ?? "";
  if (!mimeType.startsWith("image/")) {
    throw new Error(`car-image: non-image content-type "${contentType}"`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 5000) {
    // Reject tiny thumbnails / empty responses (< ~5KB). Real press
    // photos are hundreds of KB at minimum.
    throw new Error(`car-image: image too small (${buf.byteLength} bytes)`);
  }
  return { bytes: new Uint8Array(buf), mimeType };
}

/**
 * Public: fetch a reference photo for the car. Tries the candidate URLs
 * Haiku found in order; returns the first that downloads successfully as
 * an image. If all fail, throws — the caller falls back to text-only
 * Gemini generation for this issue.
 */
export async function fetchCarReferenceImage(carName: string): Promise<CarReferenceImage> {
  const candidates = await findCandidateImageUrls(carName);
  if (candidates.length === 0) {
    throw new Error(`car-image: Haiku returned no candidates for "${carName}"`);
  }

  const errors: string[] = [];
  for (const url of candidates) {
    try {
      const dl = await downloadImage(url);
      return {
        bytes: dl.bytes,
        mimeType: dl.mimeType,
        sourceUrl: url,
        searchQuery: carName,
      };
    } catch (err) {
      errors.push(`${url.slice(0, 60)}… : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(
    `car-image: all ${candidates.length} candidates failed. errors: ${errors.slice(0, 3).join(" | ")}`,
  );
}
