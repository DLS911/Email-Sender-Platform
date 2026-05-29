/**
 * URL Verification Block
 *
 * Research (web_search) returns citation URLs, but nothing confirms they're
 * actually live, direct article links, OR that the page content matches the
 * claimed headline. Dead links, redirects-to-homepage, and topically-wrong
 * URLs have all shipped.
 *
 * This block fetches each research URL and verifies, before the writer is
 * allowed to cite it:
 *   1. HTTP 200 after following redirects (404/410/5xx/403 → drop)
 *   2. Final URL is a deep article link (has a path slug, not a homepage)
 *   3. The page content actually contains the topic keywords from the item's
 *      title (catches "URL resolves but to the wrong/generic page")
 *
 * Items that fail are dropped. The caller decides whether the surviving set
 * still clears the research floor (and retries research if not).
 */

export type VerifiableItem = {
  url: string;
  title: string;
};

export type UrlVerifyResult = {
  url: string;
  ok: boolean;
  status?: number;
  finalUrl?: string;
  relevanceScore?: number; // 0-1, fraction of title keywords found on page
  reason?: string;
};

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "been", "your", "you", "their", "its", "it",
  "this", "that", "these", "those", "at", "by", "from", "as", "how", "why",
  "what", "when", "who", "which", "into", "out", "up", "down", "new", "now",
  "here", "s", "re",
]);

function titleKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9%$&\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Is the URL a deep article link (has a meaningful path), not a homepage/section root? */
function isDeepLink(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const path = u.pathname.replace(/\/+$/, ""); // strip trailing slashes
    if (path === "" || path === "/") return false;
    const segments = path.split("/").filter(Boolean);
    // A real article usually has either >=2 path segments OR one long slug.
    if (segments.length >= 2) return true;
    if (segments.length === 1 && segments[0]!.length >= 12) return true;
    return false;
  } catch {
    return false;
  }
}

const FETCH_TIMEOUT_MS = 9000;
const RELEVANCE_THRESHOLD = 0.34; // ≥1/3 of title keywords must appear on the page
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function verifyOne(item: VerifiableItem): Promise<UrlVerifyResult> {
  // Cheap structural check before paying for a fetch.
  if (!item.url || !/^https?:\/\//i.test(item.url)) {
    return { url: item.url, ok: false, reason: "not a valid http(s) url" };
  }
  if (!isDeepLink(item.url)) {
    return { url: item.url, ok: false, reason: "homepage/section page, not a deep article link" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(item.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml" },
    });
    clearTimeout(timer);

    const finalUrl = resp.url || item.url;
    if (resp.status !== 200) {
      return { url: item.url, ok: false, status: resp.status, finalUrl, reason: `HTTP ${resp.status}` };
    }
    // A 200 that redirected to a bare homepage is a dead-article tell.
    if (!isDeepLink(finalUrl)) {
      return {
        url: item.url,
        ok: false,
        status: 200,
        finalUrl,
        reason: "redirected to homepage/section root",
      };
    }

    const html = await resp.text();
    const pageText = stripHtml(html);
    const keywords = titleKeywords(item.title);
    if (keywords.length === 0) {
      // No keywords to check — accept on 200 + deep link alone.
      return { url: item.url, ok: true, status: 200, finalUrl, relevanceScore: 1 };
    }
    const found = keywords.filter((kw) => pageText.includes(kw)).length;
    const relevanceScore = found / keywords.length;
    if (relevanceScore < RELEVANCE_THRESHOLD) {
      return {
        url: item.url,
        ok: false,
        status: 200,
        finalUrl,
        relevanceScore,
        reason: `content relevance ${(relevanceScore * 100).toFixed(0)}% < ${(RELEVANCE_THRESHOLD * 100).toFixed(0)}% (page doesn't match the claimed headline)`,
      };
    }
    return { url: item.url, ok: true, status: 200, finalUrl, relevanceScore };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    const reason = msg.includes("abort") ? `timeout after ${FETCH_TIMEOUT_MS}ms` : `fetch failed: ${msg}`;
    return { url: item.url, ok: false, reason };
  }
}

/**
 * Verify a batch of URLs in parallel. Returns per-URL results in the same
 * order as input.
 */
export async function verifyUrls(items: VerifiableItem[]): Promise<UrlVerifyResult[]> {
  return Promise.all(items.map((item) => verifyOne(item)));
}
