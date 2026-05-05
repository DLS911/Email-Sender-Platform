/**
 * Style Pass Block
 *
 * Applies the brand style guide to the draft. Catches and revises:
 * - Em dashes (the brand uses none)
 * - Banned phrases per language-guide module
 * - Tone drift (corporate-speak, hustle-culture vocabulary, life-coach voice)
 * - Sentence rhythm issues (too much same-pattern, too much hedging)
 * - Length budget violations
 *
 * The style pass is intentionally narrow. Substantive editorial revision
 * is the editor block's responsibility. The style block ONLY enforces
 * surface-level discipline. It should not rewrite for substance, restructure,
 * or change the angle.
 */

import { formatBulletList, formatSection, wrapInTag } from "../_shared/formatters";

export type StylePassInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  draftJson: string; // the JSON output from the draft block, as a string
  contentType: string; // determines length expectations
  bannedPhraseHistory?: string[]; // phrases from previous issues to avoid
};

/**
 * Build the user prompt for the style pass block.
 */
export function buildStylePassPrompt(input: StylePassInput): string {
  const sections: string[] = [];

  sections.push(
    `You are performing the style pass on the draft for the ${input.edition} issue dated ${input.issueDate}. Your role is narrow: enforce surface-level style discipline. Do NOT rewrite for substance, restructure, or change the angle. That's the editor block's job.`,
  );

  sections.push(
    formatSection(
      "Draft to Style",
      wrapInTag("draft_json", input.draftJson),
    ),
  );

  if (input.bannedPhraseHistory && input.bannedPhraseHistory.length > 0) {
    sections.push(
      formatSection(
        "Recent Phrase History (avoid recycling these specific phrases)",
        formatBulletList(input.bannedPhraseHistory),
      ),
    );
  }

  sections.push(
    formatSection(
      "Style Rules to Enforce",
      `**Em dash elimination.** Replace every em dash. Use periods, commas, parentheses, or restructure the sentence. The brand uses NO em dashes.

**Banned phrase categories (from language-guide module):**
- Corporate-speak: "leverage," "synergy," "circle back," "boil the ocean," "bandwidth"
- Hustle-culture: "crush it," "level up," "10x your," "grind," "hustle harder"
- Life-coach: "permission to," "deserve," "honor your truth," "embrace your journey," "manifest"
- Travel-magazine: "tucked away," "hidden gem," "step back in time," "discover the magic"
- Luxury-curator: "discerning," "connoisseur," "refined elegance," "sophisticated traveler"
- Influencer: "obsessed with," "you NEED," "living for," "you guys" (when addressing audience)
- Filler hedges: "of course your situation may vary," "consider whether," "it might be worth"
- Generic transitions: "furthermore," "moreover," "in conclusion," "to that end"

**Sentence rhythm:**
- Watch for sentence-pattern repetition within a section. If three consecutive sentences open the same way, vary one.
- Watch for paragraph-length monotony. The voice mixes long and short paragraphs intentionally.
- Watch for transition phrase recycling within a single section.

**Voice register:**
- Direct, confident, opinionated. Soft hedges should be cut.
- "I think we should consider whether..." → "We should..." or just state the position
- "It's worth noting that..." → just note it
- "It might be worth considering..." → cut entirely or commit to the position

**Length budgets per content type:**
${buildLengthBudgets(input.edition, input.contentType)}

**What you do NOT touch:**
- The angle, the take, the structural decisions
- The framework references and how they're applied
- Specific facts, names, numbers, or quotes
- The Cover Story type's structural beats (those are editor-block territory)

Your changes should be surgical. Most sentences shouldn't need any change. The ones that need change should change minimally — fix the violation without rewriting the surrounding text.`,
    ),
  );

  sections.push(
    formatSection(
      "Output Format",
      `Return the styled draft as JSON with the same shape as the input draft, plus a styleNotes field. Specifically:

{
  ...all fields from the input draft, with style violations corrected...,
  "styleNotes": {
    "emDashesRemoved": <integer>,
    "bannedPhrasesReplaced": ["<phrase> → <replacement>"],
    "rhythmAdjustments": <integer>,
    "hedgesRemoved": <integer>,
    "lengthFlags": ["<section> over/under budget by N words"],
    "summary": "<1-2 sentences on overall style health of the draft>"
  }
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}

/**
 * Build the length-budget reference for the content type.
 */
function buildLengthBudgets(edition: "weekday" | "weekend", contentType: string): string {
  if (edition === "weekday") {
    switch (contentType) {
      case "tactic":
        return "- Main section: 150-300 words\n- Worth Knowing: 120-180 words total\n- Ancient Truth Daily: 80-120 words";
      case "take":
        return "- Main section: 200-350 words\n- Worth Knowing: 120-180 words total\n- Ancient Truth Daily: 80-120 words";
      case "story":
        return "- Main section: 250-400 words\n- Worth Knowing: 120-180 words total\n- Ancient Truth Daily: 80-120 words";
      case "rant":
        return "- Main section: 400-600 words\n- Worth Knowing: 120-180 words total\n- Ancient Truth Daily: 80-120 words";
      case "special":
        return "- Main section: 500-800 words\n- Worth Knowing: 120-180 words total\n- Ancient Truth Daily: 80-120 words";
      case "ancient_truth":
        return "- Main section: 300-450 words\n- Worth Knowing: 120-180 words total\n- Ancient Truth Daily: NOT needed (Main IS the Ancient Truth)";
      default:
        return "- Refer to the content type module in the system prompt for length budget";
    }
  } else {
    return `- Cover Story: 400-500 words
- Tasting Menu: ~200 words total (3 items)
- Host's Corner: 100-150 words
- The Drive: 75-100 words
- Sunday Prep: 50-75 words
- Sunday Reset: 40-80 words (quote + reflection)
- Sabbath: 60-100 words (scripture + reflection)`;
  }
}
