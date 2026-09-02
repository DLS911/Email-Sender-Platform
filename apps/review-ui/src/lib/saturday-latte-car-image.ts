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
/**
 * Independent binary vision check. Runs AFTER the main verifier as a
 * defense-in-depth layer. Asks Haiku one question with fresh eyes:
 * "does this image show the whole exterior of a car?" If no, we
 * reject regardless of the main verifier's verdict. Catches cases
 * where the main verifier gets talked into a false positive on a
 * suspension close-up or interior shot.
 */
async function isPhotoOfWholeCar(
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ ok: boolean; reason: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: true, reason: "second-pass disabled" };
  try {
    const client = new Anthropic({ apiKey });
    const b64 = Buffer.from(bytes).toString("base64");
    const imageMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 120,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Look at this image. FIVE checks must ALL pass for ok=true:

1) Does this image show the WHOLE EXTERIOR of a road-going car (all four wheels or nearly so, full body from roof to sills, no cropping that removes the front or rear)?

2) Is the car STATIONARY / PARKED? Panning shots, driving-past shots, rolling shots, motion-blurred wheels, streaking road under the car, blurred background from a moving camera — ALL FAIL. The image must be a clean static reference: parked car, sharp wheels, no directional motion blur, no visible speed lines. A perfectly still car on a road / dealership / studio / driveway = pass. A car mid-corner with blurred wheels = fail. Auto-generated / glitched-looking wheel spokes or shifted body panels also fail (Gemini output rather than a real photo).

3) Are the car's PROPORTIONS NATURAL? Wide-angle / fisheye / ultra-close lens shots stretch the front (or rear) grotesquely — a nose that looks 1.5x longer than reality, a hood that curves toward the camera, wheels that look tiny relative to a bulging fascia. Photographer's stylistic distortion IS an AI trap: Gemini uses these as reference and inherits the stretched geometry. FAIL any shot where the front OR rear of the car is visibly foreshortened / bulging / wide-angle-warped. The reference must be a natural-perspective photograph (roughly 50mm equivalent or a mild telephoto) where the car's proportions look correct at first glance — front-end length matches the marque's actual proportions, no rubber-band stretch.

4) IS THERE ONLY ONE CAR IN THE FRAME? The reference must show ONE car — nothing else. Group shots (two cars parked side-by-side at a dealership, concours line-ups with 3+ cars in view, a car alongside a truck / SUV / motorcycle, a car being trailered behind another vehicle, a rally paddock with other race cars in the frame) — ALL FAIL. If a second complete or partial car is visible ANYWHERE in the frame (background parking lot with parked cars visible, another car in the mirror or reflection, a car behind or beside the subject), FAIL. Gemini renders whatever is in the reference; two cars in → two cars out. Passing shots have ONE isolated car with no other vehicles in view (an empty road, an empty parking lot, a studio backdrop, a garage doorway, a driveway with nothing else in frame).

5) IS THE ANGLE A STANDARD EDITORIAL VIEW? The reference must be one of: clean 3/4 front, clean 3/4 rear, direct side profile, direct front (12 o'clock), direct rear (6 o'clock), or slight-low hero angle. FAIL: overhead / top-down / drone shots that look at the roof, extreme low-angle "ground worm" shots looking up under the car, oblique 45-degree tilt-corner shots, shots from behind another car in traffic. If you can't identify the angle as one of the standard editorial views, FAIL.

Return {"ok": true, "reason": "brief"} if ALL pass. Return {"ok": false, "reason": "what it actually is — e.g. 'two cars in frame', 'group shot with other vehicles', 'overhead drone angle', 'wide-angle front stretch', 'fisheye distortion', 'foreshortened nose', 'motion blur', 'wheels blurred from movement', 'glitched wheel spokes', 'suspension close-up', 'engine bay only', 'interior shot', 'wheel detail', 'headlight only'"} if any fails. No preamble.`,
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
    if (first === -1 || last === -1) return { ok: true, reason: "no JSON; assuming ok" };
    const parsed = JSON.parse(stripped.slice(first, last + 1)) as { ok?: boolean; reason?: string };
    return { ok: parsed.ok !== false, reason: parsed.reason ?? "" };
  } catch (err) {
    console.warn(
      "car-image.second_pass_threw",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: true, reason: "second-pass threw, assuming ok" };
  }
}

async function verifyCarReferenceMatch(
  bytes: Uint8Array,
  mimeType: string,
  carName: string,
  _sceneIntent?: string,
): Promise<{ match: boolean; reason: string }> {
  // Reference is ALWAYS a parked / stationary shot. One good parked
  // reference gets reused for any edit — Gemini handles the "make it
  // drive" transformation from a parked reference just fine, and this
  // way we never waste time / API cost fetching multiple references.
  const staticGate = `

