/**
 * URL validation for Saturday Latte content.
 *
 * Problem: the writer occasionally invents plausible-looking URLs that
 * return 404 (e.g. caranddriver.com/some-fake-slug for the AMG car).
 *
 * Strategy: every URL field in the writer's output is validated. If the
 * URL appears in the research bundle (Perplexity-verified citations),
 * trust it. Otherwise do an HTTP HEAD with 5s timeout — if it returns
 * a 2xx or 3xx, keep it. Anything else drop the URL (render as plain
 * text in the email instead of a broken link).
 *
 * Validation runs in parallel across all URLs to keep latency bounded.
 */

import type {
  LinkInBody,
  SaturdayLatteContent,
  TastingMenuItem,
} from "./saturday-latte-html-template";

const HEAD_TIMEOUT_MS = 6000;
const GET_TIMEOUT_MS = 8000;
const GET_BYTE_LIMIT = 32_768;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Soft-404 markers that appear in body text/title/URL when a site
// returns 200 but the page is actually missing. Catches the common
// cases (Wikipedia stubs, IMDB "page not found", Amazon "page can't
// be found", Bandcamp "sorry, that something isn't here"). Case-
// insensitive substring match on a small body sample.
const SOFT_404_MARKERS = [
  "page not found",
  "page cannot be found",
  "page can't be found",
  "not found - page",
  "not found · ",
  "404 not found",
  "404 error",
  "we can't find the page",
  "the page you requested",
  "the page you're looking for doesn't exist",
  "the page you were looking for doesn't exist",
  "sorry, we couldn't find",
  "sorry, that page",
  "sorry, that something isn't here",
  "this page isn't available",
  "this content isn't available",
  "no longer available",
  "removed from",
  "sorry, we couldn't find that",
  "wikipedia does not have an article with this exact name",
  "the article you are looking for does not exist",
];

async function isSoft404Body(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GET_TIMEOUT_MS);
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    });
    clearTimeout(timeoutId);
    if (response.status >= 400) return true;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      // Non-HTML 200 (image/pdf/json) — trust the status code.
      return false;
    }
    const reader = response.body?.getReader();
    if (!reader) return false;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < GET_BYTE_LIMIT) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8").toLowerCase();
    const finalUrl = response.url.toLowerCase();
    if (finalUrl.includes("/404") || finalUrl.includes("/notfound") || finalUrl.includes("/not-found")) return true;
    for (const marker of SOFT_404_MARKERS) {
      if (body.includes(marker)) return true;
    }
    return false;
  } catch (_err) {
    return true;
  }
}

async function urlIsLive(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": UA },
    });
    clearTimeout(timeoutId);
    // HEAD flat-refused → try GET.
    if (response.status === 405 || response.status === 501) {
      return !(await isSoft404Body(url));
    }
    if (response.status >= 400) return false;
    // HEAD passed. Now the soft-404 check — GET a small chunk of the
    // page and look for "page not found" markers in the body. Costs a
    // little bandwidth but catches the common soft-404 pattern where a
    // site's error page returns 200 with a "page can't be found" body.
    return !(await isSoft404Body(url));
  } catch (_err) {
    return false;
  }
}

function collectResearchUrls(researchUrls: string[]): Set<string> {
  const set = new Set<string>();
  for (const u of researchUrls) {
    if (typeof u === "string" && u.trim() !== "") set.add(u.trim());
  }
  return set;
}

async function validateUrlForField(
  url: string | undefined,
  researchSet: Set<string>,
  cache: Map<string, boolean>,
): Promise<{ keep: boolean; reason: string }> {
  if (!url || url.trim() === "") return { keep: false, reason: "empty" };
  const cleaned = url.trim();
  // Reject obvious non-http
  if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
    return { keep: false, reason: "not-http" };
  }
  // Trust research-cited URLs
  if (researchSet.has(cleaned)) return { keep: true, reason: "research-cited" };
  // Check cache
  if (cache.has(cleaned)) {
    return { keep: cache.get(cleaned)!, reason: cache.get(cleaned)! ? "head-ok" : "head-fail" };
  }
  // HTTP HEAD verify
  const live = await urlIsLive(cleaned);
  cache.set(cleaned, live);
  return { keep: live, reason: live ? "head-ok" : "head-fail" };
}

