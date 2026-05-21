/**
 * Fact Check Block — adapted from
 * /apps/pipeline/src/prompt-templates/blocks/fact_check.ts
 *
 * Verifies factual claims in the editor-approved draft against the original
 * research output. Catches stats mismatches, cross-contamination, misattributed
 * quotes, unsourced claims, anonymization failures.
 *
 * Three verdicts:
 * - pass: no issues, ship
 * - fix_required: medium-severity issues auto-corrected in fixedDraft, ship that
 * - reject: high-severity issues (cross-contamination, unsourced major claims)
 *   — caller can decide whether to throw or ship original with warning
 */

export type FactCheckInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  finalDraftJson: string;
  originalResearchJson: string;
};

function formatSection(label: string, body: string): string {
  return `## ${label}\n\n${body.trim()}`;
}

function wrapInTag(tag: string, content: string): string {
  return `<${tag}>\n${content.trim()}\n</${tag}>`;
}

export function buildFactCheckPrompt(input: FactCheckInput): string {
  const sections: string[] = [];

  sections.push(
    `You are performing fact-check on the final draft for the ${input.edition} issue dated ${input.issueDate}. Your role is to verify every factual claim in the draft against the original research output. This is the last check before evaluation; errors here propagate to subscribers.`,
  );

  sections.push(formatSection("Final Draft to Verify", wrapInTag("draft_json", input.finalDraftJson)));

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
- Names not in research (especially advisor names — MUST be anonymized in Story type)
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

**Cross-contamination check.** The most insidious failure mode. The writer may have correctly used a statistic but applied it to the wrong story or claim. Specifically check:
- Statistics from research item A applied to a claim that should rely on research item B
- Quotes from one source attributed to another
- Examples from one industry segment generalized to another

**New claims not in research.** The writer may have introduced facts that aren't in research at all. Flag these as "unsourced" — they may be true but have no research backing and should be either removed, qualified, or backed by additional research.

**Anonymization integrity (Story content type only).** If the issue is a Story, verify:
- No identifiable real names
- Geographic generalization preserved
- Demographic generalization preserved (mid-30s, mid-50s, not specific ages)

**SCOPE NOTE:** The Unspoken, The Flip, Main Content commentary, Grounds for Thought, and Ancient Truth application are Mark's pattern-recognition voice and do NOT require research backing for every detail. Specific dollar amounts in the Unspoken (like '\$187 lunch') are illustrative, not claims to verify. Only flag facts that PRESENT THEMSELVES as cited (Worth Knowing items, The Number's research-sourced stat).`,
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
  "fixedDraft": <if verdict is fix_required: the draft with high-severity issues corrected, as JSON object; null otherwise>
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
