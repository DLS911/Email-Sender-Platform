/**
 * Editor Pass Block — adapted from
 * /apps/pipeline/src/prompt-templates/blocks/editor_pass.ts
 *
 * Substantive editorial review of the styled draft. Evaluates:
 * - Voice integrity (not AI-generic, not content-marketing drift)
 * - Framework honesty (applied, not forced)
 * - The earned line (at least one line that lands hard)
 * - Strong close (no hedging)
 * - No filler (every paragraph earns its place)
 * - Content-type-specific structural beats (Tactic ≠ Take ≠ Story etc)
 * - Author-credibility (no first-person practitioner claims)
 *
 * Returns one of four verdicts:
 * - approve: ship the approved draft
 * - approve_with_concerns: ship but flag for human review
 * - revise: writer re-runs with the editor's specific revision instructions
 * - rewrite_section: writer re-runs JUST one section with rewrite instructions
 *
 * The caller orchestrates a revision loop. Per spec, up to 3 iterations
 * before forced approve_with_concerns to prevent infinite loops.
 */

export type EditorPassInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  contentType: string;
  styledDraftJson: string;
  iterationNumber: number;
  maxIterations: number;
};

function formatSection(label: string, body: string): string {
  return `## ${label}\n\n${body.trim()}`;
}

function wrapInTag(tag: string, content: string): string {
  return `<${tag}>\n${content.trim()}\n</${tag}>`;
}

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
  return `- Does the Cover Story follow the structural template for the approved type?
- Is the unexpected variable surfaced specifically?
- Does the Tasting Menu have variety in categories?
- Does The Drive feature a vehicle with genuine character?
- Does the section avoid travel-magazine, luxury-curator, influencer, life-coach drift?`;
}

export function buildEditorPassPrompt(input: EditorPassInput): string {
  const sections: string[] = [];

  sections.push(
    `You are performing the editor pass on the styled draft for the ${input.edition} issue dated ${input.issueDate}. This is iteration ${input.iterationNumber} of up to ${input.maxIterations}.`,
  );

  sections.push(formatSection("Styled Draft to Review", wrapInTag("draft_json", input.styledDraftJson)));

  sections.push(
    formatSection(
      "Editorial Review Criteria",
      `Evaluate the draft against these criteria. The criteria vary by content type but the structure of the review is consistent.

**Universal criteria:**
1. **Voice integrity.** Does the draft sound like Mark's voice (sharp colleague who's seen patterns across 1000+ advisors)? Or does it drift into AI-generic, content-marketing, or consultant-pitch failure modes?
2. **Framework honesty.** Are the framework references (Trust Stacking, GAP, Physician Model, contrarian positions, etc.) applied where they genuinely fit? Or are they forced as decoration?
3. **The earned line.** Is there at least one line in the main section that lands hard — a take that crystallizes, a specific that surprises, an observation the reader will remember (like 'That lunch cost you $187 and exactly zero referrals' or 'The dog seems unconvinced about your long-term equity allocation')?
4. **Strong close.** Does the close land without hedging? Or does it dissolve into 'of course your situation varies' mush?
5. **No filler.** Every paragraph earns its place. If a paragraph could be cut without loss, flag it for cut.
6. **The Unspoken specifically.** Does it have a scene anchor + dollar punchline? Or is it just stats with personality?

**Content-type-specific criteria:**
${buildContentTypeCriteria(input.edition, input.contentType)}

**Author-credibility check (weekday only):**
Mark is NOT a practicing financial advisor. Flag any first-person practitioner claims ("when I run discovery calls," "in my client meetings"). Replace with appropriate framing ("the advisors I work with do," "I've watched advisors do").

**Iteration discipline:**
- If the draft is publication-ready, return verdict "approve" with the approvedDraft attached
- If the draft has fixable issues, return verdict "revise" with specific revision instructions
- If a single section has fundamental problems, return verdict "rewrite_section" with section name + clear instructions
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
      "section": "<section name e.g. unspoken / firstPull / mainContent / closing>",
      "issue": "<specific issue>",
      "severity": "high | medium | low",
      "instruction": "<specific revision instruction>"
    }
  ],
  "approvedDraft": <if verdict is approve or approve_with_concerns: the full final draft JSON object; otherwise null>,
  "revisionRequest": "<if verdict is revise: specific changes the writer should make>",
  "rewriteSection": "<if verdict is rewrite_section: which section>",
  "rewriteInstructions": "<if verdict is rewrite_section: detailed rewrite instructions>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
