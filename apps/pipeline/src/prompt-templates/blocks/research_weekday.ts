/**
 * Research Weekday Block
 *
 * Performs research for a weekday issue based on the approved topic and content type.
 * Research output feeds the draft block — the writer sees this as the source material
 * for the issue.
 *
 * The research depth and shape varies by content type:
 * - Tactic: specific scripts, processes, time estimates
 * - Take: contrarian angles, conventional wisdom to challenge, contradicting data
 * - Story: anonymized advisor scenarios, emotional hooks, lesson points
 * - Rant: industry behaviors with real harm, math behind the harm, cover stories
 * - Special: technical depth on the specific topic (compliance, team, tech)
 * - Ancient Truth: relevant proverbs, application paths to advisor practice
 *
 * Universal requirements (across all types):
 * - 3 news items for the "Worth Knowing" section
 * - First news item must have stats/data for the visual element
 * - 2-3 relevant Proverbs for the Ancient Truth daily section
 */

import { formatBulletList, formatSection } from "../_shared/formatters";
import type { ProposedTopic } from "./concept_check";

export type ResearchWeekdayInput = {
  brandId: string;
  issueDate: string;
  approvedTopic: ProposedTopic;
  recentlyUsedSources?: string[]; // URLs/sources to avoid for variety
  factCheckHistory?: string[]; // statistics that have been used recently (avoid recycling)
};

/**
 * Build the user prompt for the weekday research block.
 *
 * The system prompt carries:
 * - The brand's voice modules (so research surfaces material that fits the voice)
 * - The relevant content type module (so research depth matches type)
 * - Editorial quality standards (so research meets the bar)
 *
 * The user prompt provides the specific topic and the tactical research instructions.
 */