3) STATIC POSE — REQUIRED. The reference must show the car PARKED / STATIONARY. Photos with motion blur on the wheels, streaking road, rolling / driving pose, panning shots — all FAIL. We need a clean static / dealership / configurator / studio shot where the wheels are sharp and the car isn't moving. If the image shows any motion blur, FAIL.`;
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
              text: `You are verifying a car reference photograph. It will be used as the base image for a background/lighting edit, so it needs to show the WHOLE car clearly.

THREE checks must ALL pass for match=true:

0) IT IS AN ACTUAL PHOTOGRAPH OF A CAR. If the image is a company/brand logo (e.g. "BMW Group" wordmark, a Porsche crest on white background), a chart/infographic, a magazine cover with mostly text and no full-car photo, a rendering that isn't a real photograph, or ANY image where a car is not the primary photographic subject — FAIL immediately.

1) EXACT MATCH TO REQUESTED CAR: is this photo specifically a ${carName}?
   - Year and generation (a "2018 Porsche 911 GT3 RS" is the 991.2 generation — the 992-gen shown from 2022 onward is NOT a 2018)
   - Nameplate variant (a "McLaren F1 LM" has a wide rear wing, single center exhaust, and matte magnesium wheels — the standard F1 does NOT)
   - Trim / body style (M2 ≠ M4, GT3 ≠ GT3 RS, Cayman GT4 RS ≠ base Cayman)

2) FULL-CAR EXTERIOR COMPOSITION — STRICT. The photo must show the WHOLE car FROM OUTSIDE. All of these must be true for pass:
   (a) At least 3 of the 4 wheels are clearly visible in the frame.
   (b) The full exterior body outline is in-frame from roofline down to the sills — no cropping of the roof, no cropping of the rocker panels, no cropping that cuts off the front OR rear of the car.
   (c) You can identify the CAR AS A WHOLE — not just one component of it.
   Failing shots — ALL of these AUTOMATICALLY FAIL:
   - Suspension close-up, undercarriage shot, chassis-only, subframe photo, control-arm detail
   - Engine bay, transmission, exhaust-only shot, brake caliper close-up
   - Interior / dashboard / gauge cluster / steering wheel / seat detail
   - Headlight, taillight, badge, logo, mirror, door-handle close-ups
   - Rear-wing-only close-up, bumper-only, wheel/tire close-up
   - Front-fender-only crop, quarter-panel-only shot
   - Cutaway / X-ray / technical diagram
   - Any tight crop that shows less than 60% of the exterior body
   Passing shots: 3/4 front, 3/4 rear, side profile, direct front, direct rear, low-angle hero — as long as the WHOLE exterior of the car is in the frame with 3+ wheels visible and you can identify it as a car at first glance.${staticGate}

Return JSON only: {"match": true, "reason": "brief"} or {"match": false, "reason": "brief description of the failure — wrong year / wrong variant / detail shot only / etc"}. No preamble.`,
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

/**
 * Two-step web-scraped image finder:
 *   Step 1 — Haiku web_search returns PAGE URLs (reviews, press releases,
 *            gallery pages) for the target car. Very view-specific
 *            queries per scene intent.
 *   Step 2 — Fetch each page's HTML, parse <img> tags, filter for
 *            likely content images (not icons/logos/ads).
 * Returns raw image URLs to be verified downstream. Anthropic's
 * web_search does NOT typically return direct image URLs; page-scraping
 * is how we get to real hero shots from the sites that host them.
 */
