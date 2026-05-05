/**
 * Fact Check Block
 *
 * Verifies factual claims in the editor-approved draft against the original
 * research output. Catches:
 * - Statistics that don't match the source
 * - Cross-contamination of stats between unrelated stories
 * - Misattributed quotes
 * - Misattributed proverbs or scripture references
 * - Names, dates, places that don't match research
 * - Claims the writer block introduced that aren't in research
 *
 * The fact check block is critical for brand integrity. From the editorial
 * principles: "Cross-contamination of statistics between stories destroys
 * subscriber trust. Fact-checking must be a dedicated workflow step with
 * access to original source text, not just the generated output."
 *
 * The block has access to BOTH the original research output AND the final
 * draft. It compares them.
 */

import { formatSection, wrapInTag } from "../_shared/formatters";

export type FactCheckInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  finalDraftJson: string; // post-editor draft as JSON string
  originalResearchJson: string; // the research output the writer used
};

/**
 * Build the user prompt for the fact check block.
 */
export function buildFactCheckPrompt(input: FactCheckInput): string {
  const sections: string[] = [];

  sections.push(
    `You are performing fact-check on the final draft for the ${input.edition} issue dated ${input.issueDate}. Your role is to verify every factual claim in the draft against the original research output. This is the last check before evaluation; errors here propagate to subscribers.`,
  );

  sections.push(
    formatSection(
      "Final Draft to Verify",
      wrapInTag("draft_json", input.finalDraftJson),
    ),
  );

  sections.push(
    formatSection(
      "Original Research (the source of truth)",
      wrapInTag("research_json", input.originalResearchJson),
    ),
  );

  sections.push(
    formatSection(
      "Fact-Check Procedure",
      `Walk through the draft section by section. For each factual claim, verify against research:

**Statistics and numbers.** Every statistic in the draft should appear in research (or be derivable from research). Flag:
- Stats that don't match research exactly
- Stats whose magnitudes are wrong (e.g. draft says "30%" when research says "3%")
- Stats whose units are wrong (basis points vs. percentage points)
- Stats applied to the wrong context (research says X about advisor pricing; draft applies it to client retention)

**Names and entities.** Every named person, firm, vendor, or institution should appear in research. Flag:
- Names that aren't in research (especially advisor names — these MUST be anonymized; if a name appears in the draft and not research, this is critical)
- Firm names that don't match research's specifics
- Misspellings of names from research

**Quotes.** Every direct quote should match research's source verbatim. Flag:
- Quotes that don't appear in research
- Quotes whose wording differs from the source
- Quotes with wrong attribution

**Proverbs and scripture.** Verify:
- Proverb references match the actual text in the source
- Scripture references match (book, chapter, verse)
- Translation cited matches what was used (KJV vs. NIV vs. ESV)
- Attribution is correct

**Dates and time periods.** Verify any dates or time periods cited match research.

**Cross-contamination check.** This is the most insidious failure mode. The writer may have correctly used a statistic but applied it to the wrong story or claim. Specifically check:
- Statistics from research item A applied to a claim that should rely on research item B
- Quotes from one source attributed to another
- Examples from one industry segment generalized to another

**New claims not in research.** The writer may have introduced facts that aren't in research at all. Flag these as "unsourced" — they may be true (writer's general knowledge) but they have no research backing and should be either removed, qualified, or backed by additional research.

**Anonymization integrity (Story content type weekday only).** If the issue is a Story, verify:
- No identifiable real names
- Geographic generalization preserved
- Demographic generalization preserved (mid-30s, mid-50s, not specific ages)`,
    ),
  );

  sections.push(
    formatSection(
      "Output Format",
      `Return the fact-check verdict as JSON:

{
  "verdict": "pass | fix_required | reject",
  "summary": "<1-2 sentences on overall fact integrity>",
  "verifiedClaims": <integer count of claims successfully verified>,
  "issues": [
    {
      "section": "<section name>",
      "claimInDraft": "<exact claim or quote from draft>",
      "issueType": "stat_mismatch | wrong_attribution | cross_contamination | unsourced | misspelling | other",
      "severity": "high | medium | low",
      "researchSays": "<what research actually contains, if applicable>",
      "fix": "<specific instruction for how to fix>"
    }
  ],
  "fixedDraft": "<if verdict is fix_required: the draft with high-severity issues corrected, as JSON; null otherwise>"
}

Verdict guidance:
- "pass" if no issues or only low-severity issues
- "fix_required" if medium-severity issues that you can correct in-place (apply the fixes and return the corrected draft)
- "reject" if high-severity issues that require returning to the writer (cross-contamination of stats, unsourced major claims, anonymization failures)

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
