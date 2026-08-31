/**
 * Post-write editorial review for Saturday Morning Latte.
 *
 * Runs after the writer + author-scope guard, before image generation.
 * Reads the entire issue as an editor would and returns a typed list
 * of specific problems that would make a human editor say "hold this
 * and rewrite." must_fix findings are converted into RepeatOffense
 * items and merged into the existing retry pipeline, triggering a
 * full writer regen with the specific issues named.
 *
 * Uses Haiku 4.5 — fast (5-10s), cheap (~$0.005), and its judgment on
 * "does this read as edited" is strong when the criteria are concrete.
 *
 * Failure mode: on any Haiku error the editor returns an empty
 * findings list. This is a safety net, not a gate — a transient
 * Haiku outage never blocks the issue from generating.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SaturdayLatteContent } from "./saturday-latte-html-template";

const EDITOR_MODEL = "claude-haiku-4-5-20251001";

export type EditorFinding = {
  location: string;
  issue: string;
  severity: "must_fix" | "should_fix";
};

function assembleIssueForEditor(content: SaturdayLatteContent): string {
  const parts: string[] = [];
  parts.push(`=== COVER STORY HEADLINE ===\n${content.coverStoryHeadline}`);
  parts.push(`=== PREHEADER ===\n${content.preheader}`);
  parts.push(`=== COVER STORY BODY ===\n${(content.coverStoryParagraphs ?? []).join("\n\n")}`);
  parts.push(
    `=== TASTING MENU ===\n${content.tastingMenu
      .map((t, i) => `--- Item ${i + 1}: ${t.label} · ${t.title} ---\n${t.body}`)
      .join("\n\n")}`,
  );
  parts.push(
    `=== HOST'S CORNER ===\nMove: ${content.hostsCorner.moveTitle}\nLead-in: ${content.hostsCorner.leadIn}\nBody: ${content.hostsCorner.moveBody}`,
  );
  parts.push(
    `=== THE DRIVE ===\nCar: ${content.theDrive.car}\nSpecs: ${content.theDrive.specs}\nBody: ${content.theDrive.body}`,
  );
  parts.push(
    `=== SUNDAY PREP ===\n${content.sundayPrep.title}\n${content.sundayPrep.body}`,
  );
  parts.push(
    `=== SUNDAY RESET ===\nQuote: ${content.sundayReset.quote}\nAuthor: ${content.sundayReset.author}`,
  );
  parts.push(
    `=== SABBATH ===\nVerse: ${content.sabbath.verse}\nReference: ${content.sabbath.reference}\nReflection: ${content.sabbath.reflection}`,
  );
  parts.push(`=== PS ===\n${content.ps}`);
  return parts.join("\n\n");
}

const EDITOR_SYSTEM_PROMPT = `You are Mark's editor for The Saturday Morning Latte, a weekend lifestyle newsletter. Your job: read the whole issue and catch specific problems before publication. A good editor holds an issue and asks the writer to fix it when any of the below is true. When the issue reads clean and edited, return an empty array.

Check each of these categories carefully:

1. **Duplicated sentences.** Any sentence appearing verbatim in two places (Cover Story body + preheader, Cover Story body + Host's Corner, two Cover Story paragraphs, etc.) is must_fix. Long paragraph sentences are the risk — short transitional phrases like "It's worth the drive." don't count.

2. **Duplicated phrasing structures / templates.** If two different sections use the same rhetorical construction — a colon-then-triple-adjective list ("Sandpoint sells itself as: X, Y, Z"), a "Nobody I know goes to X" opener repeated, the same "the way X is [adjective] but Y is [adjective]" template — flag as must_fix.

3. **Weak / mushy prose.** Sentences filled with editorial-adjective filler ("beautiful," "cinematic," "editorial," "charming," "picturesque," "atmospheric," "cozy," "warm and inviting," "magical," "the perfect blend of") without concrete detail. Flag as should_fix with the specific weak sentence.

4. **Generic tasting bodies.** A tasting-menu body that could describe ANY item in that category — a wine body that reads like a generic wine review, a book body that reads like a generic literary-fiction endorsement — flag as should_fix.

5. **Attribution issues.** The Connections Guy appearing in Host's Corner or The Drive (he only belongs in Cover Story). Mark speaking in first person about a destination outside his authentic scope (his scope is coastal FL, specific ski mountains, specific cars, specific home cooking — everything else is out of scope). Flag as must_fix.

6. **Factual internal contradictions.** The specs field says a car is 471 hp but the body says 500 hp. The Cover Story says the destination is "40 miles from X" but the tasting body cross-references a different distance. Flag as must_fix.

7. **Cover Story ending doesn't land.** Cover Story just trails off, ends with a generic "if you go" summary, or repeats an earlier sentence as a closer. Flag as should_fix.

8. **Preheader duplicates a body sentence.** If the preheader is the same or very close to a sentence in the body, flag as must_fix — preheader should tease, not duplicate.

Return ONLY a JSON array of findings. No preamble, no code fence. Each finding has:
- location: which section (e.g. "coverStory paragraphs", "tastingMenu[2] body", "hostsCorner body", "preheader")
- issue: short specific description of the problem, including the offending text where relevant
- severity: "must_fix" or "should_fix"

Empty array [] if the issue reads clean.`;

export async function editorReviewIssue(
  client: Anthropic,
  content: SaturdayLatteContent,
): Promise<EditorFinding[]> {
  try {
    const response = await client.messages.create({
      model: EDITOR_MODEL,
      max_tokens: 2500,
      temperature: 0.1,
      system: EDITOR_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Review this issue. Return findings JSON.\n\n${assembleIssueForEditor(content)}`,
        },
      ],
    });
    let text = "";
    for (const block of response.content) if (block.type === "text") text += block.text;
    const stripped = text.replace(/```json\s*|\s*```/g, "").trim();
    const start = stripped.indexOf("[");
    const end = stripped.lastIndexOf("]");
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as unknown[];
    const findings: EditorFinding[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const location = typeof rec.location === "string" ? rec.location : "";
      const issue = typeof rec.issue === "string" ? rec.issue : "";
      const severity = rec.severity === "must_fix" || rec.severity === "should_fix" ? rec.severity : "should_fix";
      if (!location || !issue) continue;
      findings.push({ location, issue, severity: severity as EditorFinding["severity"] });
    }
    return findings;
  } catch (err) {
    console.warn(
      "latte.editor_review_failed",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/**
 * Cheap deterministic duplicate-sentence detector. Runs alongside the
 * Haiku editor as a floor — if Haiku misses a verbatim duplicate for
 * any reason, this always catches it. Sentences shorter than 6 words
 * are ignored so common transitional phrases don't false-positive.
 */
