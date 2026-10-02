/**
 * Post-gen surgeon — a different kind of fix call.
 *
 * The editor_pass variant-revision loop can IDENTIFY anchor-phrase
 * overuse but can't reliably FIX it: asking Sonnet to "rewrite the
 * whole draft with these revisions" over-rewrites or under-rewrites
 * and the final verdict ships with warning most runs.
 *
 * This surgeon does something different:
 *
 * 1. Deterministically compute phrase counts in the body text.
 * 2. For any phrase over the cap, pull the paragraphs where it appears
 *    past the Nth occurrence.
 * 3. Hand ONLY those paragraphs + ONLY that specific phrase to Haiku
 *    with a narrow brief: "replace occurrences past the first ${cap}
 *    with pronouns, synonyms, or partial restatements. Return the
 *    paragraphs. Change nothing else."
 * 4. Splice the rewritten paragraphs back into the draft.
 *
 * No full-draft rewrite. No "apply the editor's revisions" ambiguity.
 * Narrow prompt, narrow context, mechanical splice. The surgeon runs
 * AFTER the editor loop has done its best — not as a replacement for
 * the editor, as a last-mile fixer that cleans up what the editor
 * flagged and the revision loop couldn't bring under cap.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { DailyGrindContent } from "./daily-grind-html-template";

const HAIKU_MODEL = "claude-haiku-4-5";
const CAP = 3;

// Same stop list as content-repetition.ts; keep in sync. Pronouns, function
// words, and domain-common nouns never count as anchor failures.
const STOP_WORDS = new Set<string>([
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

type ParagraphRef = { fieldPath: string; text: string };

/**
 * Collect every editable prose field as a (fieldPath, text) pair.
 * Returns in reading order so splices preserve order.
 */
function collectParagraphs(content: DailyGrindContent): ParagraphRef[] {
  const out: ParagraphRef[] = [];
  const push = (fieldPath: string, text: string | undefined | null) => {
    if (text && typeof text === "string" && text.trim().length > 0) {
      out.push({ fieldPath, text });
    }
  };

  const ot = content.openingTrifecta;
  push("openingTrifecta.theUnspoken", ot?.theUnspoken);
  push("openingTrifecta.theNumber.description", ot?.theNumber?.description);
  push("openingTrifecta.theFlip.conventional", ot?.theFlip?.conventional);
  push("openingTrifecta.theFlip.reality", ot?.theFlip?.reality);

  (content.firstPull?.paragraphs ?? []).forEach((p, i) =>
    push(`firstPull.paragraphs.${i}`, p),
  );

  (content.worthKnowing ?? []).forEach((w, i) => {
    push(`worthKnowing.${i}.body`, w.body);
    push(`worthKnowing.${i}.myTake`, w.myTake);
  });

  const mc = content.mainContent;
  push("mainContent.intro", mc?.intro);
  (mc?.howTo?.steps ?? []).forEach((s, i) =>
    push(`mainContent.howTo.steps.${i}.body`, s.body),
  );
  push("mainContent.closing", mc?.closing);

  push("groundsForThought", content.groundsForThought);
  push("ancientTruth.application", content.ancientTruth?.application);
  push("ps", content.ps);
  return out;
}

/** Case-insensitive word-boundary count. */
function countOccurrences(text: string, phrase: string): number {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`\\b${esc}\\b`, "gi");
  return (text.match(rx) ?? []).length;
}

/** Count a phrase across all paragraphs. */
function totalCount(paragraphs: ParagraphRef[], phrase: string): number {
  return paragraphs.reduce((sum, p) => sum + countOccurrences(p.text, phrase), 0);
}

/**
 * Find overused anchor phrases (unigrams + bigrams) with totals > CAP.
 * Returns a de-duplicated list sorted by (-count, length) so bigrams
 * (more specific) come first.
 */
function findOverused(paragraphs: ParagraphRef[]): Array<{ phrase: string; count: number }> {
  const all = paragraphs.map((p) => p.text).join(" \n ").toLowerCase();
  const tokens = all.replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/).filter(Boolean);
  const counts = new Map<string, number>();
  for (const t of tokens) {
    if (t.length < 5) continue;
    if (STOP_WORDS.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i]!;
    const b = tokens[i + 1]!;
    if (a.length < 4 || b.length < 4) continue;
    if (STOP_WORDS.has(a) || STOP_WORDS.has(b)) continue;
    counts.set(`${a} ${b}`, (counts.get(`${a} ${b}`) ?? 0) + 1);
  }
  const over: Array<{ phrase: string; count: number }> = [];
  for (const [phrase, count] of counts) {
    if (count > CAP) over.push({ phrase, count });
  }
  // Bigrams first (more specific); then by count desc.
  over.sort((a, b) => {
    const aw = a.phrase.includes(" ") ? 1 : 0;
    const bw = b.phrase.includes(" ") ? 1 : 0;
    if (aw !== bw) return bw - aw;
    return b.count - a.count;
  });
  return over.slice(0, 8);
}

/**
 * Narrow Haiku call: given a specific phrase + the paragraphs where
 * it over-occurs, return the rewritten paragraphs. No preamble, no
 * fences, strict schema (same number of paragraphs, same fieldPaths).
 */
