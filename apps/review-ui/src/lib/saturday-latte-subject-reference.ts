/**
 * Generic Wikipedia reference-image lookup for tasting menu subjects
 * (products, movies, books, drinks). Mirrors the car pipeline but
 * generalized: search Wikipedia for the subject → fetch the article
 * summary → use the infobox image (product photo, movie poster, book
 * cover) as the reference for Gemini's background-only edit.
 *
 * Why: text-only Gemini hallucinates broken products (Yeti with a
 * handle out the side) and invents fake movie key frames. A real
 * infobox image anchors the image so Gemini can't fabricate.
 */

const WIKIPEDIA_UA =
  "CastorAbbottLatte/1.0 (https://castorabbott.com; austin@castorabbott.com)";

export type SubjectReferenceImage = {
  bytes: Uint8Array;
  mimeType: string;
  sourceUrl: string;
  articleTitle: string;
};

type WikiSearchHit = { title: string };

async function wikipediaSearch(query: string, limit = 5): Promise<WikiSearchHit[]> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", String(limit));
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": WIKIPEDIA_UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`wiki-search: HTTP ${res.status}`);
  const data = (await res.json()) as {
    query?: { search?: Array<{ title: string }> };
  };
  return (data.query?.search ?? []).map((r) => ({ title: r.title }));
}

type WikiSummary = {
  title: string;
  originalimage?: { source: string; width?: number; height?: number };
  thumbnail?: { source: string; width?: number; height?: number };
};

async function wikipediaSummary(title: string): Promise<WikiSummary | null> {
  const slug = encodeURIComponent(title.replace(/ /g, "_"));
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`, {
    headers: { "User-Agent": WIKIPEDIA_UA, Accept: "application/json" },
    redirect: "follow",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`wiki-summary: HTTP ${res.status}`);
  return (await res.json()) as WikiSummary;
}

async function downloadImage(imageUrl: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(imageUrl, {
    headers: { "User-Agent": WIKIPEDIA_UA },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  const mimeType = contentType.split(";")[0]?.trim() ?? "";
  if (!mimeType.startsWith("image/")) throw new Error(`non-image content-type "${contentType}"`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 3000) throw new Error(`image too small (${buf.byteLength}b)`);
  return { bytes: new Uint8Array(buf), mimeType };
}

/**
 * Score Wikipedia search results for relevance to the subject. Prefers
 * exact/partial title matches; deprioritizes list pages and
 * disambiguation.
 */
function score(subject: string, title: string): number {
  const s = subject.toLowerCase();
  const t = title.toLowerCase();
  let n = 0;
  const tokens = s.replace(/[^\w\s]/g, " ").split(/\s+/).filter((x) => x.length > 2);
  for (const tok of tokens) if (t.includes(tok)) n += 2;
  if (t === s) n += 15;
  if (t.includes("(disambiguation)")) n -= 8;
  if (t.startsWith("list of")) n -= 8;
  return n;
}

/**
 * Public: try to find a Wikipedia article for the subject and return
 * its infobox image (product photo, movie poster, book cover). Returns
 * null if nothing was found or none of the candidates downloaded.
 *
 * Args:
 *   - subject: e.g. "Yeti Roadie 48", "The Truman Show", "The Passenger by Cormac McCarthy"
 *   - kindHint: optional — e.g. "movie", "book", "product" — appended to
 *     the search query to help disambiguation.
 */
export async function fetchSubjectReferenceImage(
  subject: string,
  kindHint?: string,
): Promise<SubjectReferenceImage | null> {
  if (!subject || subject.trim() === "") return null;
  const query = kindHint ? `${subject} ${kindHint}` : subject;

  let hits: WikiSearchHit[];
  try {
    hits = await wikipediaSearch(query, 5);
  } catch (err) {
    console.warn(
      "subject-reference.search_failed",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
  if (hits.length === 0) return null;

  const ranked = hits
    .map((h) => ({ title: h.title, score: score(subject, h.title) }))
    .sort((a, b) => b.score - a.score);

  for (const cand of ranked.slice(0, 3)) {
    try {
      const summary = await wikipediaSummary(cand.title);
      const imgUrl = summary?.originalimage?.source ?? summary?.thumbnail?.source;
      if (!imgUrl) continue;
      const dl = await downloadImage(imgUrl);
      return {
        bytes: dl.bytes,
        mimeType: dl.mimeType,
        sourceUrl: imgUrl,
        articleTitle: cand.title,
      };
    } catch (err) {
      console.warn(
        "subject-reference.candidate_failed",
        cand.title,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return null;
}
