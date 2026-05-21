/**
 * Style Pass Block — adapted verbatim from
 * /apps/pipeline/src/prompt-templates/blocks/style_pass.ts
 *
 * Narrow surface-level polish. Catches em dashes, banned phrases, rhythm
 * issues, hedge softening, voice register drift. Does NOT rewrite for
 * substance — that's the editor block's job.
 *
 * Uses Haiku for cost efficiency (~$0.005-0.01 per call). The prompt
 * is intentionally narrow so a smaller model can perform the polish
 * correctly without going off-script.
 */

export type StylePassInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  draftJson: string;
  contentType: string;
  bannedPhraseHistory?: string[];
};

function formatBulletList(items: string[]): string {
  if (items.length === 0) return "";
  return items.map((item) => `- ${item}`).join("\n");
}

function formatSection(label: string, body: string): string {
  return `## ${label}\n\n${body.trim()}`;
}

function wrapInTag(tag: string, content: string): string {
  return `<${tag}>\n${content.trim()}\n</${tag}>`;
}

function buildLengthBudgets(edition: "weekday" | "weekend", contentType: string): string {
  if (edition === "weekday") {
    switch (contentType) {
      case "tactic":
        return "- Main section: 150-300 words\n- Worth Knowing: 120-180 words total";
      case "take":
        return "- Main section: 200-350 words\n- Worth Knowing: 120-180 words total";
      case "story":
        return "- Main section: 250-400 words\n- Worth Knowing: 120-180 words total";
      case "rant":
        return "- Main section: 400-600 words\n- Worth Knowing: 120-180 words total";
      case "special":
        return "- Main section: 500-800 words\n- Worth Knowing: 120-180 words total";
      case "ancient_truth":
        return "- Main section: 300-450 words\n- Worth Knowing: 120-180 words total";
      default:
        return "- Refer to the content type module for length budget";
    }
  }
  return "- See weekend module length budgets";
}

export function buildStylePassPrompt(input: StylePassInput): string {
  const sections: string[] = [];

  sections.push(
    `You are performing the style pass on the draft for the ${input.edition} issue dated ${input.issueDate}. Your role is narrow: enforce surface-level style discipline. Do NOT rewrite for substance, restructure, or change the angle. That's the editor block's job.`,
  );

  sections.push(formatSection("Draft to Style", wrapInTag("draft_json", input.draftJson)));

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
- AI vocabulary: "crucial," "robust," "comprehensive," "nuanced," "delve into," "let's explore"

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
- All sourceUrl, sourceName, reference, stat fields — copy verbatim

Your changes should be surgical. Most sentences shouldn't need any change. The ones that need change should change minimally — fix the violation without rewriting the surrounding text.`,
    ),
  );

  sections.push(
    formatSection(
      "Output Format",
      `Return the styled draft as JSON with the SAME shape as the input draft, plus a styleNotes field. Specifically:

{
  ...all fields from the input draft, with style violations corrected...,
  "styleNotes": {
    "emDashesRemoved": <integer>,
    "bannedPhrasesReplaced": ["<phrase> → <replacement>"],
    "rhythmAdjustments": <integer>,
    "hedgesRemoved": <integer>,
    "summary": "<1-2 sentences on overall style health of the draft>"
  }
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