async function haikuPhraseSurgery(
  client: Anthropic,
  phrase: string,
  totalInIssue: number,
  affectedParas: ParagraphRef[],
): Promise<{ rewritten: Map<string, string>; usage: { input: number; output: number }; latencyMs: number }> {
  const payload = affectedParas.map((p, i) => `[${i}] fieldPath=${p.fieldPath}\n${p.text}`).join("\n---\n");

  const prompt = `A Daily Grind draft used the anchor phrase "${phrase}" ${totalInIssue} times across the body. The cap is ${CAP}. Your job is to bring the total down to AT MOST ${CAP} by surgically swapping occurrences past the ${CAP}rd for one of:
- a pronoun (it, that, this, the practice, the firm)
- a close synonym appropriate to that sentence (depending on what "${phrase}" is referring to: setup, framework, arrangement, approach, cadence, offer, model, pattern, agreement, promise, routine, discipline, pass, etc.)
- a partial restatement that reads naturally ("what you told her you'd do," "the whole thing you've been running")

Rules:
- Keep the first ${CAP} occurrences across all paragraphs AS-IS. For every occurrence after that, pick a substitute from above. Vary — don't use the same substitute twice in a row.
- Do NOT rewrite any paragraph beyond this swap. Preserve every other noun, verb, number, name, URL, dollar amount, and sentence structure EXACTLY.
- Do NOT add or remove paragraphs. Each input paragraph in → one output paragraph out, same count, same order, same fieldPath labels.
- Return as JSON: an array of objects {"fieldPath": "...", "text": "..."} in the same order as the input.

Input paragraphs:

${payload}

Return ONLY the JSON array. No preamble. No markdown fences.`;

  const start = Date.now();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 3500,
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });
  const latencyMs = Date.now() - start;

  const block = response.content[0];
  const rewritten = new Map<string, string>();
  if (!block || block.type !== "text") {
    return { rewritten, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens }, latencyMs };
  }

  // Parse JSON array, lenient to code fences the model might add anyway.
  let text = block.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/, "").trim();
  }
  try {
    const parsed = JSON.parse(text) as Array<{ fieldPath?: string; text?: string }>;
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        if (typeof row?.fieldPath === "string" && typeof row?.text === "string") {
          rewritten.set(row.fieldPath, row.text);
        }
      }
    }
  } catch {
    // Parse failure returns no rewrites; caller treats as no-op.
  }
  return { rewritten, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens }, latencyMs };
}

/** Set a deep JSON path on a plain object. Only used for the few known paths. */
function setPath(root: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> | unknown[] = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const idx = /^\d+$/.test(key) ? Number(key) : null;
    const next = idx === null
      ? (cur as Record<string, unknown>)[key]
      : (cur as unknown[])[idx];
    if (next === undefined || next === null) return;
    cur = next as Record<string, unknown> | unknown[];
  }
  const lastKey = parts[parts.length - 1]!;
  const lastIdx = /^\d+$/.test(lastKey) ? Number(lastKey) : null;
  if (lastIdx === null) {
    (cur as Record<string, unknown>)[lastKey] = value;
  } else {
    (cur as unknown[])[lastIdx] = value;
  }
}

export type SurgeonResult = {
  content: DailyGrindContent;
  passes: Array<{ phrase: string; before: number; after: number; paragraphsChanged: number; latencyMs: number }>;
  inputTokens: number;
  outputTokens: number;
  skippedReason?: string;
};

/**
 * Entry point. Runs anchor-phrase surgery on the content. If no phrase
 * exceeds the cap, returns the content unchanged with a skip reason.
 * Otherwise runs up to maxPhrases focused Haiku calls (one per over-
 * used phrase, highest count first) and returns the mutated content
 * plus a per-pass audit trail.
 */
export async function runAnchorSurgeon(
  client: Anthropic,
  content: DailyGrindContent,
  opts: { maxPhrases?: number } = {},
): Promise<SurgeonResult> {
  const maxPhrases = opts.maxPhrases ?? 4;

  // Deep clone so we can mutate paths freely without aliasing the input.
  let working: DailyGrindContent = JSON.parse(JSON.stringify(content)) as DailyGrindContent;

  const overused = findOverused(collectParagraphs(working));
  if (overused.length === 0) {
    return { content: working, passes: [], inputTokens: 0, outputTokens: 0, skippedReason: "no_phrase_exceeded_cap" };
  }

  const passes: SurgeonResult["passes"] = [];
  let totalInput = 0;
  let totalOutput = 0;

  for (const { phrase, count } of overused.slice(0, maxPhrases)) {
    const paras = collectParagraphs(working);
    const affected = paras.filter((p) => countOccurrences(p.text, phrase) > 0);
    if (affected.length === 0) continue;

    const beforeTotal = totalCount(paras, phrase);
    if (beforeTotal <= CAP) continue; // another earlier pass may have incidentally fixed it

    const { rewritten, usage, latencyMs } = await haikuPhraseSurgery(client, phrase, beforeTotal, affected);
    totalInput += usage.input;
    totalOutput += usage.output;

    let changed = 0;
    for (const [fieldPath, newText] of rewritten) {
      // Guard: the new paragraph must still contain the SAME non-phrase
      // substantive content. We don't try to AST-check — just reject
      // outright empty / absurdly-shortened returns (<40% of original).
      const original = affected.find((a) => a.fieldPath === fieldPath);
      if (!original) continue;
      if (newText.trim().length < Math.floor(original.text.trim().length * 0.4)) continue;
      setPath(working as unknown as Record<string, unknown>, fieldPath, newText);
      changed++;
    }

    const afterTotal = totalCount(collectParagraphs(working), phrase);
    passes.push({ phrase, before: beforeTotal, after: afterTotal, paragraphsChanged: changed, latencyMs });
  }

  return { content: working, passes, inputTokens: totalInput, outputTokens: totalOutput };
}
