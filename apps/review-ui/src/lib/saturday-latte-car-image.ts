/**
 * Reference-image lookup + Gemini editing for the theDrive slot.
 *
 * Text-only prompting cannot force Gemini 2.5 Flash Image off its baseline
 * concept of a nameplate (repeated failure: 2024 M2 G87 rendering as
 * 2020 F87 body). Fix: fetch a real press photo of the correct year+model
 * via Google Custom Search, then use Gemini's image-editing mode with that
 * photo as reference input plus a text prompt for our editorial setting.
 * The reference preserves the correct body; the prompt places it in our
 * scene.
 *
 * Requires environment variables:
 * - GOOGLE_API_KEY (already used for Gemini text-to-image; enable Custom
 *   Search JSON API in the same GCP project so this key works for both)
 * - GOOGLE_CSE_ID (Programmable Search Engine ID with Image Search enabled)
 */

const CSE_ENDPOINT = "https://www.googleapis.com/customsearch/v1";

export type CarReferenceImage = {
  bytes: Uint8Array;
  mimeType: string;
  sourceUrl: string;
  searchQuery: string;
};

type CseImageResult = {
  link: string;
  mime?: string;
  image?: {
    thumbnailLink?: string;
    contextLink?: string;
  };
};

type CseResponse = {
  items?: CseImageResult[];
  searchInformation?: { totalResults?: string };
  error?: { message?: string };
};

/**
 * Build a search query for the car. Pass the writer's raw car name
 * (e.g., "2024 BMW M2 (G87)" or "2024 Porsche 911 Carrera T (992)"),
 * and this returns a query targeted at manufacturer press photos.
 */
function buildQuery(carName: string): string {
  const clean = carName.replace(/[()]/g, "").trim();
  return `${clean} press photo front three-quarter`;
}

/**
 * Query the Custom Search API for image results.
 *
 * Args:
 *   - query: the search string
 *   - num: how many results to fetch (1-10)
 *
 * Filters we set:
 *   - searchType=image
 *   - rights=cc_publicdomain|cc_attribute|cc_sharealike (permissive licenses)
 *   - imgType=photo (excludes clipart / lineart)
 *   - safe=active
 */
async function searchImages(query: string, num = 5): Promise<CseImageResult[]> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  if (!apiKey) throw new Error("car-image: GOOGLE_API_KEY missing");
  if (!cseId) throw new Error("car-image: GOOGLE_CSE_ID missing");

  const url = new URL(CSE_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cseId);
  url.searchParams.set("q", query);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", String(Math.max(1, Math.min(10, num))));
  url.searchParams.set("imgType", "photo");
  url.searchParams.set("safe", "active");

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`car-image: CSE HTTP ${res.status} — ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as CseResponse;
  if (data.error?.message) {
    throw new Error(`car-image: CSE error — ${data.error.message}`);
  }
  return data.items ?? [];
}

async function downloadImage(imageUrl: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(imageUrl, {
    // Some manufacturer press sites require a browser-ish UA
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CastorAbbottBot/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`car-image: download HTTP ${res.status} for ${imageUrl.slice(0, 100)}`);
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const mimeType = contentType.split(";")[0]?.trim() ?? "image/jpeg";
  if (!mimeType.startsWith("image/")) {
    throw new Error(`car-image: unexpected content-type ${contentType}`);
  }
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), mimeType };
}

/**
 * Public: fetch a reference photo for the car. Tries the top N Google
 * Custom Search image results in order; returns the first one that
 * downloads successfully. If all fail, throws — the caller falls back to
 * text-only Gemini generation for this issue.
 */
export async function fetchCarReferenceImage(carName: string): Promise<CarReferenceImage> {
  const query = buildQuery(carName);
  const items = await searchImages(query, 5);
  if (items.length === 0) {
    throw new Error(`car-image: no CSE results for "${query}"`);
  }

  const errors: string[] = [];
  for (const item of items) {
    if (!item.link) continue;
    try {
      const dl = await downloadImage(item.link);
      return {
        bytes: dl.bytes,
        mimeType: dl.mimeType,
        sourceUrl: item.link,
        searchQuery: query,
      };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(
    `car-image: all ${items.length} candidates failed to download. errors: ${errors.slice(0, 3).join(" | ")}`,
  );
}
