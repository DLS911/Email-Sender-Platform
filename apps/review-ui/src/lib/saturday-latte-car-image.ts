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

  const system = `You are a car reference image finder for a newsletter's "The Drive" section. Given a specific year and generation of a car, you use the web_search tool to find factory-spec photos of that generation and return 3-5 candidate direct image URLs.

**PREFERRED sources** (any of these are strong candidates):
- Wikimedia Commons file URLs (upload.wikimedia.org/wikipedia/commons/...) — the fastest reliable path; almost every current production car has factory-spec photos on Commons.
- Wikipedia article infobox images — typically hosted on Wikimedia Commons via the model's Wikipedia page.
- Manufacturer press / media sites: media.audi.com, audi-mediacenter.com, press.bmwgroup.com, bmwgroup.com, press.porsche.com, presse.porsche.com, newsroom.porsche.com, media.mercedesbenz.com, media.mbusa.com, media.lexus.com, pressroom.lexus.com, media.toyota.com, media.ford.com, media.gm.com, chevrolet.com/newsroom, honda-news.com, hondanews.com, mazdausa.com, media.stellantisnorthamerica.com, corporate.ferrari.com, media.jaguarlandrover.com, media.mclaren.com.
- Reputable automotive journalism sites where the caption confirms the car is factory-spec: Car and Driver, MotorTrend, Road & Track, Autoblog, Autoweek, Top Gear. Use these when Wikimedia and manufacturer sites don't have the specific model — accept a Car and Driver first-drive review photo of the correct year, since those cars are always press-fleet factory-spec.

**REJECT these sources** (do NOT return URLs from them):
- Enthusiast forums (bimmerforums, rennlist, audiworld, e46fanatics, mustang6g, etc.) — cars are usually owner-modified.
- Tuner / builder / wheel-shop sites (APR, ABT, HRE Wheels, Vorsteiner, Alpina, Ruf, Prior Design, Mansory, Liberty Walk, Rocket Bunny, JTC, etc.) — always modified.
- Used-car listings (Cars.com, Autotrader, CarGurus, Bring a Trailer) — often owner-modified.
- Random photo aggregators, Pinterest, Instagram — provenance unclear.

**Critical accuracy rules:**
- The reference must show the car as it left the factory — no aftermarket wheels, widebody kits, lowered suspension, aftermarket exhausts, wraps, or spoilers.
- The image must match the EXACT year and generation named. A 2024 BMW M2 G87 is NOT a 2020 M2 F87.
- Front three-quarter view is preferred; side profile or rear three-quarter is acceptable; straight-on front or straight-on rear is not.
- The URL must be a DIRECT image file URL — ending in .jpg, .jpeg, .png, .webp, or hosted on an image CDN.
- Prefer clean backgrounds (studio, empty road, mountain, showroom) over cluttered ones.

Return ONLY a JSON object of this exact shape, no preamble or markdown fence:
{"candidates": ["https://...jpg", "https://...png", "https://..."]}

Return at least 3 candidates if the car exists — Wikimedia + one manufacturer + one press site is a great mix. Only return an empty array if the car genuinely cannot be located anywhere with a factory-spec image.`;

  const userMessage = `Find 3-5 candidate direct image URLs for a factory-spec photo of this exact car:

${carName}

Requirements:
- Factory-spec only — no modified / tuner / widebody / lowered / aftermarket-wheel examples.
- Preferred sources: Wikimedia Commons, Wikipedia infobox images, manufacturer press/media sites. Reputable automotive journalism sites (Car and Driver, MotorTrend, Road & Track, Autoblog) are also acceptable if the car in the photo is factory-spec.
- Front three-quarter view preferred; side profile or rear three-quarter acceptable.
- Must match the EXACT year and generation.

Fast-path search strategy:
1. Start with Wikimedia: search "[car name] site:wikimedia.org" or "[car name] site:en.wikipedia.org" — the Wikipedia model page almost always has a good factory infobox image.
2. If Wikipedia doesn't have the exact model year, try the manufacturer press site.
3. If neither has it, try "[car name] press photo" or "[car name] first drive" from Car and Driver / MotorTrend / Road & Track.

Return at least 3 candidates from different sources when possible. If you find only modified examples, keep searching — do not return them. But do not return an empty array unless the car genuinely doesn't exist online.`;

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

/**
 * Diagnostic sibling of fetchCarReferenceImage. Runs the full lookup
 * but returns structured diagnostic info instead of just the winning
 * image bytes. Used by /api/admin/debug-car-image to understand why
 * lookups are failing in prod.
 */
export async function diagnoseCarReferenceLookup(carName: string): Promise<{
  carName: string;
  searchQuery: string;
  candidates: string[];
  attempts: Array<{
    url: string;
    ok: boolean;
    contentType?: string;
    byteLength?: number;
    error?: string;
  }>;
  winner?: string;
  haikuError?: string;
}> {
  const result: {
    carName: string;
    searchQuery: string;
    candidates: string[];
    attempts: Array<{
      url: string;
      ok: boolean;
      contentType?: string;
      byteLength?: number;
      error?: string;
    }>;
    winner?: string;
    haikuError?: string;
  } = {
    carName,
    searchQuery: buildQuery(carName),
    candidates: [],
    attempts: [],
  };

  let candidates: string[] = [];
  try {
    candidates = await findCandidateImageUrls(carName);
  } catch (err) {
    result.haikuError = err instanceof Error ? err.message : String(err);
    return result;
  }
  result.candidates = candidates;

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CastorAbbottLatte/1.0)" },
        redirect: "follow",
      });
      const contentType = res.headers.get("content-type") ?? "";
      const attempt: {
        url: string;
        ok: boolean;
        contentType?: string;
        byteLength?: number;
        error?: string;
      } = {
        url,
        ok: false,
        contentType,
      };
      if (!res.ok) {
        attempt.error = `HTTP ${res.status}`;
      } else if (!contentType.startsWith("image/")) {
        attempt.error = "non-image content-type";
      } else {
        const buf = await res.arrayBuffer();
        attempt.byteLength = buf.byteLength;
        if (buf.byteLength < 5000) {
          attempt.error = "too small (<5KB)";
        } else {
          attempt.ok = true;
          if (!result.winner) result.winner = url;
        }
      }
      result.attempts.push(attempt);
    } catch (err) {
      result.attempts.push({
        url,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

function buildQuery(carName: string): string {
  return `${carName.replace(/[()]/g, "").trim()} press photo`;
}
