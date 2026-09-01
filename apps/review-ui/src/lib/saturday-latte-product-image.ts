/**
 * Product reference-image lookup for tasting-menu Worth Trying items.
 *
 * Mirrors the car pipeline (saturday-latte-car-image.ts):
 * 1. Haiku web_search returns PAGE URLs — retailer product pages,
 *    manufacturer product pages, review articles with hero images.
 * 2. Fetch each page, parse <img> tags via the shared
 *    extractImageUrlsFromPage helper, filter for high-res content
 *    images.
 * 3. Verify each candidate with Haiku vision — must be the exact
 *    product AND a full-product hero composition.
 * 4. First verified match wins. Fall back to text-only Gemini if
 *    everything fails.
 *
 * This replaces the old Wikipedia-first path for products, which
 * often returned wrong products, brand landing pages, or logos.
 */

import Anthropic from "@anthropic-ai/sdk";
import { BROWSER_UA, extractImageUrlsFromPage } from "./saturday-latte-car-image";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export type ProductReferenceImage = {
  bytes: Uint8Array;
  mimeType: string;
  sourceUrl: string;
};

async function verifyProductReferenceMatch(
  bytes: Uint8Array,
  mimeType: string,
  productName: string,
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
              text: `You are verifying a product reference photograph. It will be used as the base image for a background/lighting edit, so it needs to show the WHOLE product clearly.

THREE checks must ALL pass for match=true:

0) IT IS AN ACTUAL PHOTOGRAPH OF THE PRODUCT. If the image is a company/brand logo (e.g. a wordmark on white), a chart/infographic, a magazine cover with mostly text, a category thumbnail (a generic pan icon rather than the specific product), or ANY image where the specific product is not the primary photographic subject — FAIL immediately.

1) EXACT MATCH TO REQUESTED PRODUCT: is this photo specifically a ${productName}?
   - Correct brand (a "Lodge 12-inch Cast Iron Skillet" is NOT a Le Creuset skillet)
   - Correct product line / model (a "Baking Steel 3/8-inch" is NOT the 1/4-inch version; a "Fellow Stagg EKG" is NOT the Fellow Ode grinder; a "Chemex 8-cup" is NOT the 3-cup)
   - Correct color / finish where the name specifies one

2) FULL-PRODUCT COMPOSITION — STRICT. The photo must show the WHOLE product. Both must be true for pass:
   (a) The full product body is in-frame (no crop of the handle, no crop of the lid, no crop of the base, no crop of the spout).
   (b) The product is the clear focal subject — not one item in a category collection page, not stacked with unrelated products.
   Failing shots (all FAIL):
   - Detail crops of a knob / logo / handle only
   - Category grid thumbnails
   - Lifestyle shots where the product is a small element in a busy scene
   - Interior/cutaway shots that don't show the full exterior
   - Stock/silhouette outlines that aren't real photographs
   Passing shots: clean product shot on white/neutral background, 3/4 angled hero shot, product on a real surface where it's the primary subject.

Return JSON only: {"match": true, "reason": "brief"} or {"match": false, "reason": "brief description of the failure"}. No preamble.`,
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
    return { match: parsed.match !== false, reason: parsed.reason ?? "" };
  } catch (err) {
    console.warn(
      "product-image.verify_threw",
      err instanceof Error ? err.message : String(err),
    );
    return { match: true, reason: "verifier threw, assuming ok" };
  }
}

async function findWebPagesForProduct(productName: string): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  const client = new Anthropic({ apiKey });

  const allViews = [
    `${productName} product photo`,
    `${productName} manufacturer website`,
    `${productName} press photo hero shot`,
    `${productName} 3/4 angle product photo`,
    `${productName} review with photos`,
    `${productName} buy retail listing`,
  ];
  const shuffled = allViews.map((v) => ({ v, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.v);
  const viewList = shuffled.slice(0, 4);

  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1200,
      temperature: 0.1,
      system: `You find PAGE URLs (not direct image URLs) using web_search. Each page must be a page that likely contains a hero photo of the specific product requested — a manufacturer product page, a retailer product listing (Amazon, Sur La Table, Williams-Sonoma, Crate & Barrel, REI, B&H, etc.), or a professional review article.

Return 6-10 page URLs. Prefer:
- Manufacturer sites (bakingsteel.com, lodgecastiron.com, fellowproducts.com, thermoworks.com, chemexcoffeemaker.com, kalitausa.com, hario.com, breville.com, kitchenaid.com, oxo.com, made-in.com, staub.com, lecreuset.com, etc.)
- Serious Eats / Wirecutter / Kitchn / America's Test Kitchen review pages
- Sur La Table / Williams-Sonoma / Crate & Barrel product listings
- Amazon product pages (usually good hero photos)

Reject: enthusiast forums, Reddit, Instagram, Pinterest, generic shopping-aggregator sites, category-grid pages that aren't a specific product listing.

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
          content: `Find 6-10 product / review / manufacturer PAGE URLs for the product: ${productName}.

Run web_search for each of these queries:
1. ${viewList[0]}
2. ${viewList[1]}
3. ${viewList[2]}
4. ${viewList[3]}

Return the page URLs that most likely contain full-product hero photos.`,
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
      "product-image.find_pages_failed",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

async function downloadImage(imageUrl: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(imageUrl, { headers: { "User-Agent": BROWSER_UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  const mimeType = contentType.split(";")[0]?.trim() ?? "";
  if (!mimeType.startsWith("image/")) throw new Error(`non-image content-type "${contentType}"`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 5000) throw new Error(`image too small (${buf.byteLength} bytes)`);
  return { bytes: new Uint8Array(buf), mimeType };
}

/**
 * Public entry: fetch a verified product reference image via
 * page-scraping. Returns null if nothing verifies (caller falls
 * back to text-only Gemini).
 */
export async function fetchProductReferenceImage(
  productName: string,
): Promise<ProductReferenceImage | null> {
  try {
    const pageUrls = await findWebPagesForProduct(productName);
    console.info("product-image.pages_found", { product: productName, count: pageUrls.length });
    const imageUrls: string[] = [];
    for (const page of pageUrls.slice(0, 8)) {
      const extracted = await extractImageUrlsFromPage(page, 6);
      for (const u of extracted) if (!imageUrls.includes(u)) imageUrls.push(u);
      if (imageUrls.length >= 20) break;
    }
    console.info("product-image.images_extracted", { product: productName, count: imageUrls.length });

    const shuffledUrls = imageUrls.slice(0, 12).map((u) => ({ u, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.u);
    for (const url of shuffledUrls) {
      try {
        const dl = await downloadImage(url);
        const verdict = await verifyProductReferenceMatch(dl.bytes, dl.mimeType, productName);
        if (verdict.match) {
          console.info("product-image.scraped_hit_verified", { product: productName, url, reason: verdict.reason });
          return { bytes: dl.bytes, mimeType: dl.mimeType, sourceUrl: url };
        }
        console.info("product-image.candidate_rejected", { product: productName, url: url.slice(0, 80), reason: verdict.reason });
      } catch (err) {
        void err;
      }
    }
    console.warn("product-image.no_verified_candidate", { product: productName });
    return null;
  } catch (err) {
    console.warn(
      "product-image.pipeline_failed",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
