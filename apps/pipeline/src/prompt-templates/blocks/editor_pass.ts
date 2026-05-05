/**
 * Editor Pass Block
 *
 * Substantive editorial review of the styled draft. Evaluates:
 * - Whether the angle is sharp and earned
 * - Whether the framework references are applied honestly (not forced)
 * - Whether the unexpected variable / insight (weekend) is genuinely surfaced
 * - Whether the structure follows the content type's template
 * - Whether the writing has at least one line that earns its place
 * - Whether the close lands without hedging
 *
 * The editor block can:
 * - Reorder paragraphs within a section
 * - Cut weak openings or weak closes
 * - Identify sections that need rewriting (returns to writer)
 * - Tighten verbose sections
 * - Suggest replacement of weak examples or anchors
 *
 * The editor block does NOT:
 * - Change the topic or angle
 * - Rewrite for style (that's the style block's territory; the editor pass runs AFTER style)
 * - Change factual claims (that's the fact-check block)
 *
 * The editor pass produces either an approved final draft OR a list of
 * revision instructions that go back to the writer block.
 */

import { formatSection, wrapInTag } from "../_shared/formatters";

export type EditorPassInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  contentType: string;
  styledDraftJson: string; // output from style_pass, as JSON string
  iterationNumber: number; // which editor pass is this (1, 2, 3...)
  maxIterations: number; // typically 3
};

/**
 * Build the user prompt for the editor pass block.
 */
export function buildEditorPassPrompt(input: EditorPassInput): string {
  const sections: string[] = [];

  sections.push(
    `You are performing the editor pass on the styled draft for the ${input.edition} issue dated ${input.issueDate}. This is iteration ${input.iterationNumber} of up to ${input.maxIterations}.`,
  );

  sections.push(
    formatSection("Styled Draft to Review", wrapInTag("draft_json", input.styledDraftJson)),
  );

  sections.push(
    formatSection(
      "Editorial Review Criteria",
      `Evaluate the draft against these criteria. The criteria vary by content type but the structure of the review is consistent.

**Universal criteria:**
1. **Voice integrity.** Does the draft sound like the brand voice in the system prompt's voice modules? Or does it drift into AI-generic, content-marketing, or other failure modes?
2. **Framework honesty.** Are the framework references (Trust Stacking, GAP, Physician Model, contrarian positions, etc.) applied where they genuinely fit? Or are they forced as decoration?
3. **The earned line.** Is there at least one line in the main section that lands hard — a take that crystallizes, a specific that surprises, an observation that the audience will remember?
4. **Strong close.** Does the close land without hedging? Or does it dissolve into "of course your situation varies" mush?
5. **No filler.** Every paragraph earns its place. If a paragraph could be cut without loss, it should be cut.

**Content-type-specific criteria:**
${buildContentTypeCriteria(input.edition, input.contentType)}

**The author-credibility check (weekday only):**
Mark is NOT a practicing financial advisor. Flag any first-person practitioner claims ("when I run discovery calls," "in my client meetings"). Replace with appropriate framing ("the advisors I work with do," "I've watched advisors do").

**The personal-context check (weekend only):**
Mark IS the canonical Mark from personal-context.md. Verify:
- Kids referenced are 13-20 (not toddlers)
- Geography matches (salt canal Florida, not generic suburb)
- Vehicles match Mark's actual ownership history
- Activities match Mark's actual life (fishing not sailing, skiing west not east, etc.)

**Iteration discipline:**
- If the draft is publication-ready, return verdict "approve" with the final draft attached
- If the draft needs revision but is fundamentally on track, return verdict "revise" with specific revision instructions
- If the draft has fundamental problems (wrong angle, structural failure, voice drift), return verdict "rewrite_section" with the section name and a clear instruction
- If iteration ${input.iterationNumber} = ${input.maxIterations} and the draft still has problems, return verdict "approve_with_concerns" — flag the issues but don't block publication`,
    ),
  );

  sections.push(
    formatSection(
      "Output Format",
      `Return the editor's verdict as JSON:

{
  "verdict": "approve | revise | rewrite_section | approve_with_concerns",
  "summary": "<1-2 sentences on overall draft health>",
  "specificFlags": [
    {
      "section": "<section name>",
      "issue": "<specific issue>",
      "severity": "high | medium | low",
      "instruction": "<specific revision instruction>"
    }
  ],
  "approvedDraft": "<if verdict is approve or approve_with_concerns: the final draft as JSON; otherwise null>",
  "revisionRequest": "<if verdict is revise: specific changes the writer should make to the draft; otherwise null>",
  "rewriteSection": "<if verdict is rewrite_section: which section to rewrite; otherwise null>",
  "rewriteInstructions": "<if verdict is rewrite_section: detailed instructions for rewriting that section; otherwise null>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}

/**
 * Content-type-specific editorial criteria.
 */
function buildContentTypeCriteria(edition: "weekday" | "weekend", contentType: string): string {
  if (edition === "weekday") {
    switch (contentType) {
      case "tactic":
        return `- Is the tactic implementable within 7 days?
- Are the specific language/sequencing/timing details present?
- Does the diagnosis ground the tactic in a real failure mode?
- Is the why-this-works section tied to the worldview, not to general fluff?
- Does the close commit to the tactic without softening?`;

      case "take":
        return `- Is the conventional wisdom stated fairly (not strawmanned)?
- Is the contrarian flip clean and unhedged?
- Does the mechanism section actually do the reasoning work?
- Is the alternative offered (not just the criticism)?
- Does the close land without "your mileage may vary" softening?`;

      case "story":
        return `- Is the advisor anonymized but specific?
- Is there a real choice point with stakes?
- Are the consequences shown with detail (not just "things worked out")?
- Is the lesson EMERGENT rather than ANNOUNCED?
- Does the close trust the reader to extract meaning, or does it explain the meaning?`;

      case "rant":
        return `- Is there real client harm (not just industry annoyance)?
- Does the anatomy section have actual numbers and mechanisms?
- Are the cover stories dismantled with specifics?
- Is there an alternative offered?
- Does the close commit without apologizing for the heat?`;

      case "special":
        return `- Is there genuine procedural depth?
- Are the boundaries section's cautions present (where additional expertise is needed)?
- Does the implementation guidance respect the reader's time?
- Are vendor recommendations honest (not promotional)?
- Does it avoid drifting into legal/regulatory advice it shouldn't give?`;

      case "ancient_truth":
        return `- Is the proverb quoted accurately with verified attribution?
- Does the application feel earned, not forced?
- Is the voice reverent but not preachy?
- Does the close return to the proverb with new resonance?
- Is faith framing inclusive (not assuming shared belief)?`;

      default:
        return `Apply the relevant content type module's structural and voice criteria.`;
    }
  }
  // weekend
  return `- Does the Cover Story follow the structural template for the approved type?
- Is the unexpected variable surfaced specifically?
- Is the insight (Physics, Wisdom, or Insider) genuine, not decorative?
- Does the Tasting Menu have variety in categories (not 3 wines or 3 kitchen tools)?
- Does The Drive avoid practical-SUV-default and feature a vehicle with genuine character?
- Does the section avoid travel-magazine, luxury-curator, influencer, life-coach drift?
- Is the friend-over-beers test passed for every section?
- Are personal anchors authentic (not invented or contradicting Mark's canonical context)?
- Does the Sabbath section feel reverent without proselytizing?`;
}
