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
  description?: string;
  extract?: string;
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

export async function downloadRawReference(
  imageUrl: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  try {
    return await downloadImage(imageUrl);
  } catch {
    return null;
  }
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
 * disambiguation. For film kind, boosts titles that contain the
 * disambiguator "(film)" / "(TV series)" / a year in parens.
 */
function score(subject: string, title: string, kindHint?: string): number {
  const s = subject.toLowerCase();
  const t = title.toLowerCase();
  let n = 0;
  const tokens = s.replace(/[^\w\s]/g, " ").split(/\s+/).filter((x) => x.length > 2);
  for (const tok of tokens) if (t.includes(tok)) n += 2;
  if (t === s) n += 15;
  if (t.includes("(disambiguation)")) n -= 8;
  if (t.startsWith("list of")) n -= 8;

  // For films/TV, prefer titles that carry a film/TV disambiguator.
  // Wikipedia titles like "Civil War (2024 film)" or "The Bear (TV series)"
  // are the specific film/show article, not the general concept.
  if (kindHint === "film") {
    if (/\(\d{4}\s+film\)/.test(t)) n += 20;
    if (t.includes("(film)")) n += 15;
    if (t.includes("(tv series)") || t.includes("(miniseries)") || /\(\d{4}\s+tv/.test(t)) n += 15;
  }
  if (kindHint === "book" || kindHint === "novel") {
    if (t.includes("(novel)") || t.includes("(book)")) n += 10;
  }
  return n;
}

/**
 * For film/TV kind, verify a Wikipedia summary is actually about a
 * film/TV work by checking its description and extract for signal
 * words. Prevents returning general-topic articles (e.g. the
 * generic "civil war" topic article) when the search should have
 * found the specific film ("Civil War (2024 film)").
 */
function isFilmOrTvArticle(summary: WikiSummary): boolean {
  const text = `${summary.description ?? ""} ${summary.extract ?? ""}`.toLowerCase();
  if (!text) return false;
  const filmSignals = [
    "film directed by",
    "directed by",
    "screenplay by",
    "starring",
    "released in",
    "premiered on",
    "television series",
    "tv series",
    "miniseries",
    "streaming service",
    "the film",
    "the movie",
    "the series",
    "cinematographer",
    "executive producer",
  ];
  return filmSignals.some((w) => text.includes(w));
}

/**
 * Same shape as isFilmOrTvArticle but for books. Prevents returning
 * a generic-topic Wikipedia article when the search should have found
 * the specific book — e.g. "Orbital" (Samantha Harvey novel) resolving
 * to the general topic article for orbital mechanics or an orbital
 * sander product page, and then rendering as a satellite/tool on top
 * of a book instead of the actual book cover.
 */
function isBookArticle(summary: WikiSummary): boolean {
  const text = `${summary.description ?? ""} ${summary.extract ?? ""}`.toLowerCase();
  if (!text) return false;
  const bookSignals = [
    "novel",
    "novella",
    "memoir",
    "nonfiction",
    "non-fiction",
    "book by",
    "written by",
    "published by",
    "published in",
    "author",
    "manuscript",
    "chapter",
    "booker prize",
    "pulitzer",
    "national book award",
    "bestseller",
    "her book",
    "his book",
    "the book",
    "hardcover",
    "paperback",
  ];
  return bookSignals.some((w) => text.includes(w));
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

  // For films, do TWO searches: first with an explicit "(film)"
  // disambiguator to prefer the film article, then a general search
  // as fallback. This prevents "Civil War" from landing on the
  // general-topic article and returning war photography.
  const queries: string[] = [];
  if (kindHint === "film") {
    queries.push(`${subject} (film)`);
    queries.push(`${subject} film`);
    queries.push(subject);
  } else if (kindHint === "novel" || kindHint === "book") {
    queries.push(`${subject} novel`);
    queries.push(`${subject} book`);
    queries.push(subject);
  } else if (kindHint) {
    queries.push(`${subject} ${kindHint}`);
    queries.push(subject);
  } else {
    queries.push(subject);
  }

  const seen = new Set<string>();
  const allHits: WikiSearchHit[] = [];
  for (const q of queries) {
    try {
      const hits = await wikipediaSearch(q, 5);
      for (const h of hits) {
        if (seen.has(h.title)) continue;
        seen.add(h.title);
        allHits.push(h);
      }
    } catch (err) {
      console.warn(
        "subject-reference.search_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    if (allHits.length >= 8) break;
  }
  if (allHits.length === 0) return null;

  const ranked = allHits
    .map((h) => ({ title: h.title, score: score(subject, h.title, kindHint) }))
    .sort((a, b) => b.score - a.score);

  for (const cand of ranked.slice(0, 5)) {
    try {
      const summary = await wikipediaSummary(cand.title);
      if (!summary) continue;

      // For film kind, validate the summary is actually about a film/TV
      // work. Prevents returning the generic "civil war" article for
      // Alex Garland's "Civil War" film.
      if (kindHint === "film" && !isFilmOrTvArticle(summary)) {
        console.warn("subject-reference.film_summary_not_film", {
          subject,
          candidate: cand.title,
          description: summary.description,
        });
        continue;
      }
      // Same guard for books. Prevents "Orbital" (Samantha Harvey novel)
      // from resolving to an orbital-mechanics topic article and then
      // rendering as a satellite on top of a book.
      if ((kindHint === "book" || kindHint === "novel") && !isBookArticle(summary)) {
        console.warn("subject-reference.book_summary_not_book", {
          subject,
          candidate: cand.title,
          description: summary.description,
        });
        continue;
      }

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
