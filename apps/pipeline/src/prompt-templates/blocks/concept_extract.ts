/**
 * Concept Extract Block
 *
 * Runs AFTER an issue is sent. Extracts the issue's concepts so they can be
 * stored for future variety enforcement.
 *
 * Two concept categories:
 *
 * 1. **Framework concepts** — reusable patterns that the issue engaged with
 *    (Trust Stacking, Physician Model, GAP Framework, contrarian positions,
 *    Unexpected Variable diagnostic, Insight types, etc.). These are EXPECTED
 *    to recur. Extracting them lets concept_check warn against over-clustering
 *    in any 30-day window without blocking them as one-time concepts.
 *
 * 2. **Content concepts** — specific topics, destinations, vehicles, products,
 *    contrarian takes that were the SUBJECT of the issue. These are blocked
 *    from recurring within the lockout window (default 90 days). The Saturday
 *    Latte's destination and vehicle constraints are content concept tracking;
 *    Daily Grind's specific tactics or named industry behaviors also are.
 *
 * The extraction is informational. The orchestrator persists the extracted
 * concepts to the database for future concept_check runs to consult.
 */

import { formatSection, wrapInTag } from "../_shared/formatters";

export type ConceptExtractInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  contentType: string;
  publishedDraftJson: string; // the issue as published
};

/**
 * Build the user prompt for the concept extract block.
 */
export function buildConceptExtractPrompt(input: ConceptExtractInput): string {
  const sections: string[] = [];

  sections.push(
    `You are extracting concepts from the ${input.edition} issue dated ${input.issueDate} (already published). The extracted concepts are stored to inform future concept_check decisions and prevent unintended repetition.`,
  );

  sections.push(
    formatSection("Issue (as published)", wrapInTag("issue_json", input.publishedDraftJson)),
  );

  sections.push(
    formatSection(
      "Concept Categories",
      `**Framework concepts** are reusable editorial patterns that recur intentionally across issues. They are NOT blocked from re-use; they ARE tracked for over-clustering. Examples:

- trust_stacking — Trust Stacking framework reference
- physician_model — Physician Model reference
- gap_framework — GAP Framework reference
- three_torments — Three Torments framework reference
- offers_vs_proposals — Offers vs. Proposals reference
- contrarian_anti_referrals — anti-scripted-referrals contrarian position
- contrarian_anti_hidden_commission — anti-hidden-commission contrarian position
- contrarian_anti_cold_outreach — anti-cold-outreach / trust-at-scale position
- contrarian_lead_with_hell — lead with their hell vs. features-and-benefits
- contrarian_sales_as_leadership — sales as leadership not as performance
- contrarian_cant_fake_greatness — authenticity over scripted persona
- unexpected_variable — Unexpected Variable diagnostic (weekend)
- insight_physics — Physics insight type (weekend)
- insight_wisdom — Wisdom insight type (weekend)
- insight_insider — Insider insight type (weekend)

**Content concepts** are specific things the issue is ABOUT. They get locked out from recurrence for the cooloff window (90 days default). Examples:

- destination:napa_valley — Napa specifically as a Cover Story destination
- destination:big_sky — Big Sky specifically as a Cover Story destination
- vehicle:porsche_911_used_manual — used manual 911 specifically featured in The Drive
- vehicle:bmw_m5 — BMW M5 specifically featured in The Drive
- product:yeti_tundra — Yeti Tundra cooler featured in Tasting Menu
- product:lodge_cast_iron — Lodge cast iron featured in Tasting Menu
- topic:fee_compression — fee compression as a Take or Special topic
- topic:succession_planning — succession as a Special topic
- tactic:friday_15_review — the Friday 15 specifically as a Tactic topic
- tactic:90_day_annual_review_prep — the 90-day prep specifically as a Tactic topic
- proverb:proverbs_11_14 — Proverbs 11:14 specifically used as Ancient Truth source
- contrarian_take:stop_asking_referrals — the specific "stop asking for referrals" Take

Note the slug pattern: \`{category}:{specific_thing}\`. The category provides a namespace; the specific_thing identifies the concept within that namespace.`,
    ),
  );

  sections.push(
    formatSection(
      "Extraction Procedure",
      `Walk through each section of the issue. For each section:

1. **Identify framework references.** What frameworks did this section apply? Add to the framework concepts list. A section can reference multiple frameworks; surface all of them.

2. **Identify content concepts.** What specific things is this section ABOUT? The destination of the Cover Story, the vehicle in The Drive, the products in Tasting Menu, the specific tactic/take in the Daily Grind main section, the proverb cited, the named industry behavior in a Rant. Each goes into the content concept list.

3. **Be specific.** "Italian travel" is too generic. "destination:cinque_terre" is the right granularity. "Cars" is too generic. "vehicle:cayman_gt4" is the right granularity.

4. **Use existing slugs where possible.** If a concept has appeared before, use the same slug. Don't create slug variants for the same concept.

5. **For each content concept, suggest the cooloff window.** Default is 90 days, but some concepts (a specific car category, a specific city as a destination) may warrant longer; some (a generic but specific tactic) may warrant shorter.`,
    ),
  );

  sections.push(
    formatSection(
      "Output Format",
      `Return the extracted concepts as JSON:

{
  "frameworkConcepts": [
    {
      "slug": "<slug>",
      "section": "<section name where it appears>",
      "applicationContext": "<1 sentence on how it was applied>"
    }
  ],
  "contentConcepts": [
    {
      "slug": "<slug>",
      "description": "<1-sentence description for human readers>",
      "section": "<section name where it appears>",
      "cooloffDays": <integer, default 90>,
      "cooloffRationale": "<1 sentence if non-default cooloff>"
    }
  ],
  "extractionNotes": "<1-2 sentences on edge cases or ambiguities>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