export type ValidationResult = {
  content: SaturdayLatteContent;
  validated: number;
  dropped: number;
  details: Array<{ field: string; url: string; reason: string; kept: boolean }>;
};

export async function validateContentUrls(
  content: SaturdayLatteContent,
  researchUrls: string[],
): Promise<ValidationResult> {
  const researchSet = collectResearchUrls(researchUrls);
  const cache = new Map<string, boolean>();
  const details: ValidationResult["details"] = [];
  let validated = 0;
  let dropped = 0;

  // Collect all URLs to validate in parallel
  type UrlCheck = {
    field: string;
    url: string;
    apply: (keep: boolean) => void;
  };
  const checks: UrlCheck[] = [];

  // Tasting Menu items
  const newTastingMenu: TastingMenuItem[] = content.tastingMenu.map((item, i) => ({ ...item }));
  for (let i = 0; i < newTastingMenu.length; i++) {
    const item = newTastingMenu[i]!;
    if (item.url) {
      const idx = i;
      checks.push({
        field: `tastingMenu[${idx}].url`,
        url: item.url,
        apply: (keep) => {
          if (!keep) delete newTastingMenu[idx]!.url;
        },
      });
    }
  }

  // The Drive
  const newDrive = { ...content.theDrive };
  if (newDrive.url) {
    checks.push({
      field: "theDrive.url",
      url: newDrive.url,
      apply: (keep) => {
        if (!keep) delete newDrive.url;
      },
    });
  }

  // Host's Corner Learn more
  const newHostsCorner = { ...content.hostsCorner };
  if (newHostsCorner.learnMoreUrl) {
    checks.push({
      field: "hostsCorner.learnMoreUrl",
      url: newHostsCorner.learnMoreUrl,
      apply: (keep) => {
        if (!keep) {
          delete newHostsCorner.learnMoreUrl;
          delete newHostsCorner.learnMoreLabel;
        }
      },
    });
  }

  // Cover story inline links
  let newCoverStoryLinks: LinkInBody[] | undefined;
  if (content.coverStoryLinks && content.coverStoryLinks.length > 0) {
    const keepFlags: boolean[] = new Array(content.coverStoryLinks.length).fill(true);
    content.coverStoryLinks.forEach((link, i) => {
      if (link.url) {
        checks.push({
          field: `coverStoryLinks[${i}].url`,
          url: link.url,
          apply: (keep) => {
            keepFlags[i] = keep;
          },
        });
      } else {
        keepFlags[i] = false;
      }
    });
    // We'll filter after the parallel checks complete
    newCoverStoryLinks = content.coverStoryLinks;
    // We need to use a closure to filter after, but to keep the apply()
    // pattern consistent, capture the kept indices and filter at the end.
    // We'll do that explicitly below.
    void keepFlags;
  }

  // Fire all URL checks in parallel
  const results = await Promise.all(
    checks.map(async (c) => {
      const v = await validateUrlForField(c.url, researchSet, cache);
      return { check: c, result: v };
    }),
  );

  for (const { check, result } of results) {
    check.apply(result.keep);
    details.push({
      field: check.field,
      url: check.url,
      reason: result.reason,
      kept: result.keep,
    });
    if (result.keep) validated++;
    else dropped++;
  }

  // Re-filter cover story links based on the validation cache we built
  if (content.coverStoryLinks && content.coverStoryLinks.length > 0) {
    const filteredLinks: LinkInBody[] = [];
    for (const link of content.coverStoryLinks) {
      if (!link.url) continue;
      const cached = cache.get(link.url.trim());
      const inResearch = researchSet.has(link.url.trim());
      if (inResearch || cached === true) {
        filteredLinks.push(link);
      }
    }
    newCoverStoryLinks = filteredLinks.length > 0 ? filteredLinks : undefined;
  }

  const newContent: SaturdayLatteContent = {
    ...content,
    tastingMenu: newTastingMenu,
    theDrive: newDrive,
    hostsCorner: newHostsCorner,
    ...(newCoverStoryLinks ? { coverStoryLinks: newCoverStoryLinks } : {}),
  };

  // If coverStoryLinks ended up empty, drop the key entirely
  if (!newCoverStoryLinks) {
    delete newContent.coverStoryLinks;
  }

  return { content: newContent, validated, dropped, details };
}