export function findDuplicateSentencesInContent(content: SaturdayLatteContent): EditorFinding[] {
  const proseFields: Array<{ location: string; text: string }> = [
    { location: "preheader", text: content.preheader ?? "" },
    { location: "coverStory paragraphs", text: (content.coverStoryParagraphs ?? []).join(" ") },
    { location: "hostsCorner body", text: content.hostsCorner?.moveBody ?? "" },
    { location: "theDrive body", text: content.theDrive?.body ?? "" },
    { location: "sundayPrep body", text: content.sundayPrep?.body ?? "" },
    { location: "sundayReset quote", text: content.sundayReset?.quote ?? "" },
    { location: "sabbath reflection", text: content.sabbath?.reflection ?? "" },
    { location: "ps", text: content.ps ?? "" },
  ];
  for (const [i, t] of (content.tastingMenu ?? []).entries()) {
    proseFields.push({ location: `tastingMenu[${i}] body`, text: t.body ?? "" });
  }

  const seen = new Map<string, { firstLocation: string; original: string }>();
  const dupes = new Map<string, { locations: string[]; original: string }>();

  const splitSentences = (s: string): string[] =>
    s
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  const normalize = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

  for (const field of proseFields) {
    if (!field.text) continue;
    const sentences = splitSentences(field.text);
    for (const raw of sentences) {
      const norm = normalize(raw);
      if (!norm) continue;
      if (wordCount(norm) < 6) continue;
      const existing = seen.get(norm);
      if (existing) {
        const key = norm;
        const dup = dupes.get(key);
        if (dup) {
          if (!dup.locations.includes(field.location)) dup.locations.push(field.location);
        } else {
          dupes.set(key, {
            locations: [existing.firstLocation, field.location],
            original: raw,
          });
        }
      } else {
        seen.set(norm, { firstLocation: field.location, original: raw });
      }
    }
  }

  const out: EditorFinding[] = [];
  for (const { locations, original } of dupes.values()) {
    out.push({
      location: locations.join(" + "),
      issue: `duplicated sentence — "${original}" appears in each of these locations. Rewrite all but one so nothing is verbatim-repeated.`,
      severity: "must_fix",
    });
  }
  return out;
}