export function buildResearchWeekdayPrompt(input: ResearchWeekdayInput): string {
  const sections: string[] = [];

  sections.push(
    `You are conducting research for a Daily Grind weekday issue dated ${input.issueDate}.`,
  );

  // Topic context
  sections.push(
    formatSection(
      "Topic Approved by Editorial",
      `Content type: ${input.approvedTopic.contentType}
Topic: ${input.approvedTopic.topic}
Angle: ${input.approvedTopic.angle}
Framework references: ${input.approvedTopic.frameworkReferences.join(", ")}`,
    ),
  );

  // Variety guardrails
  if (input.recentlyUsedSources && input.recentlyUsedSources.length > 0) {
    sections.push(
      formatSection(
        "Recently Used Sources (avoid these for variety)",
        formatBulletList(input.recentlyUsedSources),
      ),
    );
  }

  if (input.factCheckHistory && input.factCheckHistory.length > 0) {
    sections.push(
      formatSection(
        "Recently Used Statistics (avoid recycling these)",
        formatBulletList(input.factCheckHistory),
      ),
    );
  }

  // Type-specific research requirements
  sections.push(
    formatSection(
      "Research Requirements by Content Type",
      buildContentTypeResearchInstructions(input.approvedTopic.contentType),
    ),
  );

  // Universal requirements
  sections.push(
    formatSection(
      "Universal Requirements (apply regardless of content type)",
      `Worth Knowing section needs 3 news items relevant to financial advisors. The FIRST item must include a statistic, number, or data point suitable for a visual element. Items 2 and 3 are commentary or development pieces.

Ancient Truth daily reference needs 2-3 candidate Proverbs (ESV translation preferred). The proverbs should be ones that genuinely apply to advisor practice — wealth, work, counsel, integrity, discipline. Don't force application.

Source quality bar:
- Prefer Kitces Research, Cerulli, J.D. Power, Schwab Advisor Services, InvestmentNews, FA Magazine, Financial Advisor magazine, regulatory primary sources (SEC, FINRA), Federal Reserve research
- Acceptable: ThinkAdvisor, AdvisorHub, RIA Channel, Financial Planning magazine
- Avoid: low-quality content marketing, generic advisor blogs, vendor-promotional material disguised as research`,
    ),
  );

  // Output format
  sections.push(
    formatSection(
      "Output Format",
      `Return research as JSON with this exact shape:

{
  "primaryFindings": [
    {
      "claim": "<specific factual claim or insight>",
      "supporting": "<the evidence, data, or pattern that supports this>",
      "source": "<source name or URL>",
      "relevanceToTopic": "<how this serves the angle>"
    }
  ],
  "frameworkAlignments": [
    {
      "framework": "<framework module slug from approvedTopic.frameworkReferences>",
      "specificConnection": "<how the topic connects to this framework, briefly>"
    }
  ],
  "scriptsOrLanguage": [
    "<specific phrasing, scripts, or language patterns relevant to the topic>"
  ],
  "worthKnowingItems": [
    {
      "headline": "<the news item headline>",
      "summary": "<2-3 sentence summary>",
      "stat": "<statistic or data point — REQUIRED for first item>",
      "source": "<source>",
      "relevance": "<why advisors care>"
    }
  ],
  "proverbCandidates": [
    {
      "reference": "<e.g. Proverbs 11:14>",
      "text": "<the proverb text>",
      "applicationToTopic": "<1 sentence on how this could connect to advisor practice>"
    }
  ],
  "researchNotes": "<1-2 paragraphs on what you found, what was harder than expected, and any caveats the writer should know about>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}

/**
 * Build content-type-specific research instructions.
 * Each content type needs different research depth and shape.
 */
function buildContentTypeResearchInstructions(contentType: string): string {
  switch (contentType) {
    case "tactic":
      return `For a Tactic, find:
- Specific implementable techniques the advisor can execute within 7 days
- Scripts, templates, or exact language they'd use (verbatim if possible)
- Step-by-step processes with timing
- Specific failure modes other advisors encounter
- Compliance considerations if any`;

    case "take":
      return `For a Take, find:
- The conventional industry wisdom on the topic (state it fairly, not as a strawman)
- Data, patterns, or examples that contradict the conventional wisdom
- The mechanism behind why the contrarian position holds
- Specific named industry actors or practices the contrarian view applies to
- Counter-examples that show what the alternative looks like in practice`;

    case "story":
      return `For a Story, find:
- A specific anonymizable advisor scenario with a real choice point
- The texture: location-shaped, practice stage, family situation, professional context
- The decision the advisor faced and what was at stake
- The downstream consequences (specifically, with detail)
- The implicit lesson the story illustrates
- Cross-reference: ensure the scenario doesn't risk identifying any specific real advisor`;

    case "rant":
      return `For a Rant, find:
- The specific industry behavior, vendor, product, or practice that warrants the heat
- The math: real numbers showing the harm (dollars, percentages, basis points, time horizons)
- Specific actors who profit and who pays
- The cover stories the industry uses to make this acceptable, with the dismantle of each
- Real harmed parties (clients, advisors) with specific examples
- Alternatives the reader can pursue (the implication side of the Rant)`;

    case "special":
      return `For a Special, find:
- The technical landscape of the topic (compliance/team/tech/regulatory/operations)
- Current regulatory or operational state (with citations to primary sources where applicable)
- The decision factors that determine the right approach for a specific firm
- Implementation specifics: steps, timeframes, common pitfalls
- The boundaries: where the topic touches counsel, expert support, or judgment beyond the brand's scope
- Specific dollar amounts, time periods, percentages where applicable`;

    case "ancient_truth":
      return `For an Ancient Truth, find:
- The specific proverb (or other ancient wisdom-literature source) that genuinely applies
- The translation chosen (KJV/ESV/NIV are all acceptable; consistency within a piece matters)
- The plain-language read of what the proverb claims
- The specific advisor practice context where the proverb's truth shows up
- Real or composite scenes from advisor practice that illustrate the application
- Verify the proverb's text and reference accurately — misattribution kills credibility`;

    default:
      return "Conduct research appropriate for the topic and angle approved. Surface specifics, sources, and depth that the writer block will need to produce a draft worthy of the brand.";
  }
}
