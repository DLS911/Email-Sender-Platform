/**
 * Source Quality Tier (item G).
 *
 * Deterministic domain prestige ranking. URL verification (url_verify) catches
 * dead/irrelevant links — that's *accuracy*. This catches the case where a URL
 * is live and topical but the publisher is a content-marketing/SEO site rather
 * than a reputable industry source (e.g. incomelaboratory.com vs Kitces).
 *
 * Applied as a SOFT preference: re-order research items so Tier 1/2 come first
 * (raising the chance the writer cites them in Worth Knowing), and emit a
 * source_quality_check stage that warns when the surviving research set is
 * mostly Tier 3. Never hard-drops to sourceless.
 *
 * The lookup table is the canonical list — adding a domain is a one-line PR,
 * no LLM involved.
 */

export type SourceTier = 1 | 2 | 3;

/** Tier 1: preferred industry publishers + primary regulators + benchmark research. */
const TIER_1_DOMAINS = new Set<string>([
  "kitces.com",
  "michaelkitces.com",
  "cerulli.com",
  "sec.gov",
  "finra.org",
  "federalregister.gov",
  "dol.gov",
  "ftc.gov",
  "msrb.org",
  "investmentnews.com",
  "jdpower.com",
  "federalreserve.gov",
  "schwab.com",
  "schwabadvisor.com",
  "schwabassetmanagement.com",
  "fidelity.com",
  "vanguard.com",
  "ssga.com",
  "bls.gov",
  "irs.gov",
  "treasury.gov",
]);

/** Tier 2: acceptable industry trade publications + established research. */
const TIER_2_DOMAINS = new Set<string>([
  "thinkadvisor.com",
  "fa-mag.com",
  "financial-planning.com",
  "financialplanning.com",
  "advisorhub.com",
  "ria-channel.com",
  "riachannel.com",
  "riaintel.com",
  "planadviser.com",
  "advisorperspectives.com",
  "morningstar.com",
  "wealthmanagement.com",
  "barrons.com",
  "wsj.com",
  "bloomberg.com",
  "ft.com",
  "reuters.com",
  "rethinking65.com",
  "napfa.org",
  "fpanet.org",
  "cfp.net",
  "cfainstitute.org",
]);

function hostnameTier(hostname: string): SourceTier {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  if (TIER_1_DOMAINS.has(h)) return 1;
  if (TIER_2_DOMAINS.has(h)) return 2;
  // Match suffixes too (e.g. "blog.kitces.com" → tier 1).
  for (const d of TIER_1_DOMAINS) {
    if (h.endsWith("." + d)) return 1;
  }
  for (const d of TIER_2_DOMAINS) {
    if (h.endsWith("." + d)) return 2;
  }
  return 3;
}

export function urlTier(url: string): SourceTier {
  try {
    return hostnameTier(new URL(url).hostname);
  } catch {
    return 3;
  }
}

export type SourceQualityResult = {
  perItem: Array<{ url: string; source: string; tier: SourceTier }>;
  countsByTier: { tier1: number; tier2: number; tier3: number };
  /** "good" = mostly Tier 1/2 (≥ floor); "thin" = only Tier 3 majority. */
  verdict: "good" | "concerning";
  /** Human-readable warning when verdict is concerning, else empty. */
  warning: string;
};

/**
 * Classify a research bundle and return the per-item tier + an overall verdict.
 * Verdict "concerning" fires when fewer than 2 items are Tier 1/2 — the worth
 * knowing section needs 3 items, so <2 Tier-1/2 means at least 2 of the 3
 * sources shipped will be content marketing / SEO domains.
 */
export function evaluateSourceQuality(
  items: Array<{ url: string; source: string }>,
): SourceQualityResult {
  const perItem = items.map((it) => ({
    url: it.url,
    source: it.source,
    tier: urlTier(it.url),
  }));
  const countsByTier = {
    tier1: perItem.filter((p) => p.tier === 1).length,
    tier2: perItem.filter((p) => p.tier === 2).length,
    tier3: perItem.filter((p) => p.tier === 3).length,
  };
  const reputable = countsByTier.tier1 + countsByTier.tier2;
  const verdict: "good" | "concerning" = reputable >= 2 ? "good" : "concerning";
  const warning =
    verdict === "concerning"
      ? `Only ${reputable} of ${perItem.length} verified research items are from reputable publishers (Tier 1/2). The rest (${countsByTier.tier3}) are content-marketing or SEO domains — the writer may be forced to cite them.`
      : "";
  return { perItem, countsByTier, verdict, warning };
}

/**
 * Sort research items so Tier 1 comes first, then Tier 2, then Tier 3 — within
 * each tier, original order preserved (stable). The writer encounters
 * reputable sources earlier and is more likely to cite them in Worth Knowing.
 */
export function sortByTier<T extends { url: string }>(items: T[]): T[] {
  return [...items]
    .map((it, i) => ({ it, i, tier: urlTier(it.url) }))
    .sort((a, b) => (a.tier - b.tier) || (a.i - b.i))
    .map((x) => x.it);
}