async function findWebPagesForCar(
  carName: string,
  _sceneIntent?: string,
): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  const client = new Anthropic({ apiKey });
  // Always parked / static / studio / configurator shots. Emphasize
  // 3/4 angles over pure profile or pure frontal — 3/4 is the hero
  // angle for editorial car photography. Vary the queries per call
  // via random selection so we don't always land on the same top
  // result.
  const allViews = [
    `${carName} 3/4 front press photo full car`,
    `${carName} 3/4 rear press photo full car`,
    `${carName} 3/4 hero press photo`,
    `${carName} 3/4 angle beauty shot`,
    `${carName} 3/4 front dealer photo`,
    `${carName} 3/4 rear studio press photo`,
    `${carName} configurator angled hero shot`,
    `${carName} press photo three quarter view`,
  ];
  // Shuffle and take 4 — different query set per generation so we
  // reach different photos across runs.
  const shuffled = allViews.map((v) => ({ v, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.v);
  const viewList = shuffled.slice(0, 4);

  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1200,
      temperature: 0.1,
      system: `You find PAGE URLs (not direct image URLs) using web_search. Each page must be a page that likely contains full-car SOLO-CAR press/gallery photos of the requested car — a manufacturer press release with a gallery, a review article with hero images, an automotive-journalism gallery page.

Return 8-12 page URLs. Bias STRONGLY toward manufacturer press sites (they publish clean solo-car studio + configurator shots) and toward review pages that are single-car-focused. Prefer, in this order:
- Manufacturer press sites: press.bmwgroup.com, media.porsche.com, media.audi.com, mercedes-benz.com/en/press, media.ford.com, media.gm.com, media.stellantis.com, media.mclaren.com, mclaren.com, aston-martin.com, media.bentleymotors.com, jaguar-mena.com/en-me/press-releases, landrover.com, ferrari.com/en-US/auto, lamborghini.com, mediacenter.polestar.com, media.mazda.com, toyota-europe.com/newsroom, honda.com/newsroom, nissannews.com, hyundainews.com, kianewscenter.com, subarunews.com, mitsubishi-motors.com/en/newsrelease
- Manufacturer official model pages: bmw.com, porsche.com, audi.com, mercedes-benz.com, ford.com, chevrolet.com, cadillac.com, corvette.com, mazda.com, subaru.com, lexus.com, acura.com, infiniti.com — the specific model's product page has hero photography
- Reviews: caranddriver.com, motortrend.com, roadandtrack.com, autoblog.com, autoweek.com, topgear.com, autocar.co.uk, thedrive.com, hagerty.com/media, hagerty.com/valuation
- Auction/broker galleries for classics (solo-car photography is the norm): bringatrailer.com, cars.bonhams.com, rmsothebys.com, gooding.com, mecum.com, hemmings.com

Reject: enthusiast forums, Reddit, Instagram, Pinterest, stock-photo sites, generic dealer lot pages, used-car listings, "top 10 lists" pages that show a grid of different cars, auction result index pages, ANY page whose thumbnail suggests a group shot or a car alongside another vehicle.

Return ONLY JSON:
{"pages": ["https://...", "https://..."]}`,
      tools: [
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: "web_search_20260209" as any,
          name: "web_search",
          max_uses: 6,
          allowed_callers: ["direct"],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
      messages: [
        {
          role: "user",
          content: `Find 6-10 review / gallery / press-release PAGE URLs for the car: ${carName}.

Run web_search for each of these queries:
1. ${viewList[0]}
2. ${viewList[1]}
3. ${viewList[2]}
4. ${viewList[3]}

Return the page URLs (not image URLs) that most likely contain full-car hero photos.`,
        },
      ],
    });
    let text = "";
    for (const block of response.content) if (block.type === "text") text += block.text;
    const stripped = text.replace(/```json\s*|\s*```/g, "").trim();
    const first = stripped.indexOf("{");
    const last = stripped.lastIndexOf("}");
    if (first === -1 || last === -1) return [];
    const parsed = JSON.parse(stripped.slice(first, last + 1)) as { pages?: unknown };
    if (!Array.isArray(parsed.pages)) return [];
    return parsed.pages
      .filter((p): p is string => typeof p === "string" && (p.startsWith("http://") || p.startsWith("https://")))
      .map((p) => p.trim());
  } catch (err) {
    console.warn(
      "car-image.find_pages_failed",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * Fetch a web page, parse its HTML, and return candidate image URLs
 * that look like content images (not icons, logos, ads, tracking).
 * Returns up to `limit` URLs, resolved to absolute form.
 *
 * Best-effort: on fetch failure / 403 / non-HTML content, returns [].
 */
export async function extractImageUrlsFromPage(pageUrl: string, limit = 8): Promise<string[]> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return [];
    const html = await res.text();
    const finalUrl = res.url || pageUrl;
    const baseUrl = new URL(finalUrl);

    const urls = new Set<string>();
    // Match <img src="..."> AND srcset variants + og:image / twitter:image meta tags
    const patterns: RegExp[] = [
      /<img[^>]+src=["']([^"']+)["']/gi,
      /<img[^>]+data-src=["']([^"']+)["']/gi,
      /<img[^>]+data-lazy-src=["']([^"']+)["']/gi,
      /<source[^>]+srcset=["']([^"'\s]+)/gi,
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const raw = m[1];
        if (!raw) continue;
        try {
          const abs = new URL(raw, baseUrl).toString();
          urls.add(abs);
        } catch {
          // ignore malformed URLs
        }
      }
    }

    const skipPatterns =
      /\b(icon|favicon|logo|avatar|badge|sprite|placeholder|pixel|1x1|spacer|blank|nav|header|footer|ads?|advert|banner|tracking|analytics|beacon|doubleclick|googlesyndication|gtag|facebook\.com\/tr|linkedin\.com\/px|amazon-adsystem|scorecardresearch|newrelic|segment|mixpanel|gravatar)\b/i;
    const preferredExtensions = /\.(jpe?g|png|webp)(?:[?#]|$)/i;

    const candidates = Array.from(urls).filter((u) => {
      if (skipPatterns.test(u)) return false;
      if (!preferredExtensions.test(u)) return false;
      // Reject obvious small thumbnails
      if (/\b(50x50|75x75|100x100|150x150|200x200|250x250|300x300|_thumb|_small|_icon|_avatar|-thumbnail-|-mini-|-small-)\b/i.test(u)) return false;
      // Reject URLs that specify small explicit widths in query strings
      const wMatch = u.match(/[?&](?:w|width|resize)=(\d+)/i);
      if (wMatch && parseInt(wMatch[1] ?? "0", 10) < 800) return false;
      // Reject URLs with size-suffix patterns like -400x300 (below 800)
      const sizeSuffix = u.match(/-(\d+)x(\d+)\.(?:jpe?g|png|webp)/i);
      if (sizeSuffix) {
        const w = parseInt(sizeSuffix[1] ?? "0", 10);
        const h = parseInt(sizeSuffix[2] ?? "0", 10);
        if (Math.max(w, h) < 800) return false;
      }
      return true;
    });

    // Score: strongly prefer high-res / hero indicators
    const score = (u: string): number => {
      let s = 0;
      // Big-width hints in URL (2560, 1920, 1600, 1200)
      if (/\b2560\b|\b1920\b|\b1600\b|\b1200\b/i.test(u)) s += 10;
      if (/\b(hero|lead|main|featured|large|xl|gallery)\b/i.test(u)) s += 6;
      if (/\b(photo|image|IMG_|DSC_)\b/i.test(u)) s += 3;
      if (/press|media/i.test(u)) s += 4;
      if (u.includes("/uploads/") || u.includes("/wp-content/")) s += 1;
      // Bonus if a size suffix like -1920x1080 shows big dimensions
      const sizeSuffix = u.match(/-(\d+)x(\d+)\.(?:jpe?g|png|webp)/i);
      if (sizeSuffix) {
        const maxDim = Math.max(parseInt(sizeSuffix[1] ?? "0", 10), parseInt(sizeSuffix[2] ?? "0", 10));
        if (maxDim >= 1600) s += 8;
        else if (maxDim >= 1200) s += 5;
        else if (maxDim >= 1000) s += 2;
      }
      // Penalize very long query-string variants that suggest resized
      if (u.length > 400) s -= 2;
      return s;
    };
    candidates.sort((a, b) => score(b) - score(a));

    return candidates.slice(0, limit);
  } catch {
    return [];
  }
}

async function findCandidateImageUrlsViaHaiku(
  carName: string,
  _sceneIntent?: string,
): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("car-image: ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey });

  // Derive preferred view from scene intent. Driving scenes want action /
  // 3/4 front pan references; static scenes want a hero 3/4 front or side
  // profile. Reference pose should match the target so Gemini doesn't
  // have to invent a new pose (which is when it regenerates and drifts).
  // 3/4-emphasized queries with shuffled selection for variety.
  const allViews = [
    `${carName} 3/4 front hero press photo`,
    `${carName} 3/4 rear press photo`,
    `${carName} 3/4 angle studio`,
    `${carName} press photo three quarter front`,
    `${carName} press photo three quarter rear`,
    `${carName} configurator angled hero shot`,
  ];
  const shuffled = allViews.map((v) => ({ v, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.v);
  const viewList = shuffled.slice(0, 4);

  const system = `You find direct image URLs for a very specific year+generation+trim of a car. Use the web_search tool.

**RUN MULTIPLE SEARCHES. Do NOT stop after one search.** You will be given a list of 4 specific-view queries. Run each one until you have collected direct-image URLs from all of them.

**Do NOT hallucinate URLs.** Only return URLs that appeared verbatim in web_search results. If you did not see the URL in a search result, do not include it.

Every candidate MUST be:
- The WHOLE car in frame — NOT a detail crop of a wing, wheel, bumper, interior, engine bay, badge, headlight. All (or almost all) four wheels visible AND the full body outline (roofline to sills) visible.
- The EXACT year/gen/variant requested.
- A press photo or high-quality journalism photo — factory-spec, not a modified/tuner example.

Preferred sources: press.bmwgroup.com, media.porsche.com, media.audi.com, media.ford.com, media.gm.com, media.toyota.com, media.stellantis.com, media.mclaren.com, Car and Driver, MotorTrend, Road & Track, Autoblog, Autoweek, Top Gear, Autocar.

Reject: enthusiast forums, tuner sites, Instagram, Pinterest, used-car listings, stock-photo sites, detail-shot crops, interior shots, engine-bay shots.

The URL must be a DIRECT image file URL (.jpg, .jpeg, .png, .webp) that appeared as an actual result in a search — NOT a page URL you assume contains an image.

Return ONLY JSON:
{"candidates": ["https://...jpg", "..."]}

Return 6-10 candidates covering different angles. Empty array is only OK if truly no real full-car press URLs surfaced.`;

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1500,
    temperature: 0.1,
    system,
    tools: [
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: "web_search_20260209" as any,
        name: "web_search",
        max_uses: 6,
        allowed_callers: ["direct"],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ],
    messages: [
      {
        role: "user",
        content: `Find 6-10 direct image URLs of the FULL CAR for a factory-spec press photo of: ${carName}.

Run web_search for EACH of these specific-view queries:
1. ${viewList[0]}
2. ${viewList[1]}
3. ${viewList[2]}
4. ${viewList[3]}

Return all real direct-image URLs you find across those searches. URLs must appear verbatim in the search results — no guessing, no constructing.`,
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
  // NEW ORDER (Austin: "stop using wiki. very specific searches. verify
  // it's the full car"):
  // 1. WEB SEARCH FIRST — Haiku web_search with year+gen+full-car query,
  //    verify each result for correct model AND full-car composition.
  // 2. Wikipedia only if web search returns nothing.
  // 3. Commons multi-candidate as last resort.
  //
  // Track best-effort fallback across paths so we ship something even
  // if nothing verifies clean.
  let fallbackCandidate: CarReferenceImage | null = null;
  const errors: string[] = [];

  // 1) PAGE-SCRAPE PRIMARY. Web-search returns article/gallery/press
  // page URLs → we fetch each page and pull image URLs from its HTML
  // → verify each. Anthropic web_search does NOT return direct .jpg
  // URLs; this two-step is how we reach real hero shots that live on
  // Car and Driver, MotorTrend, media.porsche.com, etc.
  try {
    const pageUrls = await findWebPagesForCar(carName, sceneIntent);
    console.info("car-image.pages_found", { car: carName, count: pageUrls.length });
    const imageUrls: string[] = [];
    for (const page of pageUrls.slice(0, 8)) {
      const extracted = await extractImageUrlsFromPage(page, 6);
      for (const u of extracted) if (!imageUrls.includes(u)) imageUrls.push(u);
      if (imageUrls.length >= 20) break;
    }
    console.info("car-image.images_extracted_from_pages", { car: carName, count: imageUrls.length });
    // Shuffle the top ~12 candidates before verifying so we don't
    // always test (and settle on) the same top-scored URL every call.
    // Adds view variety across runs of the same car.
    const shuffledUrls = imageUrls.slice(0, 12).map((u) => ({ u, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.u);
    for (const url of shuffledUrls) {
      try {
        const dl = await downloadImage(url, BROWSER_UA);
        const verdict = await verifyCarReferenceMatch(dl.bytes, dl.mimeType, carName, sceneIntent);
        if (verdict.match) {
          const second = await isPhotoOfWholeCar(dl.bytes, dl.mimeType);
          if (!second.ok) {
            verdict.match = false;
            verdict.reason = `second-pass rejected: ${second.reason}`;
          }
        }
        if (verdict.match) {
          console.info("car-image.scraped_hit_verified", { car: carName, url, reason: verdict.reason });
          return {
            bytes: dl.bytes,
            mimeType: dl.mimeType,
            sourceUrl: url,
            searchQuery: `scraped+verify:${carName}`,
          };
        }
        console.info("car-image.scraped_candidate_rejected", { car: carName, url: url.slice(0, 80), reason: verdict.reason });
        if (!fallbackCandidate) {
          fallbackCandidate = {
            bytes: dl.bytes,
            mimeType: dl.mimeType,
            sourceUrl: url,
            searchQuery: `scraped+fallback:${carName}`,
          };
        }
      } catch (err) {
        errors.push(`scraped:${url.slice(0, 60)}… : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    console.warn("car-image.page_scrape_failed", err instanceof Error ? err.message : String(err));
  }

  // 2) Direct-image web_search — kept as a supplemental path in case
  // Haiku happens to return real .jpg URLs.
  try {
    const webCandidates = await findCandidateImageUrlsViaHaiku(carName, sceneIntent);
    for (const url of webCandidates) {
      try {
        const dl = await downloadImage(url);
        const verdict = await verifyCarReferenceMatch(dl.bytes, dl.mimeType, carName, sceneIntent);
        if (verdict.match) {
          const second = await isPhotoOfWholeCar(dl.bytes, dl.mimeType);
          if (!second.ok) {
            verdict.match = false;
            verdict.reason = `second-pass rejected: ${second.reason}`;
          }
        }
        if (verdict.match) {
          console.info("car-image.web_hit_verified", { car: carName, url, reason: verdict.reason });
          return {
            bytes: dl.bytes,
            mimeType: dl.mimeType,
            sourceUrl: url,
            searchQuery: `web+verify:${carName}`,
          };
        }
        if (!fallbackCandidate) {
          fallbackCandidate = {
            bytes: dl.bytes,
            mimeType: dl.mimeType,
            sourceUrl: url,
            searchQuery: `web+fallback:${carName}`,
          };
        }
      } catch (err) {
        errors.push(`web:${url.slice(0, 60)}… : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    console.warn("car-image.web_search_failed", err instanceof Error ? err.message : String(err));
  }

  // 2) Wikipedia REST — secondary
  try {
    const wiki = await fetchFromWikipedia(carName);
    if (wiki) {
      const verdict = await verifyCarReferenceMatch(wiki.bytes, wiki.mimeType, carName, sceneIntent);
      if (verdict.match) {
        const second = await isPhotoOfWholeCar(wiki.bytes, wiki.mimeType);
        if (!second.ok) {
          verdict.match = false;
          verdict.reason = `second-pass rejected: ${second.reason}`;
        }
      }
      if (verdict.match) {
        console.info("car-image.wiki_secondary_hit_verified", { car: carName, source: wiki.sourceUrl, reason: verdict.reason });
        return wiki;
      }
      console.warn("car-image.wiki_secondary_rejected", { car: carName, source: wiki.sourceUrl, reason: verdict.reason });
      if (!fallbackCandidate) fallbackCandidate = wiki;
    } else {
      console.info("car-image.wiki_secondary_miss", { car: carName });
    }
  } catch (err) {
    console.error(
      "car-image.wiki_secondary_threw",
      err instanceof Error ? err.message : String(err),
    );
  }

  // 3) Commons multi-candidate — tertiary
  if (sceneIntent) {
    try {
      const commonsCands = await findCommonsCandidateImages(carName, 15);
      for (const cand of commonsCands.slice(0, 5)) {
        try {
          const dl = await downloadImage(cand.url, WIKIPEDIA_UA);
          const verdict = await verifyCarReferenceMatch(dl.bytes, dl.mimeType, carName, sceneIntent);
        if (verdict.match) {
          const second = await isPhotoOfWholeCar(dl.bytes, dl.mimeType);
          if (!second.ok) {
            verdict.match = false;
            verdict.reason = `second-pass rejected: ${second.reason}`;
          }
        }
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
    } catch (err) {
      console.warn(
        "car-image.commons_path_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Nothing verified clean across web-scrape / Wikipedia / Commons.
  // Do NOT ship an unverified candidate — a suspension-detail-shot
  // gets edited into "a car in Big Sur" and looks worse than a
  // text-only Gemini fallback. Throw so the caller falls through to
  // text-only generation with no reference (still not great for cars
  // but at least the whole car will be visible).
  if (fallbackCandidate) {
    console.warn("car-image.rejected_all_candidates_no_fallback", {
      car: carName,
      last_seen: fallbackCandidate.sourceUrl,
      last_search: fallbackCandidate.searchQuery,
    });
  }
  throw new Error(
    `car-image: Web + Wikipedia + Commons found candidates but NONE verified as a real full-car photo of "${carName}"; errors: ${errors.slice(0, 3).join(" | ")}`,
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
