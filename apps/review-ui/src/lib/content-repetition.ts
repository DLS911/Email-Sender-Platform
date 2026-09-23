/**
 * Repetition analysis helpers used by the DG editor pass.
 *
 * Two axes of repetition the editor stage has been missing:
 *
 * 1. **Anchor-phrase over-use in the current draft.** The voice
 *    module says "use the central noun-phrase 3x max" but the LLM
 *    treats content nouns (service model, referral, CPA, planning
 *    software) as free-use and blows the cap. We compute a
 *    deterministic count over the rendered body text and hand the
 *    high-frequency phrases to the editor so it can name them in
 *    its revision instructions.
 *
 * 2. **Worth-Knowing overlap with recent issues.** The 09-23 draft
 *    shipped a "Gen X retirement anxiety" WK item one day after 09-21
 *    shipped "28% of Gen X investors concerned about retirement".
 *    Same underlying research, back-to-back issues. The editor
 *    wasn't given the recent WK headlines so it couldn't see the
 *    repeat. We now load the last N issues' WK headlines and
 *    surface them to the editor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// Very common words that shouldn't count as anchor phrases even when
// they repeat a lot. This is a stop-list, not a complete filter —
// short and function words are excluded by the length check anyway.
const STOP_WORDS = new Set<string>([
  // Domain-common nouns that legitimately recur in an advisor newsletter.
  "advisor", "advisors", "client", "clients", "meeting", "meetings",
  "financial", "planning", "review", "reviews", "firm", "firms",
  "business", "practice", "practices", "work", "working", "worked",
  "money", "wealth", "assets", "portfolio", "value", "values", "time",
  "year", "years", "month", "months", "week", "weeks", "week's",
  "revenue", "growth", "market", "markets", "industry", "team", "teams",
  "people", "person", "quarter", "quarterly", "annual", "annually",
  "process", "processes", "system", "systems", "model", "models",
  "service", "services", "hour", "hours", "day", "days",
  "number", "numbers", "trend", "trends", "hire", "hires", "hiring",
  // Pronouns + contractions + common function words. Without these the
  // detector flagged 'they're' as an anchor-phrase failure and the
  // editor burned both revision passes chasing the false positive.
  "there", "their", "they're", "theirs", "these", "those", "them",
  "you're", "your", "yours", "you've", "you'll", "you'd",
  "we're", "we've", "we'll", "we'd", "ours",
  "it's", "its", "that's", "there's", "here's", "what's",
  "isn't", "aren't", "wasn't", "weren't", "doesn't", "don't", "didn't",
  "shouldn't", "wouldn't", "couldn't", "hasn't", "haven't", "hadn't",
  "about", "after", "again", "against", "along", "among", "around",
  "because", "before", "below", "between", "beyond", "during", "except",
  "inside", "outside", "through", "under", "until", "while", "within",
  "already", "always", "often", "sometimes", "never", "rarely",
  "another", "anything", "anyone", "everyone", "everything", "someone",
  "something", "nothing", "nobody", "little", "every", "either", "neither",
  "should", "would", "could", "might", "must",
  "themselves", "yourself", "yourselves", "himself", "herself", "itself",
  "which", "where", "whose", "whom",
]);

/**
 * Body text used for counting — cover story + first pull + worth
 * knowing bodies + main content sections + close. Excludes headlines
 * and short labels because those legitimately reuse the anchor once.
 */
export function collectDraftBodyText(content: {
  firstPull?: { paragraphs?: string[] };
  worthKnowing?: Array<{ body?: string; myTake?: string }>;
  mainContent?: { subhead?: string; intro?: string; howTo?: { steps?: Array<{ body?: string }> }; closing?: string };
  groundsForThought?: string;
  ancientTruth?: { application?: string };
  ps?: string;
  openingTrifecta?: { theUnspoken?: string; theNumber?: { description?: string }; theFlip?: { conventional?: string; reality?: string } };
}): string {
  const parts: string[] = [];
  for (const p of content.firstPull?.paragraphs ?? []) parts.push(p);
  for (const w of content.worthKnowing ?? []) {
    if (w.body) parts.push(w.body);
    if (w.myTake) parts.push(w.myTake);
  }
  const mc = content.mainContent;
  if (mc?.subhead) parts.push(mc.subhead);
  if (mc?.intro) parts.push(mc.intro);
  for (const s of mc?.howTo?.steps ?? []) if (s.body) parts.push(s.body);
  if (mc?.closing) parts.push(mc.closing);
  if (content.groundsForThought) parts.push(content.groundsForThought);
  if (content.ancientTruth?.application) parts.push(content.ancientTruth.application);
  if (content.ps) parts.push(content.ps);
  const ot = content.openingTrifecta;
  if (ot?.theUnspoken) parts.push(ot.theUnspoken);
  if (ot?.theNumber?.description) parts.push(ot.theNumber.description);
  if (ot?.theFlip?.conventional) parts.push(ot.theFlip.conventional);
  if (ot?.theFlip?.reality) parts.push(ot.theFlip.reality);
  return parts.join(" \n\n ");
}

/**
 * Count occurrences of every unigram + bigram (case-insensitive) in
 * body text. Filters out short tokens (<5 chars for unigrams) and
 * words in the stop list. Returns descending-count entries above the
 * cap threshold.
 */
export function findOverusedPhrases(
  bodyText: string,
  cap = 3,
): Array<{ phrase: string; count: number }> {
  const clean = bodyText.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ");
  const tokens = clean.split(/\s+/).filter(Boolean);
  const counts = new Map<string, number>();

  // Unigrams — only count if ≥5 chars and not in stop list.
  for (const t of tokens) {
    if (t.length < 5) continue;
    if (STOP_WORDS.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  // Bigrams — catch multi-word anchors like "service model", "planning
  // software", "referral source". Slightly more permissive length rule
  // because bigrams are inherently more specific.
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i]!;
    const b = tokens[i + 1]!;
    if (a.length < 4 || b.length < 4) continue;
    const pair = `${a} ${b}`;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }

  const overused: Array<{ phrase: string; count: number }> = [];
  for (const [phrase, count] of counts) {
    if (count > cap) overused.push({ phrase, count });
  }
  overused.sort((a, b) => b.count - a.count);
  return overused.slice(0, 15);
}

/**
 * Pull recent Worth Knowing headlines from prior DG issues. Used by
 * the editor to flag any current-draft WK item that duplicates a
 * recent one — either verbatim or thematically. We over-fetch a bit
 * so the editor has enough context to make a fuzzy call.
 */
export async function loadRecentWorthKnowingHeadlines(
  db: SupabaseClient,
  issueDateExclusive: string,
  limit = 15,
): Promise<Array<{ issueDate: string; headline: string }>> {
  const { data, error } = await db
    .from("daily_grind_issues")
    .select("issue_date, sections")
    .lt("issue_date", issueDateExclusive)
    .order("issue_date", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  const out: Array<{ issueDate: string; headline: string }> = [];
  for (const row of data as Array<{ issue_date: string; sections: { worthKnowing?: Array<{ headline?: string }> } | null }>) {
    for (const w of row.sections?.worthKnowing ?? []) {
      if (w.headline) out.push({ issueDate: row.issue_date, headline: w.headline });
    }
  }
  return out;
}
