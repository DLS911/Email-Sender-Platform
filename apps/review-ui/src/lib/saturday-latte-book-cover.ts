/**
 * Fetch an actual book cover image for a Worth Reading pick.
 *
 * Problem being fixed: the generic subject-reference pipeline sent book
 * subjects to Wikipedia, which returned a scan of a Russian-language
 * interior page (not a cover) for "The Death of Ivan Ilyich" on 10-17.
 * Austin: "the book used a wiki image and it sucks, it needs to use a
 * book cover image from google or an actual cover image."
 *
 * Strategy: route book covers through OpenLibrary (free, well-indexed,
 * ships real modern Penguin/Vintage/Bantam covers). Fall through to
 * Google Books if OpenLibrary misses. If both miss, caller falls back
 * to the old Wikipedia path, but that path is now the exception, not
 * the default.
 *
 * The user prefers the raw retailer-style cover over a Gemini-rendered
 * "book on a wooden table" scene — same pattern we use for products
 * and drinks: real reference beats generative composition.
 */

type BookCover = {
  bytes: Uint8Array;
  mimeType: string;
  sourceUrl: string;
  source: "openlibrary" | "googlebooks";
};

/**
 * Strip the "by <Author>" tail that writers commonly append to book
 * titles — "The Fire Next Time by James Baldwin" searches worse than
 * splitting title + author into separate fields. Returns both pieces.
 */
function splitTitleAuthor(subject: string): { title: string; author: string | null } {
  const match = subject.match(/^(.+?)\s+by\s+(.+)$/i);
  if (match) {
    const title = (match[1] ?? "").trim();
    const author = (match[2] ?? "").trim();
    if (title && author) return { title, author };
  }
  return { title: subject.trim(), author: null };
}

async function fetchBytes(url: string, timeoutMs = 8000): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "CastorAbbott-Latte-Fetcher/1.0 (newsletter)" },
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 2000) return null; // OpenLibrary returns a tiny 1x1 for "no cover"
    const mimeType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]?.trim() ?? "image/jpeg";
    return { bytes: buf, mimeType };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * OpenLibrary search by title+author → first matching doc's ISBN →
 * cover URL at covers.openlibrary.org (the "-L.jpg" size, roughly
 * 500px tall, enough quality for the 504px email render).
 */
async function tryOpenLibrary(title: string, author: string | null): Promise<BookCover | null> {
  const qParts: string[] = [];
  qParts.push(`title=${encodeURIComponent(title)}`);
  if (author) qParts.push(`author=${encodeURIComponent(author)}`);
  qParts.push("limit=5");
  const searchUrl = `https://openlibrary.org/search.json?${qParts.join("&")}`;
  let searchJson: unknown;
  try {
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "CastorAbbott-Latte-Fetcher/1.0" },
    });
    if (!res.ok) return null;
    searchJson = await res.json();
  } catch {
    return null;
  }
  const docs = (searchJson as { docs?: Array<Record<string, unknown>> } | undefined)?.docs ?? [];
  for (const doc of docs) {
    const isbnList = Array.isArray(doc.isbn) ? (doc.isbn as string[]) : [];
    for (const isbn of isbnList) {
      const coverUrl = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg`;
      const got = await fetchBytes(coverUrl);
      if (got) {
        return { bytes: got.bytes, mimeType: got.mimeType, sourceUrl: coverUrl, source: "openlibrary" };
      }
    }
    // Doc may also have cover_i — try the OL coverId path if ISBN covers all failed.
    const coverId = typeof doc.cover_i === "number" ? doc.cover_i : null;
    if (coverId) {
      const coverIdUrl = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
      const got = await fetchBytes(coverIdUrl);
      if (got) {
        return { bytes: got.bytes, mimeType: got.mimeType, sourceUrl: coverIdUrl, source: "openlibrary" };
      }
    }
  }
  return null;
}

/**
 * Google Books Volumes API search by title+author → first volume's
 * imageLinks (prefers extraLarge → large → medium → thumbnail).
 * No API key needed for public search at modest volume.
 */
async function tryGoogleBooks(title: string, author: string | null): Promise<BookCover | null> {
  const qParts = [`intitle:${encodeURIComponent(title)}`];
  if (author) qParts.push(`inauthor:${encodeURIComponent(author)}`);
  const url = `https://www.googleapis.com/books/v1/volumes?q=${qParts.join("+")}&maxResults=5`;
  let json: unknown;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "CastorAbbott-Latte-Fetcher/1.0" },
    });
    if (!res.ok) return null;
    json = await res.json();
  } catch {
    return null;
  }
  type VolImage = { extraLarge?: string; large?: string; medium?: string; small?: string; thumbnail?: string; smallThumbnail?: string };
  const items = (json as { items?: Array<{ volumeInfo?: { imageLinks?: VolImage } }> } | undefined)?.items ?? [];
  for (const item of items) {
    const links = item.volumeInfo?.imageLinks;
    if (!links) continue;
    const picks = [links.extraLarge, links.large, links.medium, links.small, links.thumbnail, links.smallThumbnail].filter(
      (x): x is string => typeof x === "string" && x.length > 0,
    );
    for (const raw of picks) {
      // Google's thumbnail URLs often come as http — upgrade to https for CSP + email-client happiness.
      const picked = raw.replace(/^http:\/\//, "https://");
      const got = await fetchBytes(picked);
      if (got) {
        return { bytes: got.bytes, mimeType: got.mimeType, sourceUrl: picked, source: "googlebooks" };
      }
    }
  }
  return null;
}

export async function fetchBookCoverImage(subject: string): Promise<BookCover | null> {
  const { title, author } = splitTitleAuthor(subject);
  const ol = await tryOpenLibrary(title, author);
  if (ol) {
    console.info("latte.book_cover_fetched", { source: "openlibrary", title, author, sourceUrl: ol.sourceUrl });
    return ol;
  }
  const gb = await tryGoogleBooks(title, author);
  if (gb) {
    console.info("latte.book_cover_fetched", { source: "googlebooks", title, author, sourceUrl: gb.sourceUrl });
    return gb;
  }
  console.warn("latte.book_cover_not_found", { title, author });
  return null;
}
